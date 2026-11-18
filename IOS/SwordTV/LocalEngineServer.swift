import Foundation
import Network

/// Lightweight local HTTP engine on 127.0.0.1:11472 mirroring V2 engine_server.js + proxy.js.
final class LocalEngineServer {
    struct MediaTarget {
        var url: String
        var headers: [String: String]
        let channelCode: String?
    }

    private let portal: PortalClient
    private let port: UInt16
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.swordtv.engine", attributes: .concurrent)
    private var tokens: [String: MediaTarget] = [:]
    private var tokenOrder: [String] = []
    private let tokenLock = NSLock()
    private let proxyDelegate = ProxySessionDelegate()
    private lazy var proxySession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 15
        cfg.waitsForConnectivity = true
        cfg.httpMaximumConnectionsPerHost = 8
        return URLSession(configuration: cfg, delegate: proxyDelegate, delegateQueue: nil)
    }()
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 20
        return URLSession(configuration: cfg, delegate: RedirectHandler(), delegateQueue: nil)
    }()

    private final class RedirectHandler: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(request)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
               let trust = challenge.protectionSpace.serverTrust {
                completionHandler(.useCredential, URLCredential(trust: trust))
            } else {
                completionHandler(.performDefaultHandling, nil)
            }
        }
    }

    init(portal: PortalClient, port: UInt16 = 11472) {
        self.portal = portal
        self.port = port
    }

    func start() {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        listener = try? NWListener(using: params)
        listener?.newConnectionHandler = { [weak self] conn in
            conn.start(queue: self?.queue ?? .global())
            self?.handle(conn)
        }
        listener?.start(queue: queue)
        queue.async { try? self.portal.ensureSession() }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func registerMedia(url: String, headers: [String: String], channelCode: String? = nil) -> String {
        let tok = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(24))
        tokenLock.lock()
        tokens[tok] = MediaTarget(url: url, headers: headers, channelCode: channelCode)
        tokenOrder.append(tok)
        while tokenOrder.count > 128 {
            let old = tokenOrder.removeFirst()
            tokens.removeValue(forKey: old)
        }
        tokenLock.unlock()
        return tok
    }

    private func handle(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
            guard let self, let data, let raw = String(data: data, encoding: .utf8) else { conn.cancel(); return }
            let lines = raw.components(separatedBy: "\r\n")
            guard let first = lines.first?.split(separator: " "), first.count >= 2 else { conn.cancel(); return }
            let method = String(first[0]).uppercased()
            let fullPath = String(first[1])
            var reqHeaders: [String: String] = [:]
            for line in lines.dropFirst() where line.contains(":") {
                let parts = line.split(separator: ":", maxSplits: 1)
                reqHeaders[parts[0].trimmingCharacters(in: .whitespaces).lowercased()] = parts[1].trimmingCharacters(in: .whitespaces)
            }
            if method == "OPTIONS" {
                self.sendRaw(conn, status: 204, contentType: "text/plain", body: Data())
                return
            }
            let comps = URLComponents(string: "http://127.0.0.1\(fullPath)")
            let path = comps?.path ?? fullPath
            var query: [String: String] = [:]
            comps?.queryItems?.forEach { query[$0.name] = $0.value ?? "" }
            self.route(conn, method: method, path: path, query: query, reqHeaders: reqHeaders)
        }
    }

    private func route(_ conn: NWConnection, method: String, path: String, query: [String: String], reqHeaders: [String: String]) {
        do {
            switch path {
            case "/ping", "/api/ping":
                let dev = deviceInfo()
                sendJson(conn, 200, [
                    "ok": true, "service": "SwordTV iOS Engine", "version": "2.0.0",
                    "sessionReady": portal.sessionReady,
                    "platform": "ios", "deviceModel": dev.model, "chip": dev.chip
                ])
            case "/api/live/categories":
                sendJson(conn, 200, ["ok": true, "categories": try portal.getLiveCategories()])
            case "/api/live/channels":
                let (chs, hasMore) = try portal.getLiveChannels(catId: query["catId"], page: Int(query["page"] ?? "1") ?? 1, size: Int(query["size"] ?? "50") ?? 50)
                sendJson(conn, 200, ["ok": true, "channels": chs, "hasMore": hasMore])
            case "/api/live/resolve":
                let code = query["code"] ?? query["channelCode"] ?? ""
                let res = try portal.resolveLive(channelCode: code)
                let tok = registerMedia(url: res.url, headers: res.headers, channelCode: code)
                sendJson(conn, 200, ["ok": true, "name": res.name, "streamUrl": "http://127.0.0.1:\(port)/media/\(tok)/stream.m3u8", "mime": "application/x-mpegurl"])
            case "/api/live/proxy":
                let rawUrl = query["url"] ?? ""
                let tok = registerMedia(url: rawUrl, headers: ["User-Agent": PortalClient.uaCDN])
                let ext = rawUrl.lowercased().contains(".m3u8") ? "stream.m3u8" : "stream.ts"
                sendJson(conn, 200, ["ok": true, "streamUrl": "http://127.0.0.1:\(port)/media/\(tok)/\(ext)"])
            case "/api/vod/catalog":
                let cat = query["category"] ?? "movies"
                sendJson(conn, 200, ["ok": true, "root": cat, "items": try portal.home(category: cat)])
            case "/api/vod/search":
                sendJson(conn, 200, ["ok": true, "items": try portal.search(query: query["q"] ?? query["query"] ?? "")])
            case "/api/vod/detail":
                var det = try portal.detail(contentId: query["id"] ?? query["contentId"] ?? "")
                det["ok"] = true
                sendJson(conn, 200, det)
            case "/api/vod/resolve":
                let s = try portal.resolveVod(contentId: query["id"] ?? query["contentId"] ?? "", seriesId: query["seriesId"] ?? query["seriesContentId"] ?? "")
                let rawUrl = s["url"] as? String ?? ""
                let hdrs = s["headers"] as? [String: String] ?? [:]
                let tok = registerMedia(url: rawUrl, headers: hdrs)
                let mime = s["mime"] as? String ?? "video/mp4"
                let isTs = mime.contains("mp2t") || rawUrl.lowercased().contains(".ts")
                let streamUrl = isTs
                    ? "http://127.0.0.1:\(port)/vod-hls/\(tok)/stream.m3u8"
                    : "http://127.0.0.1:\(port)/media/\(tok)/video.mp4"
                let outMime = isTs ? "application/x-mpegurl" : mime
                sendJson(conn, 200, ["ok": true, "name": s["name"] ?? "", "streamUrl": streamUrl, "mime": outMime, "codec": s["codec"] ?? "", "quality": s["quality"] ?? "", "subtitles": s["subtitles"] ?? []])
            case "/sub", "/api/vod/sub":
                guard let subUrl = query["url"], let u = URL(string: subUrl) else {
                    sendRaw(conn, status: 400, contentType: "text/plain", body: Data("Missing url".utf8))
                    return
                }
                var req = URLRequest(url: u)
                req.setValue(PortalClient.uaCDN, forHTTPHeaderField: "User-Agent")
                session.dataTask(with: req) { d, _, _ in
                    let raw = String(data: d ?? Data(), encoding: .utf8) ?? ""
                    let vtt = self.srtToVtt(raw)
                    self.sendRaw(conn, status: 200, contentType: "text/vtt; charset=utf-8", body: Data(vtt.utf8))
                }.resume()
            case "/api/vod/abort", "/api/live/abort", "/api/log":
                sendJson(conn, 200, ["ok": true])
            default:
                if path == "/" || path == "/web" || path.hasPrefix("/web/") {
                    serveWebAsset(conn, path: path)
                } else if path.hasPrefix("/vod-hls/") {
                    let tok = String(path.dropFirst(9).split(separator: "/").first ?? "")
                    tokenLock.lock(); let target = tokens[tok]; tokenLock.unlock()
                    guard let target else { sendRaw(conn, status: 404, contentType: "text/plain", body: Data("expired".utf8)); return }
                    serveVodHls(conn, token: tok, target: target)
                } else if path.hasPrefix("/vod-fmp4/") {
                    let parts = path.dropFirst(10).split(separator: "/", maxSplits: 1)
                    let tok = String(parts.first ?? "")
                    let file = String(parts.last ?? "")
                    tokenLock.lock(); let target = tokens[tok]; tokenLock.unlock()
                    guard let target else { sendRaw(conn, status: 404, contentType: "text/plain", body: Data("expired".utf8)); return }
                    serveVodFmp4(conn, token: tok, file: file, target: target)
                } else if path.hasPrefix("/media/") {
                    let tok = String(path.dropFirst(7).split(separator: "/").first ?? "")
                    tokenLock.lock(); let target = tokens[tok]; tokenLock.unlock()
                    guard let target else { sendRaw(conn, status: 404, contentType: "text/plain", body: Data("expired".utf8)); return }
                    proxyMedia(conn, method: method, urlStr: target.url, headers: target.headers, range: reqHeaders["range"], token: tok)
                } else if path.hasPrefix("/hls/") {
                    let parts = path.dropFirst(5).split(separator: "/", maxSplits: 1)
                    let tok = String(parts.first ?? "")
                    let b64 = String(parts.last ?? "").split(separator: ".").first.map(String.init) ?? ""
                    tokenLock.lock(); let target = tokens[tok]; tokenLock.unlock()
                    guard let target, let decoded = decodeBase64Url(b64) else { sendRaw(conn, status: 404, contentType: "text/plain", body: Data("expired".utf8)); return }
                    proxyMedia(conn, method: method, urlStr: decoded, headers: target.headers, range: reqHeaders["range"], token: tok)
                } else {
                    sendJson(conn, 404, ["ok": false, "error": "Not found"])
                }
            }
        } catch {
            sendJson(conn, 500, ["ok": false, "error": error.localizedDescription])
        }
    }

    private func serveWebAsset(_ conn: NWConnection, path: String) {
        let rel = path
            .replacingOccurrences(of: "/web/", with: "")
            .replacingOccurrences(of: "/web", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let cleanPath = rel.isEmpty ? "index.html" : rel
        guard !cleanPath.contains(".."),
              let base = Bundle.main.resourceURL?.appendingPathComponent("Web"),
              let data = try? Data(contentsOf: base.appendingPathComponent(cleanPath)) else {
            sendRaw(conn, status: 404, contentType: "text/plain", body: Data("Not found".utf8))
            return
        }
        let ext = (cleanPath as NSString).pathExtension.lowercased()
        let mime: String
        switch ext {
        case "html": mime = "text/html; charset=utf-8"
        case "js": mime = "application/javascript; charset=utf-8"
        case "css": mime = "text/css; charset=utf-8"
        case "json": mime = "application/json; charset=utf-8"
        case "png": mime = "image/png"
        case "svg": mime = "image/svg+xml"
        case "jpg", "jpeg": mime = "image/jpeg"
        default: mime = "application/octet-stream"
        }
        sendRaw(conn, status: 200, contentType: mime, body: data)
    }

    private final class StreamRelayContext {
        let conn: NWConnection
        let isHlsCheckUrl: String
        let token: String
        let rewriteHls: (String, String, URL) -> String
        var isHls = false
        var statusCode = 200
        var contentType = "video/mp2t"
        var headersSent = false
        var hlsBuffer = Data()
        var responseUrl: URL?

        init(conn: NWConnection, urlStr: String, token: String, rewriteHls: @escaping (String, String, URL) -> String) {
            self.conn = conn
            self.isHlsCheckUrl = urlStr
            self.token = token
            self.rewriteHls = rewriteHls
        }
    }

    private final class ProxySessionDelegate: NSObject, URLSessionDataDelegate {
        private var contexts: [Int: StreamRelayContext] = [:]
        private let lock = NSLock()

        func register(taskId: Int, ctx: StreamRelayContext) {
            lock.lock(); contexts[taskId] = ctx; lock.unlock()
        }

        private func get(_ taskId: Int) -> StreamRelayContext? {
            lock.lock(); defer { lock.unlock() }
            return contexts[taskId]
        }

        private func pop(_ taskId: Int) -> StreamRelayContext? {
            lock.lock(); defer { lock.unlock() }
            return contexts.removeValue(forKey: taskId)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(request)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
               let trust = challenge.protectionSpace.serverTrust {
                completionHandler(.useCredential, URLCredential(trust: trust))
            } else {
                completionHandler(.performDefaultHandling, nil)
            }
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            guard let ctx = get(dataTask.taskIdentifier) else { completionHandler(.cancel); return }
            let http = response as? HTTPURLResponse
            ctx.statusCode = http?.statusCode ?? 200
            ctx.contentType = (http?.value(forHTTPHeaderField: "Content-Type") ?? "video/mp2t").lowercased()
            ctx.responseUrl = response.url ?? URL(string: ctx.isHlsCheckUrl)
            ctx.isHls = ctx.contentType.contains("mpegurl") || ctx.isHlsCheckUrl.lowercased().contains(".m3u8")

            if !ctx.isHls {
                var hdr = "HTTP/1.1 \(ctx.statusCode) OK\r\nContent-Type: \(ctx.contentType)\r\n"
                if let cl = http?.value(forHTTPHeaderField: "Content-Length") { hdr += "Content-Length: \(cl)\r\n" }
                if let cr = http?.value(forHTTPHeaderField: "Content-Range") { hdr += "Content-Range: \(cr)\r\n" }
                hdr += "Accept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n"
                ctx.headersSent = true
                ctx.conn.send(content: Data(hdr.utf8), completion: .contentProcessed { _ in })
            }
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            guard let ctx = get(dataTask.taskIdentifier) else { return }
            if ctx.isHls {
                ctx.hlsBuffer.append(data)
            } else {
                ctx.conn.send(content: data, completion: .contentProcessed { _ in })
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            guard let ctx = pop(task.taskIdentifier) else { return }
            if ctx.isHls {
                let raw = String(data: ctx.hlsBuffer, encoding: .utf8) ?? ""
                if error != nil || ctx.statusCode >= 400 || raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    let hdr = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
                    ctx.conn.send(content: Data(hdr.utf8), completion: .contentProcessed { _ in ctx.conn.cancel() })
                } else {
                    let body = Data(ctx.rewriteHls(raw, ctx.token, ctx.responseUrl ?? URL(string: ctx.isHlsCheckUrl)!).utf8)
                    let hdr = "HTTP/1.1 \(ctx.statusCode) OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: \(body.count)\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
                    var payload = Data(hdr.utf8)
                    payload.append(body)
                    ctx.conn.send(content: payload, completion: .contentProcessed { _ in ctx.conn.cancel() })
                }
            } else {
                if !ctx.headersSent {
                    let hdr = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
                    ctx.conn.send(content: Data(hdr.utf8), completion: .contentProcessed { _ in ctx.conn.cancel() })
                } else {
                    ctx.conn.send(content: nil, isComplete: true, completion: .contentProcessed { _ in ctx.conn.cancel() })
                }
            }
        }
    }

    private func deviceInfo() -> (model: String, chip: String) {
        var sys = utsname()
        uname(&sys)
        let machine = withUnsafePointer(to: &sys.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
        let map: [String: (String, String)] = [
            "iPhone14,2": ("iPhone 13 Pro", "Apple A15 Bionic"),
            "iPhone14,3": ("iPhone 13 Pro Max", "Apple A15 Bionic"),
            "iPhone14,4": ("iPhone 13 mini", "Apple A15 Bionic"),
            "iPhone14,5": ("iPhone 13", "Apple A15 Bionic"),
            "iPhone14,6": ("iPhone SE (3.ª gen.)", "Apple A15 Bionic"),
            "iPhone14,7": ("iPhone 14", "Apple A15 Bionic"),
            "iPhone14,8": ("iPhone 14 Plus", "Apple A15 Bionic"),
            "iPhone15,2": ("iPhone 14 Pro", "Apple A16 Bionic"),
            "iPhone15,3": ("iPhone 14 Pro Max", "Apple A16 Bionic"),
            "iPhone15,4": ("iPhone 15", "Apple A16 Bionic"),
            "iPhone15,5": ("iPhone 15 Plus", "Apple A16 Bionic"),
            "iPhone16,1": ("iPhone 15 Pro", "Apple A17 Pro"),
            "iPhone16,2": ("iPhone 15 Pro Max", "Apple A17 Pro"),
            "iPhone17,1": ("iPhone 16 Pro", "Apple A18 Pro"),
            "iPhone17,2": ("iPhone 16 Pro Max", "Apple A18 Pro"),
            "iPhone17,3": ("iPhone 16", "Apple A18"),
            "iPhone17,4": ("iPhone 16 Plus", "Apple A18"),
            "arm64": ("iOS Simulator", "Apple Silicon (VideoToolbox)"),
            "x86_64": ("iOS Simulator", "Apple VideoToolbox")
        ]
        if let hit = map[machine] { return hit }
        return (machine, "Apple Silicon (VideoToolbox)")
    }

    private var vodMetaCache: [String: (total: Int64, audioRate: Int, initData: Data?)] = [:]

    private func serveVodHls(_ conn: NWConnection, token: String, target: MediaTarget) {
        guard let url = URL(string: target.url) else {
            sendRaw(conn, status: 400, contentType: "text/plain", body: Data("bad url".utf8))
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "GET"
        req.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        target.headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
        session.dataTask(with: req) { _, resp, _ in
            let http = resp as? HTTPURLResponse
            let cr = http?.value(forHTTPHeaderField: "Content-Range") ?? ""
            var total: Int64 = 0
            if let slashIdx = cr.lastIndex(of: "/"),
               let parsed = Int64(cr[cr.index(after: slashIdx)...].trimmingCharacters(in: .whitespaces)) {
                total = parsed
            }
            if total <= 0 {
                let clHeader = Int64(http?.value(forHTTPHeaderField: "Content-Length") ?? "") ?? 0
                total = clHeader > 0 ? clHeader : (resp?.expectedContentLength ?? 0)
            }
            guard total > 0 else {
                self.sendRaw(conn, status: 502, contentType: "text/plain", body: Data("no content length".utf8))
                return
            }
            self.tokenLock.lock()
            let existing = self.vodMetaCache[token]
            self.vodMetaCache[token] = (total, existing?.audioRate ?? 48000, existing?.initData)
            self.tokenLock.unlock()

            let chunk: Int64 = 188 * 10000 // 1.88 MB aligned to 188-byte MPEG-TS packets
            let segCount = Int((total + chunk - 1) / chunk)
            var lines = [
                "#EXTM3U",
                "#EXT-X-VERSION:7",
                "#EXT-X-TARGETDURATION:10",
                "#EXT-X-MEDIA-SEQUENCE:0",
                "#EXT-X-PLAYLIST-TYPE:VOD",
                "#EXT-X-MAP:URI=\"http://127.0.0.1:\(self.port)/vod-fmp4/\(token)/init.mp4\""
            ]
            for i in 0..<segCount {
                lines.append("#EXTINF:8.000,")
                lines.append("http://127.0.0.1:\(self.port)/vod-fmp4/\(token)/seg_\(i).m4s")
            }
            lines.append("#EXT-X-ENDLIST")
            let m3u8 = lines.joined(separator: "\n") + "\n"
            self.sendRaw(conn, status: 200, contentType: "application/vnd.apple.mpegurl", body: Data(m3u8.utf8))
        }.resume()
    }

    private func serveVodFmp4(_ conn: NWConnection, token: String, file: String, target: MediaTarget) {
        guard let url = URL(string: target.url) else {
            sendRaw(conn, status: 400, contentType: "text/plain", body: Data())
            return
        }
        let chunk: Int64 = 188 * 10000
        if file == "init.mp4" {
            tokenLock.lock(); let cachedInit = vodMetaCache[token]?.initData; tokenLock.unlock()
            if let cachedInit {
                sendRaw(conn, status: 200, contentType: "video/mp4", body: cachedInit)
                return
            }
            var req = URLRequest(url: url, timeoutInterval: 20)
            req.setValue("bytes=0-\(chunk - 1)", forHTTPHeaderField: "Range")
            target.headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
            session.dataTask(with: req) { data, _, _ in
                guard let data, !data.isEmpty else {
                    self.sendRaw(conn, status: 502, contentType: "text/plain", body: Data())
                    return
                }
                let parsed = TsToFmp4Remuxer.parseTS(data)
                let initSeg = TsToFmp4Remuxer.buildInitSegment(video: parsed.videoConfig, audio: parsed.audioConfig)
                let sr = parsed.audioConfig?.sampleRate ?? 48000
                self.tokenLock.lock()
                let prev = self.vodMetaCache[token]
                self.vodMetaCache[token] = (prev?.total ?? 0, sr, initSeg)
                self.tokenLock.unlock()
                self.sendRaw(conn, status: 200, contentType: "video/mp4", body: initSeg)
            }.resume()
            return
        }

        if file.hasPrefix("seg_"), let idx = Int(file.dropFirst(4).split(separator: ".").first ?? "") {
            tokenLock.lock(); let meta = vodMetaCache[token]; tokenLock.unlock()
            let total = meta?.total ?? Int64.max
            let start = Int64(idx) * chunk
            guard start < total else {
                sendRaw(conn, status: 404, contentType: "text/plain", body: Data())
                return
            }
            let end = min(start + chunk - 1, total - 1)
            var req = URLRequest(url: url, timeoutInterval: 25)
            req.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
            target.headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
            session.dataTask(with: req) { data, _, _ in
                guard let data, !data.isEmpty else {
                    self.sendRaw(conn, status: 502, contentType: "text/plain", body: Data())
                    return
                }
                let parsed = TsToFmp4Remuxer.parseTS(data)
                let sr = meta?.audioRate ?? parsed.audioConfig?.sampleRate ?? 48000
                let seg = TsToFmp4Remuxer.buildMediaSegment(seq: UInt32(idx + 1), parsed: parsed, audioSampleRate: sr)
                self.sendRaw(conn, status: 200, contentType: "video/iso.segment", body: seg)
            }.resume()
            return
        }
        sendRaw(conn, status: 404, contentType: "text/plain", body: Data())
    }

    private func proxyMedia(_ conn: NWConnection, method: String, urlStr: String, headers: [String: String], range: String?, token: String) {
        guard let url = URL(string: urlStr) else { sendRaw(conn, status: 400, contentType: "text/plain", body: Data()); return }
        var req = URLRequest(url: url)
        req.httpMethod = method == "HEAD" ? "HEAD" : "GET"
        headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
        if let range { req.setValue(range, forHTTPHeaderField: "Range") }
        let ctx = StreamRelayContext(conn: conn, urlStr: urlStr, token: token, rewriteHls: self.rewriteHls)
        let task = proxySession.dataTask(with: req)
        proxyDelegate.register(taskId: task.taskIdentifier, ctx: ctx)
        conn.stateUpdateHandler = { state in
            if case .cancelled = state { task.cancel() }
        }
        task.resume()
    }

    private func rewriteHls(_ content: String, token: String, parent: URL) -> String {
        let clean = content.replacingOccurrences(of: "\u{FEFF}", with: "")
        return clean.components(separatedBy: .newlines).map { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            if !t.isEmpty && !t.hasPrefix("#") {
                return childUrl(token: token, parent: parent, child: t)
            }
            if t.contains("URI="), let regex = try? NSRegularExpression(pattern: "URI=([\"'])([^\"']+)\\1") {
                let ns = line as NSString
                let matches = regex.matches(in: line, range: NSRange(location: 0, length: ns.length))
                var res = line
                for m in matches.reversed() {
                    let q = ns.substring(with: m.range(at: 1))
                    let u = ns.substring(with: m.range(at: 2))
                    let rep = "URI=\(q)\(childUrl(token: token, parent: parent, child: u))\(q)"
                    res = (res as NSString).replacingCharacters(in: m.range, with: rep)
                }
                return res
            }
            return line
        }.joined(separator: "\n")
    }

    private func childUrl(token: String, parent: URL, child: String) -> String {
        if child.hasPrefix("data:") { return child }
        let resolved = URL(string: child, relativeTo: parent)?.absoluteString ?? child
        let ext = resolved.lowercased().contains(".m3u8") ? ".m3u8" : ".ts"
        let b64 = Data(resolved.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "http://127.0.0.1:\(port)/hls/\(token)/\(b64)\(ext)"
    }

    private func decodeBase64Url(_ str: String) -> String? {
        var b = str.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b.append("=") }
        return Data(base64Encoded: b).flatMap { String(data: $0, encoding: .utf8) }
    }

    private func srtToVtt(_ raw: String) -> String {
        let clean = raw.replacingOccurrences(of: "\u{FEFF}", with: "")
        if clean.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("WEBVTT") { return clean }
        let norm = clean.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "(\\d{2}:\\d{2}:\\d{2}),(\\d{3})", with: "$1.$2", options: .regularExpression)
        return "WEBVTT\n\n\(norm.trimmingCharacters(in: .whitespacesAndNewlines))\n"
    }

    private func sendJson(_ conn: NWConnection, _ status: Int, _ dict: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: dict)) ?? Data("{}".utf8)
        sendRaw(conn, status: status, contentType: "application/json; charset=utf-8", body: data)
    }

    private func sendRaw(_ conn: NWConnection, status: Int, contentType: String, body: Data, contentRange: String? = nil) {
        var hdr = "HTTP/1.1 \(status) OK\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.count)\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\n"
        if let contentRange { hdr += "Content-Range: \(contentRange)\r\n" }
        hdr += "Connection: close\r\n\r\n"
        var payload = Data(hdr.utf8)
        payload.append(body)
        conn.send(content: payload, completion: .contentProcessed { _ in conn.cancel() })
    }
}
