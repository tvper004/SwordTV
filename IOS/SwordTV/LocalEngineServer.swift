import Foundation
import Network

/// Lightweight local HTTP engine on 127.0.0.1:11472 mirroring V2 engine_server.js + proxy.js.
final class LocalEngineServer {
    struct MediaTarget {
        let url: String
        let headers: [String: String]
    }

    private let portal: PortalClient
    private let port: UInt16
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.swordtv.engine", attributes: .concurrent)
    private var tokens: [String: MediaTarget] = [:]
    private let tokenLock = NSLock()
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 20
        return URLSession(configuration: cfg, delegate: RedirectHandler(), delegateQueue: nil)
    }()

    private final class RedirectHandler: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(request)
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

    private func registerMedia(url: String, headers: [String: String]) -> String {
        let tok = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(24)
        tokenLock.lock()
        tokens[String(tok)] = MediaTarget(url: url, headers: headers)
        tokenLock.unlock()
        return String(tok)
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
                sendJson(conn, 200, ["ok": true, "service": "SwordTV iOS Engine", "version": "2.0.0", "sessionReady": portal.sessionReady])
            case "/api/live/categories":
                sendJson(conn, 200, ["ok": true, "categories": try portal.getLiveCategories()])
            case "/api/live/channels":
                let (chs, hasMore) = try portal.getLiveChannels(catId: query["catId"], page: Int(query["page"] ?? "1") ?? 1, size: Int(query["size"] ?? "50") ?? 50)
                sendJson(conn, 200, ["ok": true, "channels": chs, "hasMore": hasMore])
            case "/api/live/resolve":
                let code = query["code"] ?? query["channelCode"] ?? ""
                let res = try portal.resolveLive(channelCode: code)
                let tok = registerMedia(url: res.url, headers: res.headers)
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
                let tok = registerMedia(url: s["url"] as? String ?? "", headers: s["headers"] as? [String: String] ?? [:])
                let mime = s["mime"] as? String ?? "video/mp4"
                let ext = mime.contains("mp4") ? "video.mp4" : "stream.ts"
                sendJson(conn, 200, ["ok": true, "name": s["name"] ?? "", "streamUrl": "http://127.0.0.1:\(port)/media/\(tok)/\(ext)", "mime": mime, "codec": s["codec"] ?? "", "quality": s["quality"] ?? "", "subtitles": s["subtitles"] ?? []])
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

    private final class StreamRelayDelegate: NSObject, URLSessionDataDelegate {
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

        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(request)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            let http = response as? HTTPURLResponse
            statusCode = http?.statusCode ?? 200
            contentType = (http?.value(forHTTPHeaderField: "Content-Type") ?? "video/mp2t").lowercased()
            responseUrl = response.url ?? URL(string: isHlsCheckUrl)
            isHls = contentType.contains("mpegurl") || isHlsCheckUrl.lowercased().contains(".m3u8")

            if !isHls {
                var hdr = "HTTP/1.1 \(statusCode) OK\r\nContent-Type: \(contentType)\r\n"
                if let cl = http?.value(forHTTPHeaderField: "Content-Length") { hdr += "Content-Length: \(cl)\r\n" }
                if let cr = http?.value(forHTTPHeaderField: "Content-Range") { hdr += "Content-Range: \(cr)\r\n" }
                hdr += "Accept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n"
                headersSent = true
                conn.send(content: Data(hdr.utf8), completion: .contentProcessed { _ in })
            }
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            if isHls {
                hlsBuffer.append(data)
            } else {
                conn.send(content: data, completion: .contentProcessed { _ in })
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if isHls {
                let raw = String(data: hlsBuffer, encoding: .utf8) ?? ""
                let body = Data(rewriteHls(raw, token, responseUrl ?? URL(string: isHlsCheckUrl)!).utf8)
                let hdr = "HTTP/1.1 \(statusCode) OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: \(body.count)\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
                var payload = Data(hdr.utf8)
                payload.append(body)
                conn.send(content: payload, completion: .contentProcessed { _ in self.conn.cancel() })
            } else {
                if !headersSent {
                    let hdr = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
                    conn.send(content: Data(hdr.utf8), completion: .contentProcessed { _ in self.conn.cancel() })
                } else {
                    conn.send(content: nil, isComplete: true, completion: .contentProcessed { _ in self.conn.cancel() })
                }
            }
        }
    }

    private func proxyMedia(_ conn: NWConnection, method: String, urlStr: String, headers: [String: String], range: String?, token: String) {
        guard let url = URL(string: urlStr) else { sendRaw(conn, status: 400, contentType: "text/plain", body: Data()); return }
        var req = URLRequest(url: url)
        req.httpMethod = method == "HEAD" ? "HEAD" : "GET"
        headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
        if let range { req.setValue(range, forHTTPHeaderField: "Range") }
        let delegate = StreamRelayDelegate(conn: conn, urlStr: urlStr, token: token, rewriteHls: self.rewriteHls)
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 20
        let streamSession = URLSession(configuration: cfg, delegate: delegate, delegateQueue: nil)
        streamSession.dataTask(with: req).resume()
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
