import Foundation
import CommonCrypto

/// Native Swift implementation of the SwordTV high-speed portal client (100% aligned with magis.js).
final class PortalClient {
    static let uaCDN = "Ranger/4.9.4-17294ac0"
    private let keyHex = "e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8"
    private let portalCode = "masnew"
    private let appId = "com.android.msandroid"
    private let apkVersion = "49902"
    private let spkgVer = "2025-08-07 05:40:11_36_16_"
    private let apkVerHeader = "43404"
    private let userAgent = "okhttp/3.12.12"
    private let snTokenSalt = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28"
    private let fixedMac = "02:00:00:00:00:00"
    private let hosts = ["osuhk.m3x8o50te.com", "oogoy.f30c96w8.com"]

    private let deviceFixed: [String: Any] = [
        "loginType": "2", "appLanguage": "en", "hardwareInfo": "ranchu",
        "model": "sdk_gphone64_arm64", "product": "sdk_gphone64_arm64",
        "cpu": "arm64-v8a", "B29": "", "reserve1": "", "deviceToken": "",
        "drmId": "", "sdkVer": 36
    ]

    private let rootCodes: [String: String] = [
        "featured": "masnew_featured",
        "movies": "masnew_movies",
        "series": "masnew_series",
        "anime": "masnew_anime",
        "kids": "masnew_kids",
        "free": "masnew_free"
    ]
    private let rootCategory: [String: String] = [
        "featured": "destacado",
        "movies": "pelicula",
        "series": "serie",
        "anime": "anime",
        "kids": "infantil",
        "free": "gratis"
    ]

    private let liveK: [UInt32] = [
        3614090360, 3905402710, 606105819, 3250441966, 4118548399, 1200080426, 2821735955, 4249261313,
        1770035416, 2336552879, 4294925233, 2304563134, 1804603682, 4254626195, 2792965006, 1236535329,
        4129170786, 3225465664, 643717713, 3921069994, 3593408605, 38016083, 3634488961, 3889429448,
        568446438, 3275163606, 4107603335, 1163531501, 2850285829, 4243563512, 1735328473, 2368359562,
        4294588738, 2272392833, 1839030562, 4259657740, 2763975236, 1272893353, 4139469664, 3200236656,
        681279174, 3936430074, 3564056709, 76029189, 3654602809, 3871185381, 530742520, 3299628645,
        4096336452, 1126891415, 2878612391, 4237533241, 1700485571, 2399980690, 4293706877, 2240044497,
        1873313359, 4264355552, 2734768916, 1309151649, 4149444226, 3174756917, 765973179, 3951481745
    ]
    private let liveS: [UInt32] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ]
    private let liveRound1 = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5]
    private let liveSalt = Data([115, 97, 108, 116, 51, 51, 51, 51, 61, 52, 152, 13, 10, 21, 50, 201, 195, 130, 23, 8, 192])

    private(set) var sessionReady = false
    private var snToken = ""
    private var sn = ""
    private var userId = ""
    private var userToken = ""
    private let lock = NSLock()
    private var slbCache: (Date, [String: Any])?
    private var liveCategoriesCache: [[String: Any]]?

    private func hexToData(_ hex: String) -> Data {
        var data = Data()
        var idx = hex.startIndex
        while idx < hex.endIndex {
            let next = hex.index(idx, offsetBy: 2)
            if let b = UInt8(hex[idx..<next], radix: 16) { data.append(b) }
            idx = next
        }
        return data
    }

    private func dataToHex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private func md5Hex(_ str: String) -> String {
        let data = Data(str.utf8)
        var digest = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
        _ = data.withUnsafeBytes { CC_MD5($0.baseAddress, CC_LONG(data.count), &digest) }
        return dataToHex(Data(digest))
    }

    private func randomHex(_ bytes: Int) -> String {
        var buf = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &buf)
        return dataToHex(Data(buf))
    }

    private func crypt3DES(_ data: Data, operation: CCOperation) -> Data? {
        let keyData = hexToData(keyHex)
        let outLen = data.count + kCCBlockSize3DES
        var out = Data(count: outLen)
        var moved = 0
        let status = out.withUnsafeMutableBytes { outPtr in
            data.withUnsafeBytes { inPtr in
                keyData.withUnsafeBytes { keyPtr in
                    CCCrypt(
                        operation,
                        CCAlgorithm(kCCAlgorithm3DES),
                        CCOptions(kCCOptionECBMode | kCCOptionPKCS7Padding),
                        keyPtr.baseAddress, kCCKeySize3DES,
                        nil,
                        inPtr.baseAddress, data.count,
                        outPtr.baseAddress, outLen,
                        &moved
                    )
                }
            }
        }
        guard status == kCCSuccess else { return nil }
        out.count = moved
        return out
    }

    private func encryptBody(_ plainJson: String) -> String {
        guard let raw = plainJson.data(using: .utf8),
              let enc = crypt3DES(raw, operation: CCOperation(kCCEncrypt)) else { return "" }
        let b64 = enc.base64EncodedData()
        return dataToHex(b64)
    }

    private func decryptBlob(_ hexBlob: String) -> String? {
        let b64Data = hexToData(hexBlob.trimmingCharacters(in: .whitespacesAndNewlines))
        guard let b64Str = String(data: b64Data, encoding: .ascii),
              let raw = Data(base64Encoded: b64Str),
              let dec = crypt3DES(raw, operation: CCOperation(kCCDecrypt)) else { return nil }
        return String(data: dec, encoding: .utf8)
    }

    private func liveDigestHex(_ input: Data) -> String {
        var state: [UInt32] = [1732584193, 4023233417, 2562383102, 271733878]
        let r = input.count
        let n = (56 - (r + 1) % 64 + 64) % 64
        var a = Data(count: r + 1 + n + 8)
        a.replaceSubrange(0..<r, with: input)
        a[r] = 0x80
        let bitLen = UInt64(r) * 8
        for s in 0..<8 {
            a[r + 1 + n + s] = UInt8((bitLen >> (8 * s)) & 0xFF)
        }
        for u in stride(from: 0, to: a.count, by: 64) {
            var m = [UInt32](repeating: 0, count: 16)
            for k in 0..<16 {
                let idx = u + 4 * k
                m[k] = UInt32(a[idx]) | (UInt32(a[idx + 1]) << 8) | (UInt32(a[idx + 2]) << 16) | (UInt32(a[idx + 3]) << 24)
            }
            var o = state[0], s = state[1], v = state[2], l = state[3]
            for c in 0..<64 {
                let g = c < 16 ? liveRound1[c] : (c < 32 ? (5 * c + 1) % 16 : (c < 48 ? (3 * c + 5) % 16 : (7 * c) % 16))
                let f: UInt32
                if c < 16 { f = (s & v) | (~s & l) }
                else if c < 32 { f = (l & s) | (~l & v) }
                else if c < 48 { f = s ^ v ^ l }
                else { f = v ^ (s | ~l) }
                let d = f &+ o &+ liveK[c] &+ m[g]
                o = l; l = v; v = s
                let shift = liveS[c]
                s = s &+ ((d << shift) | (d >> (32 - shift)))
            }
            state[0] = state[0] &+ o
            state[1] = state[1] &+ s
            state[2] = state[2] &+ v
            state[3] = state[3] &+ l
        }
        return state.map { w in
            (0..<4).map { String(format: "%02x", (w >> (8 * $0)) & 0xFF) }.joined()
        }.joined()
    }

    private func signO3(token: String, startMoment: Int64) -> String {
        var data = "token=\(token)&sign2_method=sign_o3&instance=0&start_moment=\(startMoment)".data(using: .utf8) ?? Data()
        data.append(liveSalt)
        return liveDigestHex(data)
    }

    private func slbBean(liveCodeList: [String] = ["masnew_live"]) -> [String: Any] {
        return [
            "hasPay": "0", "userIdentity": "1", "type": "merge",
            "appVer": apkVersion, "lang": "es", "encMediaSupported": 1,
            "liveCodeList": liveCodeList, "appParams": "",
            "reserve1": fixedMac, "pipFlag": "0"
        ]
    }

    private func postPortal(path: String, body: [String: Any], includeAuth: Bool = true) throws -> [String: Any] {
        var payload: [String: Any] = [:]
        if includeAuth {
            payload["portalCode"] = portalCode
            payload["userId"] = userId
            payload["userToken"] = userToken
        }
        for (k, v) in body { payload[k] = v }
        for (k, v) in deviceFixed { payload[k] = v }
        payload["apkVersion"] = apkVersion
        payload["sysVersion"] = spkgVer
        payload["appId"] = appId
        payload["sn"] = sn

        let jsonData = try JSONSerialization.data(withJSONObject: payload)
        let encrypted = encryptBody(String(data: jsonData, encoding: .utf8) ?? "{}")
        var lastErr: Error = NSError(domain: "SwordTV", code: -1)
        for host in hosts {
            guard let url = URL(string: "https://\(host)/api/portalCore/\(path)") else { continue }
            var req = URLRequest(url: url, timeoutInterval: 15)
            req.httpMethod = "POST"
            req.httpBody = encrypted.data(using: .utf8)
            req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            req.setValue("application/json;charset=utf-8", forHTTPHeaderField: "Content-Type")
            req.setValue(appId, forHTTPHeaderField: "apk")
            req.setValue(apkVerHeader, forHTTPHeaderField: "apkVer")
            req.setValue(spkgVer, forHTTPHeaderField: "spkgVer")

            let sem = DispatchSemaphore(value: 0)
            var respData: Data?
            var respErr: Error?
            URLSession.shared.dataTask(with: req) { d, _, e in
                respData = d; respErr = e; sem.signal()
            }.resume()
            sem.wait()
            if let e = respErr { lastErr = e; continue }
            guard let d = respData,
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
            if let encStr = obj["data"] as? String,
               let plain = decryptBlob(encStr),
               let pData = plain.data(using: .utf8),
               let decoded = try? JSONSerialization.jsonObject(with: pData) as? [String: Any] {
                return decoded
            }
            if let dict = obj["data"] as? [String: Any] { return dict }
            return obj
        }
        throw lastErr
    }

    func ensureSession() throws {
        if sessionReady && !userToken.isEmpty { return }
        lock.lock()
        defer { lock.unlock() }
        if sessionReady && !userToken.isEmpty { return }
        let fp: [String: Any] = [
            "androidId": randomHex(8), "cpuId": randomHex(8), "serialNumber": randomHex(8),
            "etheMac": fixedMac, "gatewayMac": fixedMac, "wifiMac": fixedMac,
            "board": "goldfish_arm64", "brand": "google", "cpuAbi": "arm64-v8a",
            "device": "emu64a", "diskInfo": "8GB", "display": "sdk_gphone64_arm64",
            "fingerprint": "google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys",
            "hardware": "ranchu", "host": "abfarm", "manufacturer": "Google",
            "model": "sdk_gphone64_arm64", "product": "sdk_gphone64_arm64",
            "ramSize": "4GB", "romSize": "8GB", "tags": "release-keys", "verId": ""
        ]
        let snData = try postPortal(path: "v3/snToken", body: fp, includeAuth: false)
        snToken = (snData["snToken"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawSn = (snData["sn"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        sn = (rawSn.isEmpty ? md5Hex(snToken + snTokenSalt) : rawSn).lowercased()
        let active = try postPortal(path: "v8/active", body: [
            "snToken": snToken, "authVersion": "", "authCode": "", "preCode": "",
            "macAddr": fixedMac, "reserve1": "", "openNum": 4, "channel": "default", "matadata": "", "signdata": ""
        ], includeAuth: false)
        userId = (active["userId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        userToken = (active["userToken"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        sessionReady = !userToken.isEmpty
    }

    func getLiveCategories() throws -> [[String: Any]] {
        if let c = liveCategoriesCache, !c.isEmpty { return c }
        try ensureSession()
        let data = try postPortal(path: "getNextColumns", body: [
            "columnCode": "masnew_live", "pageNum": 1, "pageSize": 50, "version": ""
        ])
        let list = data["recommendList"] as? [[String: Any]] ?? []
        let out: [[String: Any]] = list.enumerated().compactMap { (i, o) in
            guard let cid = o["columnId"] else { return nil }
            return [
                "id": "\(cid)",
                "name": (o["name"] as? String) ?? (o["title"] as? String) ?? "Categoría \(i + 1)",
                "code": (o["code"] as? String) ?? ""
            ]
        }
        liveCategoriesCache = out
        return out
    }

    func getLiveChannels(catId: String?, page: Int, size: Int) throws -> ([[String: Any]], Bool) {
        try ensureSession()
        let data = try postPortal(path: "v6/getLiveData", body: [
            "columnId": catId ?? "76182", "dataVersion": "", "pageSize": min(50, max(1, size)), "pageNum": max(1, page), "expireTimeStr": ""
        ])
        let list = data["channelList"] as? [[String: Any]] ?? []
        let out = list.enumerated().compactMap { (idx, ch) -> [String: Any]? in
            guard let code = ch["channelCode"] as? String, !code.isEmpty else { return nil }
            let pList = (ch["posterList"] as? [[String: Any]])?.first?["fileUrl"] as? String ?? ""
            let logo = (ch["posterUrl"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                ?? (pList.isEmpty ? nil : pList)
                ?? (ch["icon"] as? String)
                ?? (ch["poster"] as? String ?? "")
            return [
                "channelCode": code,
                "name": ch["name"] as? String ?? "",
                "logo": logo,
                "num": ch["channelNumber"] as? Int ?? (idx + 1)
            ]
        }
        return (out, list.count >= size)
    }

    func resolveLive(channelCode: String) throws -> (url: String, name: String, headers: [String: String]) {
        try ensureSession()
        let play = try postPortal(path: "v4/startPlayLive", body: ["channelCode": channelCode, "columnId": 0, "type": "1"])
        let addrs = play["liveAddressList"] as? [[String: Any]] ?? []
        let chosen = addrs.first { ($0["license"] as? String)?.isEmpty == false } ?? addrs.first
        guard let lic = chosen?["license"] as? String, !lic.isEmpty else { throw NSError(domain: "SwordTV", code: 404) }
        let playCode = (chosen?["playCode"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? channelCode
        let slb = try postPortal(path: "v14/getSlbInfo", body: slbBean(liveCodeList: [channelCode]))
        for c in (slb["cdn_list"] as? [[String: Any]] ?? []) where (c["tag"] as? String) == "live" {
            let host = (c["main_addr"] as? String ?? "").replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "").components(separatedBy: "/").first ?? ""
            for u in (c["url_list"] as? [[String: Any]] ?? []) {
                let authBase = u["url"] as? String ?? ""
                if (u["sign_type"] as? String) == "cfl" || authBase.contains("sign_type=cfl") {
                    let token = authBase.range(of: "token=([0-9a-fA-F]{32})", options: .regularExpression).map { String(authBase[$0].dropFirst(6)) } ?? ""
                    let moment = Int64(Date().timeIntervalSince1970 * 1000)
                    let sign2 = signO3(token: token, startMoment: moment)
                    return ("http://\(host)/live/\(playCode).m3u8", play["name"] as? String ?? channelCode, [
                        "Content-Auth": "\(authBase)&sign2_method=sign_o3&instance=0&start_moment=\(moment)&sign2=\(sign2)",
                        "Content-License": lic, "User-Agent": Self.uaCDN, "App": appId, "App-Version": apkVersion
                    ])
                }
            }
        }
        throw NSError(domain: "SwordTV", code: 502)
    }

    func home(category: String) throws -> [[String: Any]] {
        let key = rootCodes[category] != nil ? category : "movies"
        try ensureSession()
        let data = try postPortal(path: "getNextColumns", body: ["columnCode": rootCodes[key] ?? "masnew_movies", "pageNum": 1, "pageSize": 60, "version": ""])
        var out: [[String: Any]] = []
        let cat = rootCategory[key] ?? ""
        for row in (data["recommendList"] as? [[String: Any]] ?? []) {
            for a in (row["assetList"] as? [[String: Any]] ?? []) {
                if let m = mapAsset(a, cat: cat) { out.append(m) }
            }
        }
        return out
    }

    func search(query: String) throws -> [[String: Any]] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return [] }
        try ensureSession()
        let data = try postPortal(path: "v3/searchByName", body: ["value": q, "type": "0", "columnId": "", "filter": "", "pageNum": 1, "pageSize": 20])
        return (data["searchItemList"] as? [[String: Any]] ?? []).compactMap { mapAsset($0, cat: "") }
    }

    func detail(contentId: String) throws -> [String: Any] {
        try ensureSession()
        let data = try postPortal(path: "v4/getItemData", body: [
            "contentId": contentId, "type": "0", "sortType": "0", "language": "en", "macAddr": fixedMac
        ])
        let asset = (data["assetData"] as? [String: Any]) ?? data
        let item = mapAsset(asset, cat: "") ?? ["id": contentId]
        let eps = (asset["simpleProgramList"] as? [[String: Any]] ?? []).enumerated().map { (i, e) -> [String: Any] in
            [
                "id": e["contentId"] ?? "",
                "title": e["name"] ?? "Capítulo \(i + 1)",
                "name": e["name"] ?? "",
                "number": e["seriesNumber"] ?? (i + 1),
                "duration": e["duration"] ?? "",
                "quality": e["quality"] ?? "1080p HD",
                "picture": e["picture"] ?? e["poster"] ?? "",
                "description": e["description"] ?? ""
            ]
        }
        let seasons = (asset["sameSeasonSeriesList"] as? [[String: Any]] ?? []).compactMap { s -> [String: Any]? in
            guard let sid = s["contentId"] as? String, !sid.isEmpty else { return nil }
            return ["id": sid, "number": s["seasonNumber"] ?? 1]
        }
        return ["item": item, "episodes": eps, "seasons": seasons]
    }

    func resolveVod(contentId: String, seriesId: String) throws -> [String: Any] {
        try ensureSession()
        let play = try postPortal(path: "v10/startPlayVOD", body: [
            "contentId": contentId, "seriesContentId": seriesId,
            "startTime": 0, "type": "1", "columnId": 0, "authType": ""
        ])
        guard let ep = (play["episodeList"] as? [[String: Any]])?.first else {
            throw NSError(domain: "SwordTV", code: 404, userInfo: [NSLocalizedDescriptionKey: "Sin episodios"])
        }
        var tracks: [[String: Any]] = []
        for tm in (ep["totalMovieList"] as? [[String: Any]] ?? []) {
            for m in (tm["movieList"] as? [[String: Any]] ?? []) where (m["contentId"] as? String)?.isEmpty == false {
                tracks.append(m)
            }
        }
        guard let track = tracks.first else {
            throw NSError(domain: "SwordTV", code: 404, userInfo: [NSLocalizedDescriptionKey: "Sin pistas de video"])
        }
        let lic = ((track["licenseList"] as? [[String: Any]])?.first?["license"] as? String) ?? ""
        let slb: [String: Any]
        if let c = slbCache, Date().timeIntervalSince(c.0) < 300 { slb = c.1 }
        else {
            slb = try postPortal(path: "v14/getSlbInfo", body: slbBean())
            slbCache = (Date(), slb)
        }
        for c in (slb["cdn_list"] as? [[String: Any]] ?? []) where (c["tag"] as? String) == "vod" {
            let host = (c["main_addr"] as? String ?? "").replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "").components(separatedBy: "/").first ?? ""
            for u in (c["url_list"] as? [[String: Any]] ?? []) {
                let auth = u["url"] as? String ?? ""
                if (u["tag"] as? String) == "free" && ((u["sign_type"] as? String) == "cfl" || auth.contains("sign_type=cfl")) {
                    let ext = ((track["videoFormat"] as? String ?? "").lowercased() == "ts") ? "ts" : "mp4"
                    let subs: [[String: Any]] = (ep["subtitleList"] as? [[String: Any]] ?? []).compactMap { s in
                        guard let f = (s["file"] as? [[String: Any]])?.first, let su = f["url"] as? String, !su.isEmpty else { return nil }
                        return ["lang": s["language"] ?? "es", "url": su, "format": s["fileType"] ?? "srt"]
                    }
                    return [
                        "url": "https://\(host)/vod/\(track["contentId"] ?? "")_media.\(ext)",
                        "mime": ext == "ts" ? "video/mp2t" : "video/mp4",
                        "codec": track["encodeFormat"] ?? "H264",
                        "quality": track["quality"] ?? "1080p",
                        "name": play["name"] ?? "",
                        "headers": ["Content-Auth": auth, "Content-License": lic, "User-Agent": Self.uaCDN, "App": appId, "App-Version": apkVersion],
                        "subtitles": subs
                    ]
                }
            }
        }
        throw NSError(domain: "SwordTV", code: 502)
    }

    private func imageOf(_ e: [String: Any], _ fileType: String) -> String {
        for p in (e["posterList"] as? [[String: Any]] ?? []) {
            if (p["fileType"] as? String) == fileType, let u = p["fileUrl"] as? String, !u.isEmpty {
                return u.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return ""
    }

    private func mapAsset(_ e: [String: Any], cat: String) -> [String: Any]? {
        guard let cid = e["contentId"] as? String, !cid.isEmpty else { return nil }
        let pType = e["programType"] as? String ?? "movie"
        let isSeries = pType == "teleplay" || pType == "series" || (e["volumnCount"] as? Int ?? 0) > 1
        let poster = [imageOf(e, "poster"), imageOf(e, "thumbnail"), e["icon"] as? String ?? "", e["poster"] as? String ?? ""]
            .first { !$0.isEmpty } ?? ""
        let backdrop = [imageOf(e, "stage"), imageOf(e, "thumbnail"), e["stage"] as? String ?? "", poster]
            .first { !$0.isEmpty } ?? ""
        return [
            "id": cid, "title": e["name"] ?? e["title"] ?? "", "alias": e["alias"] ?? "",
            "category": cat, "kind": isSeries ? "serie" : "película", "type": isSeries ? "teleplay" : pType,
            "score": e["score"] ?? "8.5", "year": String((e["releaseTime"] as? String ?? "2024").prefix(4)),
            "poster": poster, "backdrop": backdrop,
            "synopsis": e["description"] ?? "", "portal": true
        ]
    }
}
