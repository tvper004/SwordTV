package com.swordtv.app

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Lightweight local HTTP engine on 127.0.0.1:11472 mirroring V2 engine_server.js + proxy.js.
 * Follows HTTP redirects, rewrites HLS manifests, injects portal headers, and converts SRT -> WebVTT.
 */
class LocalEngineServer(private val portal: PortalClient, private val port: Int = 11472) {

    data class MediaTarget(val url: String, val headers: Map<String, String>)

    private val pool = Executors.newCachedThreadPool()
    private val tokens = ConcurrentHashMap<String, MediaTarget>()
    private var serverSocket: ServerSocket? = null
    @Volatile private var running = false

    fun start() {
        if (running) return
        running = true
        pool.execute {
            try {
                serverSocket = ServerSocket(port, 64, InetAddress.getByName("127.0.0.1"))
                while (running) {
                    val client = serverSocket?.accept() ?: break
                    pool.execute { handleClient(client) }
                }
            } catch (_: Exception) {
            }
        }
        pool.execute { runCatching { portal.ensureSession() } }
    }

    fun stop() {
        running = false
        runCatching { serverSocket?.close() }
    }

    private fun randomToken(): String {
        val b = ByteArray(12)
        SecureRandom().nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    private fun registerMedia(url: String, headers: JSONObject?): String {
        val hdrMap = mutableMapOf<String, String>()
        headers?.keys()?.forEach { k -> hdrMap[k] = headers.optString(k) }
        val token = randomToken()
        tokens[token] = MediaTarget(url, hdrMap)
        return token
    }

    private fun handleClient(socket: Socket) {
        socket.use { s ->
            s.soTimeout = 25000
            val input = BufferedInputStream(s.getInputStream())
            val output = s.getOutputStream()
            val reqLine = readLine(input) ?: return
            val parts = reqLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0].uppercase()
            val rawTarget = parts[1]
            val reqHeaders = mutableMapOf<String, String>()
            while (true) {
                val h = readLine(input) ?: break
                if (h.isEmpty()) break
                val idx = h.indexOf(':')
                if (idx > 0) reqHeaders[h.substring(0, idx).trim().lowercase()] = h.substring(idx + 1).trim()
            }

            if (method == "OPTIONS") {
                writeHeaders(output, 204, "text/plain", 0)
                return
            }

            val qIdx = rawTarget.indexOf('?')
            val path = if (qIdx >= 0) rawTarget.substring(0, qIdx) else rawTarget
            val query = parseQuery(if (qIdx >= 0) rawTarget.substring(qIdx + 1) else "")

            try {
                when {
                    path == "/ping" || path == "/api/ping" -> {
                        sendJson(output, 200, JSONObject().apply {
                            put("ok", true)
                            put("service", "SwordTV Android Engine")
                            put("version", "2.0.0")
                            put("sessionReady", portal.sessionReady)
                            put("platform", "android")
                            put("deviceModel", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim())
                            put("chip", android.os.Build.HARDWARE.ifEmpty { "MediaCodec" })
                        })
                    }
                    path == "/api/live/categories" -> {
                        val cats = portal.getLiveCategories()
                        sendJson(output, 200, JSONObject().put("ok", true).put("categories", cats))
                    }
                    path == "/api/live/channels" -> {
                        val (chs, hasMore) = portal.getLiveChannels(
                            query["catId"],
                            query["page"]?.toIntOrNull() ?: 1,
                            query["size"]?.toIntOrNull() ?: 50
                        )
                        sendJson(output, 200, JSONObject().put("ok", true).put("channels", chs).put("hasMore", hasMore))
                    }
                    path == "/api/live/resolve" -> {
                        val code = query["code"] ?: query["channelCode"] ?: throw IllegalArgumentException("Missing code")
                        val stream = portal.resolveLive(code)
                        val tok = registerMedia(stream.getString("url"), stream.optJSONObject("headers"))
                        val localUrl = "http://127.0.0.1:$port/media/$tok/stream.m3u8"
                        sendJson(output, 200, JSONObject().apply {
                            put("ok", true)
                            put("name", stream.optString("name"))
                            put("streamUrl", localUrl)
                            put("mime", stream.optString("mime"))
                        })
                    }
                    path == "/api/live/proxy" -> {
                        val rawUrl = query["url"] ?: throw IllegalArgumentException("Missing url")
                        val tok = registerMedia(rawUrl, JSONObject().put("User-Agent", PortalClient.UA_CDN))
                        val ext = if (rawUrl.contains(".m3u8", true)) "stream.m3u8" else "stream.ts"
                        sendJson(output, 200, JSONObject().apply {
                            put("ok", true)
                            put("streamUrl", "http://127.0.0.1:$port/media/$tok/$ext")
                        })
                    }
                    path == "/api/vod/catalog" -> {
                        val cat = query["category"] ?: "movies"
                        val items = portal.home(cat)
                        sendJson(output, 200, JSONObject().put("ok", true).put("root", cat).put("items", items))
                    }
                    path == "/api/vod/search" -> {
                        val q = query["q"] ?: query["query"] ?: ""
                        val items = portal.search(q)
                        sendJson(output, 200, JSONObject().put("ok", true).put("items", items))
                    }
                    path == "/api/vod/detail" -> {
                        val id = query["id"] ?: query["contentId"] ?: throw IllegalArgumentException("Missing id")
                        val detail = portal.detail(id)
                        sendJson(output, 200, detail.put("ok", true))
                    }
                    path == "/api/vod/resolve" -> {
                        val id = query["id"] ?: query["contentId"] ?: throw IllegalArgumentException("Missing id")
                        val sid = query["seriesId"] ?: query["seriesContentId"] ?: ""
                        val stream = portal.resolveVod(id, sid)
                        val tok = registerMedia(stream.getString("url"), stream.optJSONObject("headers"))
                        val ext = if (stream.optString("mime").contains("mp4")) "video.mp4" else "stream.ts"
                        sendJson(output, 200, JSONObject().apply {
                            put("ok", true)
                            put("name", stream.optString("name"))
                            put("streamUrl", "http://127.0.0.1:$port/media/$tok/$ext")
                            put("mime", stream.optString("mime"))
                            put("codec", stream.optString("codec"))
                            put("quality", stream.optString("quality"))
                            put("subtitles", stream.optJSONArray("subtitles") ?: JSONArray())
                        })
                    }
                    path == "/sub" || path == "/api/vod/sub" -> {
                        val subUrl = query["url"] ?: throw IllegalArgumentException("Missing url")
                        val (code, _, body) = fetchWithRedirects(subUrl, mapOf("User-Agent" to PortalClient.UA_CDN), null)
                        if (code !in 200..299) {
                            writeResponse(output, 502, "text/plain", "Subtitle unavailable".toByteArray())
                        } else {
                            val vtt = srtToVtt(String(body, Charsets.UTF_8)).toByteArray(Charsets.UTF_8)
                            writeResponse(output, 200, "text/vtt; charset=utf-8", vtt)
                        }
                    }
                    path == "/api/vod/abort" || path == "/api/live/abort" || path == "/api/log" -> {
                        sendJson(output, 200, JSONObject().put("ok", true))
                    }
                    path.startsWith("/media/") -> {
                        val tok = path.removePrefix("/media/").substringBefore('/')
                        val target = tokens[tok] ?: return writeResponse(output, 404, "text/plain", "expired".toByteArray())
                        proxyMedia(output, method, target.url, target.headers, reqHeaders["range"], tok)
                    }
                    path.startsWith("/hls/") -> {
                        val rest = path.removePrefix("/hls/")
                        val tok = rest.substringBefore('/')
                        val b64 = rest.substringAfter('/').substringBefore('.')
                        val target = tokens[tok] ?: return writeResponse(output, 404, "text/plain", "expired".toByteArray())
                        val decodedUrl = String(Base64.decode(b64, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8)
                        proxyMedia(output, method, decodedUrl, target.headers, reqHeaders["range"], tok)
                    }
                    else -> sendJson(output, 404, JSONObject().put("ok", false).put("error", "Not found"))
                }
            } catch (e: Exception) {
                sendJson(output, 500, JSONObject().put("ok", false).put("error", e.message ?: "Engine error"))
            }
        }
    }

    private fun proxyMedia(
        output: OutputStream,
        method: String,
        targetUrl: String,
        headers: Map<String, String>,
        range: String?,
        token: String,
        hops: Int = 0
    ) {
        val conn = (URL(targetUrl).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            requestMethod = if (method == "HEAD") "HEAD" else "GET"
            connectTimeout = 15000
            readTimeout = 25000
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
            if (range != null) setRequestProperty("Range", range)
        }
        val code = conn.responseCode
        if (code in 300..399 && hops < 4) {
            val loc = conn.getHeaderField("Location")
            conn.disconnect()
            if (!loc.isNullOrEmpty()) {
                val nextUrl = URL(URL(targetUrl), loc).toString()
                return proxyMedia(output, method, nextUrl, headers, range, token, hops + 1)
            }
        }
        val ctype = (conn.contentType ?: "").lowercase()
        val isHls = ctype.contains("mpegurl") || targetUrl.contains(".m3u8", true)
        if (method == "HEAD") {
            writeHeaders(output, code, if (isHls) "application/vnd.apple.mpegurl" else (conn.contentType ?: "video/mp2t"), conn.contentLengthLong)
            conn.disconnect()
            return
        }
        if (isHls) {
            val raw = (if (code >= 400) conn.errorStream else conn.inputStream)?.readBytes()?.toString(Charsets.UTF_8) ?: ""
            conn.disconnect()
            val rewritten = rewriteHls(raw, token, targetUrl).toByteArray(Charsets.UTF_8)
            writeResponse(output, code, "application/vnd.apple.mpegurl", rewritten)
            return
        }
        val stream = if (code >= 400) conn.errorStream else conn.inputStream
        val contentRange = conn.getHeaderField("Content-Range")
        writeHeaders(output, code, conn.contentType ?: "video/mp2t", conn.contentLengthLong, contentRange)
        stream?.use { it.copyTo(output, 16384) }
        conn.disconnect()
    }

    private fun rewriteHls(content: String, token: String, parentUrl: String): String {
        val parent = URL(parentUrl)
        return content.removePrefix("\uFEFF").lines().joinToString("\n") { line ->
            val trimmed = line.trim()
            if (trimmed.isNotEmpty() && !trimmed.startsWith("#")) {
                childProxyUrl(token, parent, trimmed)
            } else if (trimmed.contains("URI=")) {
                Regex("""URI=(["'])([^"']+)\1""").replace(line) { m ->
                    val q = m.groupValues[1]
                    "URI=$q${childProxyUrl(token, parent, m.groupValues[2])}$q"
                }
            } else line
        }
    }

    private fun childProxyUrl(token: String, parent: URL, child: String): String {
        if (child.startsWith("data:")) return child
        val resolved = URL(parent, child).toString()
        val ext = if (resolved.contains(".m3u8", true)) ".m3u8" else ".ts"
        val b64 = Base64.encodeToString(resolved.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        return "http://127.0.0.1:$port/hls/$token/$b64$ext"
    }

    private fun fetchWithRedirects(url: String, headers: Map<String, String>, range: String?, hops: Int = 0): Triple<Int, String, ByteArray> {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 10000
            readTimeout = 15000
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
            if (range != null) setRequestProperty("Range", range)
        }
        val code = conn.responseCode
        if (code in 300..399 && hops < 4) {
            val loc = conn.getHeaderField("Location")
            conn.disconnect()
            if (!loc.isNullOrEmpty()) return fetchWithRedirects(URL(URL(url), loc).toString(), headers, range, hops + 1)
        }
        val body = (if (code >= 400) conn.errorStream else conn.inputStream)?.readBytes() ?: ByteArray(0)
        val ctype = conn.contentType ?: "application/octet-stream"
        conn.disconnect()
        return Triple(code, ctype, body)
    }

    private fun srtToVtt(raw: String): String {
        val clean = raw.removePrefix("\uFEFF")
        if (clean.trimStart().startsWith("WEBVTT")) return clean
        val normalized = clean.replace("\r\n", "\n").replace("\r", "\n")
            .replace(Regex("""(\d{2}:\d{2}:\d{2}),(\d{3})"""), "$1.$2")
        return "WEBVTT\n\n${normalized.trim()}\n"
    }

    private fun sendJson(output: OutputStream, code: Int, json: JSONObject) {
        writeResponse(output, code, "application/json; charset=utf-8", json.toString().toByteArray(Charsets.UTF_8))
    }

    private fun writeResponse(output: OutputStream, code: Int, contentType: String, body: ByteArray) {
        writeHeaders(output, code, contentType, body.size.toLong())
        output.write(body)
        output.flush()
    }

    private fun writeHeaders(output: OutputStream, code: Int, contentType: String, length: Long, contentRange: String? = null) {
        val sb = StringBuilder()
        sb.append("HTTP/1.1 $code OK\r\n")
        sb.append("Content-Type: $contentType\r\n")
        if (length >= 0) sb.append("Content-Length: $length\r\n")
        if (contentRange != null) sb.append("Content-Range: $contentRange\r\n")
        sb.append("Accept-Ranges: bytes\r\n")
        sb.append("Access-Control-Allow-Origin: *\r\n")
        sb.append("Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n")
        sb.append("Access-Control-Allow-Headers: *\r\n")
        sb.append("Connection: close\r\n\r\n")
        output.write(sb.toString().toByteArray(Charsets.US_ASCII))
    }

    private fun parseQuery(qs: String): Map<String, String> {
        if (qs.isEmpty()) return emptyMap()
        return qs.split("&").mapNotNull { pair ->
            val idx = pair.indexOf('=')
            if (idx > 0) URLDecoder.decode(pair.substring(0, idx), "UTF-8") to URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
            else null
        }.toMap()
    }

    private fun readLine(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1) return if (buf.size() == 0) null else buf.toString("UTF-8")
            if (b == '\n'.code) break
            if (b != '\r'.code) buf.write(b)
        }
        return buf.toString("UTF-8")
    }
}
