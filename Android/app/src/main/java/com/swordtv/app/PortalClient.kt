package com.swordtv.app

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/**
 * Native Kotlin implementation of the SwordTV high-speed portal client (adapted from magis.js).
 */
class PortalClient {
    companion object {
        private const val KEY_HEX = "e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8"
        private const val PORTAL_CODE = "masnew"
        private const val APP_ID = "com.android.msandroid"
        private const val APK_VERSION = "49902"
        private const val SPKG_VER = "2025-08-07 05:40:11_36_16_"
        private const val APK_VER_HEADER = "43404"
        private const val USER_AGENT = "okhttp/3.12.12"
        private const val SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28"
        private const val FIXED_MAC = "02:00:00:00:00:00"
        const val UA_CDN = "Ranger/4.9.4-17294ac0"

        private val HOSTS = mutableListOf("osuhk.m3x8o50te.com", "oogoy.f30c96w8.com")
        private val DEVICE_FIXED = mapOf<String, Any>(
            "loginType" to "2", "appLanguage" to "en", "hardwareInfo" to "ranchu",
            "model" to "sdk_gphone64_arm64", "product" to "sdk_gphone64_arm64",
            "cpu" to "arm64-v8a", "B29" to "", "reserve1" to "", "deviceToken" to "",
            "drmId" to "", "sdkVer" to 36
        )
        private val ROOT_CODES = mapOf(
            "featured" to "masnew_featured",
            "movies" to "masnew_movies",
            "series" to "masnew_series",
            "anime" to "masnew_anime",
            "kids" to "masnew_kids",
            "free" to "masnew_free"
        )
        private val ROOT_CATEGORY = mapOf(
            "featured" to "destacado",
            "movies" to "pelicula",
            "series" to "serie",
            "anime" to "anime",
            "kids" to "infantil",
            "free" to "gratis"
        )

        private val LIVE_K = longArrayOf(
            3614090360L, 3905402710L, 606105819L, 3250441966L, 4118548399L, 1200080426L, 2821735955L, 4249261313L,
            1770035416L, 2336552879L, 4294925233L, 2304563134L, 1804603682L, 4254626195L, 2792965006L, 1236535329L,
            4129170786L, 3225465664L, 643717713L, 3921069994L, 3593408605L, 38016083L, 3634488961L, 3889429448L,
            568446438L, 3275163606L, 4107603335L, 1163531501L, 2850285829L, 4243563512L, 1735328473L, 2368359562L,
            4294588738L, 2272392833L, 1839030562L, 4259657740L, 2763975236L, 1272893353L, 4139469664L, 3200236656L,
            681279174L, 3936430074L, 3564056709L, 76029189L, 3654602809L, 3871185381L, 530742520L, 3299628645L,
            4096336452L, 1126891415L, 2878612391L, 4237533241L, 1700485571L, 2399980690L, 4293706877L, 2240044497L,
            1873313359L, 4264355552L, 2734768916L, 1309151649L, 4149444226L, 3174756917L, 765973179L, 3951481745L
        )
        private val LIVE_S = intArrayOf(
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
        )
        private val LIVE_ROUND1 = intArrayOf(10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5)
        private val LIVE_SALT = byteArrayOf(
            115, 97, 108, 116, 51, 51, 51, 51, 61, 52, -104, 13, 10, 21, 50, -55, -61, -126, 23, 8, -64
        )
    }

    @Volatile var sessionReady = false
    private var snToken = ""
    private var sn = ""
    private var userId = ""
    private var userToken = ""
    private val sessionLock = Any()

    private val treeCache = ConcurrentHashMap<String, Pair<Long, JSONArray>>()
    private val searchCache = ConcurrentHashMap<String, Pair<Long, JSONArray>>()
    private var slbCache: Pair<Long, JSONObject>? = null
    private var liveCategoriesCache: JSONArray? = null

    private fun hexToBytes(hex: String): ByteArray {
        val len = hex.length
        val out = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            out[i / 2] = ((Character.digit(hex[i], 16) shl 4) + Character.digit(hex[i + 1], 16)).toByte()
            i += 2
        }
        return out
    }

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun randomHex(byteCount: Int): String {
        val b = ByteArray(byteCount)
        SecureRandom().nextBytes(b)
        return bytesToHex(b)
    }

    private fun encryptBody(plainJson: String): String {
        val key = SecretKeySpec(hexToBytes(KEY_HEX), "DESede")
        val cipher = Cipher.getInstance("DESede/ECB/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val enc = cipher.doFinal(plainJson.toByteArray(Charsets.UTF_8))
        val b64 = Base64.encodeToString(enc, Base64.NO_WRAP).toByteArray(Charsets.US_ASCII)
        return bytesToHex(b64)
    }

    private fun decryptBlob(hexBlob: String): String {
        val b64Bytes = hexToBytes(hexBlob.trim())
        val raw = Base64.decode(String(b64Bytes, Charsets.US_ASCII), Base64.DEFAULT)
        val key = SecretKeySpec(hexToBytes(KEY_HEX), "DESede")
        val cipher = Cipher.getInstance("DESede/ECB/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, key)
        return String(cipher.doFinal(raw), Charsets.UTF_8)
    }

    private fun liveDigestHex(input: ByteArray): String {
        val state = longArrayOf(1732584193L, 4023233417L, 2562383102L, 271733878L)
        val r = input.size
        val n = (56 - (r + 1) % 64 + 64) % 64
        val a = ByteArray(r + 1 + n + 8)
        System.arraycopy(input, 0, a, 0, r)
        a[r] = 0x80.toByte()
        val bitLen = r.toLong() * 8L
        for (s in 0 until 8) {
            a[r + 1 + n + s] = ((bitLen ushr (8 * s)) and 0xFF).toByte()
        }
        for (u in a.indices step 64) {
            val m = LongArray(16)
            for (k in 0 until 16) {
                val idx = u + 4 * k
                m[k] = ((a[idx].toInt() and 0xFF).toLong()) or
                    ((a[idx + 1].toInt() and 0xFF).toLong() shl 8) or
                    ((a[idx + 2].toInt() and 0xFF).toLong() shl 16) or
                    ((a[idx + 3].toInt() and 0xFF).toLong() shl 24)
            }
            var o = state[0]; var s = state[1]; var v = state[2]; var l = state[3]
            for (c in 0 until 64) {
                val g = when {
                    c < 16 -> LIVE_ROUND1[c]
                    c < 32 -> (5 * c + 1) % 16
                    c < 48 -> (3 * c + 5) % 16
                    else -> (7 * c) % 16
                }
                val f = when {
                    c < 16 -> (s and v) or (s.inv() and l)
                    c < 32 -> (l and s) or (l.inv() and v)
                    c < 48 -> s xor v xor l
                    else -> v xor (s or l.inv())
                } and 0xFFFFFFFFL
                val d = (f + o + LIVE_K[c] + m[g]) and 0xFFFFFFFFL
                o = l; l = v; v = s
                val rot = ((d shl LIVE_S[c]) or (d ushr (32 - LIVE_S[c]))) and 0xFFFFFFFFL
                s = (s + rot) and 0xFFFFFFFFL
            }
            state[0] = (state[0] + o) and 0xFFFFFFFFL
            state[1] = (state[1] + s) and 0xFFFFFFFFL
            state[2] = (state[2] + v) and 0xFFFFFFFFL
            state[3] = (state[3] + l) and 0xFFFFFFFFL
        }
        val sb = StringBuilder()
        for (c in 0 until 4) {
            for (d in 0 until 4) {
                sb.append("%02x".format((state[c] ushr (8 * d)) and 0xFF))
            }
        }
        return sb.toString()
    }

    private fun signO3(token: String, startMoment: Long): String {
        val base = "token=$token&sign2_method=sign_o3&instance=0&start_moment=$startMoment".toByteArray(Charsets.UTF_8)
        return liveDigestHex(base + LIVE_SALT)
    }

    private fun slbBean(liveCodeList: List<String> = listOf("masnew_live")): JSONObject = JSONObject().apply {
        put("hasPay", "0")
        put("userIdentity", "1")
        put("type", "merge")
        put("appVer", APK_VERSION)
        put("lang", "es")
        put("encMediaSupported", 1)
        put("liveCodeList", JSONArray(liveCodeList))
        put("appParams", "")
        put("reserve1", FIXED_MAC)
        put("pipFlag", "0")
    }

    private fun postPortal(path: String, body: JSONObject, includeAuth: Boolean = true): JSONObject {
        val payload = JSONObject()
        if (includeAuth) {
            payload.put("portalCode", PORTAL_CODE)
            payload.put("userId", userId)
            payload.put("userToken", userToken)
        }
        val keys = body.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            payload.put(k, body.get(k))
        }
        for ((k, v) in DEVICE_FIXED) payload.put(k, v)
        payload.put("apkVersion", APK_VERSION)
        payload.put("sysVersion", SPKG_VER)
        payload.put("appId", APP_ID)
        payload.put("sn", sn)
        val encrypted = encryptBody(payload.toString())
        var lastError: Exception? = null
        for (host in HOSTS.toList()) {
            try {
                val conn = (URL("https://$host/api/portalCore/$path").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 12000
                    readTimeout = 20000
                    doOutput = true
                    setRequestProperty("User-Agent", USER_AGENT)
                    setRequestProperty("Content-Type", "application/json;charset=utf-8")
                    setRequestProperty("apk", APP_ID)
                    setRequestProperty("apkVer", APK_VER_HEADER)
                    setRequestProperty("spkgVer", SPKG_VER)
                }
                conn.outputStream.use { it.write(encrypted.toByteArray(Charsets.UTF_8)) }
                val raw = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(raw)
                val code = json.optString("returnCode")
                if (code != "0" && code != "200" && code.isNotEmpty() && !json.has("data")) {
                    throw IllegalStateException(json.optString("errorMessage", "Portal error $code"))
                }
                val dataVal = json.opt("data")
                return when (dataVal) {
                    is String -> JSONObject(decryptBlob(dataVal))
                    is JSONObject -> dataVal
                    else -> json
                }
            } catch (e: Exception) {
                lastError = e
            }
        }
        throw lastError ?: IllegalStateException("Portal unreachable")
    }

    fun ensureSession() {
        if (sessionReady && userToken.isNotEmpty()) return
        synchronized(sessionLock) {
            if (sessionReady && userToken.isNotEmpty()) return
            val fp = JSONObject().apply {
                put("androidId", randomHex(8))
                put("cpuId", randomHex(8))
                put("serialNumber", randomHex(8))
                put("etheMac", randomHex(6).chunked(2).joinToString(":"))
                put("gatewayMac", randomHex(6).chunked(2).joinToString(":"))
                put("wifiMac", randomHex(6).chunked(2).joinToString(":"))
                put("board", "goldfish_arm64")
                put("brand", "google")
                put("cpuAbi", "arm64-v8a")
                put("device", "emu64a")
                put("diskInfo", "8GB")
                put("hardware", "ranchu")
                put("manufacturer", "Google")
                put("model", "sdk_gphone64_arm64")
                put("product", "sdk_gphone64_arm64")
                put("ramSize", "4GB")
                put("romSize", "8GB")
                put("sdkVer", 36)
            }
            val snData = postPortal("v3/snToken", fp, includeAuth = false)
            snToken = snData.optString("snToken").trim()
            sn = snData.optString("sn").trim().ifEmpty {
                val md5 = MessageDigest.getInstance("MD5").digest((snToken + SNTOKEN_SALT).toByteArray())
                bytesToHex(md5)
            }.lowercase()
            val active = postPortal("v8/active", JSONObject().apply {
                put("snToken", snToken)
                put("authVersion", "")
                put("authCode", "")
                put("preCode", "")
                put("macAddr", FIXED_MAC)
                put("reserve1", "")
                put("openNum", 4)
                put("channel", "default")
                put("matadata", "")
                put("signdata", "")
            }, includeAuth = false)
            userId = active.optString("userId").trim()
            userToken = active.optString("userToken").trim()
            sessionReady = userToken.isNotEmpty()
        }
    }

    fun getLiveCategories(): JSONArray {
        liveCategoriesCache?.let { return it }
        ensureSession()
        val data = postPortal("getNextColumns", JSONObject().apply {
            put("columnCode", "masnew_live")
            put("pageNum", 1)
            put("pageSize", 50)
            put("version", "")
        })
        val list = data.optJSONArray("recommendList") ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            val cid = o.opt("columnId")?.toString()?.trim().orEmpty()
            if (cid.isNotEmpty()) {
                out.put(JSONObject().apply {
                    put("id", cid)
                    put("name", o.optString("name", o.optString("title", "Categoría ${i + 1}")))
                    put("code", o.optString("code", ""))
                })
            }
        }
        liveCategoriesCache = out
        return out
    }

    fun getLiveChannels(catId: String?, page: Int, size: Int): Pair<JSONArray, Boolean> {
        ensureSession()
        val data = postPortal("v6/getLiveData", JSONObject().apply {
            put("columnId", catId ?: "76182")
            put("dataVersion", "")
            put("pageSize", size.coerceIn(1, 50))
            put("pageNum", page.coerceAtLeast(1))
            put("expireTimeStr", "")
        })
        val list = data.optJSONArray("channelList") ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until list.length()) {
            val ch = list.optJSONObject(i) ?: continue
            val code = ch.optString("channelCode").trim()
            if (code.isEmpty()) continue
            val pList = ch.optJSONArray("posterList")?.optJSONObject(0)?.optString("fileUrl").orEmpty()
            val logo = ch.optString("posterUrl").ifEmpty { pList }.ifEmpty { ch.optString("icon", ch.optString("poster")) }
            out.put(JSONObject().apply {
                put("channelCode", code)
                put("name", ch.optString("name"))
                put("logo", logo)
                put("num", ch.optInt("channelNumber", i + 1))
            })
        }
        val hasMore = list.length() >= size
        return out to hasMore
    }

    fun resolveLive(channelCode: String): JSONObject {
        ensureSession()
        val play = postPortal("v4/startPlayLive", JSONObject().apply {
            put("channelCode", channelCode)
            put("columnId", 0)
            put("type", "1")
        })
        val addrs = play.optJSONArray("liveAddressList") ?: JSONArray()
        var chosen: JSONObject? = null
        for (i in 0 until addrs.length()) {
            val a = addrs.optJSONObject(i) ?: continue
            if (a.optString("license").isNotEmpty()) { chosen = a; break }
        }
        val lic = chosen?.optString("license") ?: throw IllegalStateException("No license")
        val playCode = chosen.optString("playCode").ifEmpty { channelCode }

        val slb = postPortal("v14/getSlbInfo", slbBean(listOf(channelCode)))
        val cdns = slb.optJSONArray("cdn_list") ?: JSONArray()
        for (i in 0 until cdns.length()) {
            val c = cdns.optJSONObject(i) ?: continue
            if (c.optString("tag") != "live") continue
            val host = c.optString("main_addr").removePrefix("https://").removePrefix("http://").substringBefore("/")
            val urls = c.optJSONArray("url_list") ?: continue
            for (j in 0 until urls.length()) {
                val u = urls.optJSONObject(j) ?: continue
                val authBase = u.optString("url")
                if (u.optString("sign_type") == "cfl" || authBase.contains("sign_type=cfl")) {
                    val token = Regex("token=([0-9a-fA-F]{32})").find(authBase)?.groupValues?.getOrNull(1) ?: ""
                    val moment = System.currentTimeMillis()
                    val sign2 = signO3(token, moment)
                    return JSONObject().apply {
                        put("url", "http://$host/live/$playCode.m3u8")
                        put("name", play.optString("name", channelCode))
                        put("mime", "application/x-mpegurl")
                        put("headers", JSONObject().apply {
                            put("Content-Auth", "$authBase&sign2_method=sign_o3&instance=0&start_moment=$moment&sign2=$sign2")
                            put("Content-License", lic)
                            put("User-Agent", UA_CDN)
                            put("App", APP_ID)
                            put("App-Version", APK_VERSION)
                        })
                    }
                }
            }
        }
        throw IllegalStateException("No live CDN available")
    }

    fun home(category: String): JSONArray {
        val key = if (ROOT_CODES.containsKey(category)) category else "movies"
        treeCache[key]?.let { if (System.currentTimeMillis() - it.first < 600_000) return it.second }
        ensureSession()
        val data = postPortal("getNextColumns", JSONObject().apply {
            put("columnCode", ROOT_CODES[key])
            put("pageNum", 1)
            put("pageSize", 60)
            put("version", "")
        })
        val out = JSONArray()
        val recList = data.optJSONArray("recommendList") ?: JSONArray()
        val catLabel = ROOT_CATEGORY[key] ?: ""
        for (i in 0 until recList.length()) {
            val row = recList.optJSONObject(i) ?: continue
            val assets = row.optJSONArray("assetList") ?: continue
            for (j in 0 until assets.length()) {
                val a = assets.optJSONObject(j) ?: continue
                mapAsset(a, catLabel)?.let { out.put(it) }
            }
        }
        treeCache[key] = System.currentTimeMillis() to out
        return out
    }

    fun search(query: String): JSONArray {
        val q = query.trim()
        if (q.isEmpty()) return JSONArray()
        searchCache[q.lowercase()]?.let { if (System.currentTimeMillis() - it.first < 180_000) return it.second }
        ensureSession()
        val data = postPortal("v3/searchByName", JSONObject().apply {
            put("value", q); put("type", "0"); put("columnId", ""); put("filter", ""); put("pageNum", 1); put("pageSize", 20)
        })
        val list = data.optJSONArray("searchItemList") ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until list.length()) {
            val item = list.optJSONObject(i) ?: continue
            mapAsset(item, "")?.let { out.put(it) }
        }
        searchCache[q.lowercase()] = System.currentTimeMillis() to out
        return out
    }

    fun detail(contentId: String): JSONObject {
        ensureSession()
        val data = postPortal("v4/getItemData", JSONObject().apply {
            put("contentId", contentId)
            put("type", "0")
            put("sortType", "0")
            put("language", "en")
            put("macAddr", FIXED_MAC)
        })
        val asset = data.optJSONObject("assetData") ?: data
        val item = mapAsset(asset, "") ?: JSONObject().put("id", contentId)
        val eps = JSONArray()
        val rawEps = asset.optJSONArray("simpleProgramList") ?: JSONArray()
        for (i in 0 until rawEps.length()) {
            val e = rawEps.optJSONObject(i) ?: continue
            eps.put(JSONObject().apply {
                put("id", e.optString("contentId"))
                put("title", e.optString("name", "Capítulo ${i + 1}"))
                put("name", e.optString("name", ""))
                put("number", e.optInt("seriesNumber", i + 1))
                put("duration", e.optString("duration", ""))
                put("quality", e.optString("quality", "1080p HD"))
                put("picture", e.optString("picture", e.optString("poster", "")))
                put("description", e.optString("description", ""))
            })
        }
        val seasons = JSONArray()
        val rawSeasons = asset.optJSONArray("sameSeasonSeriesList") ?: JSONArray()
        for (i in 0 until rawSeasons.length()) {
            val s = rawSeasons.optJSONObject(i) ?: continue
            val sid = s.optString("contentId").trim()
            if (sid.isEmpty()) continue
            seasons.put(JSONObject().apply {
                put("id", sid)
                put("number", s.optInt("seasonNumber", 1))
            })
        }
        return JSONObject().apply {
            put("item", item); put("episodes", eps); put("seasons", seasons)
        }
    }

    fun resolveVod(contentId: String, seriesId: String): JSONObject {
        ensureSession()
        val play = postPortal("v10/startPlayVOD", JSONObject().apply {
            put("contentId", contentId)
            put("seriesContentId", seriesId)
            put("startTime", 0)
            put("type", "1")
            put("columnId", 0)
            put("authType", "")
        })
        val ep = play.optJSONArray("episodeList")?.optJSONObject(0)
            ?: throw IllegalStateException("Sin episodios")
        val tracks = mutableListOf<JSONObject>()
        val totals = ep.optJSONArray("totalMovieList") ?: JSONArray()
        for (i in 0 until totals.length()) {
            val tm = totals.optJSONObject(i) ?: continue
            val movies = tm.optJSONArray("movieList") ?: continue
            for (j in 0 until movies.length()) {
                val m = movies.optJSONObject(j) ?: continue
                if (m.optString("contentId").isNotEmpty()) tracks.add(m)
            }
        }
        val track = tracks.firstOrNull() ?: throw IllegalStateException("Sin pistas de video")
        val lic = track.optJSONArray("licenseList")?.optJSONObject(0)?.optString("license") ?: ""
        val slb = slbCache?.takeIf { System.currentTimeMillis() - it.first < 300_000 }?.second
            ?: postPortal("v14/getSlbInfo", slbBean()).also {
                slbCache = System.currentTimeMillis() to it
            }
        val cdns = slb.optJSONArray("cdn_list") ?: JSONArray()
        for (i in 0 until cdns.length()) {
            val c = cdns.optJSONObject(i) ?: continue
            if (c.optString("tag") != "vod") continue
            val host = c.optString("main_addr").removePrefix("https://").removePrefix("http://").substringBefore("/")
            val urls = c.optJSONArray("url_list") ?: continue
            for (j in 0 until urls.length()) {
                val u = urls.optJSONObject(j) ?: continue
                val auth = u.optString("url")
                if (u.optString("tag") == "free" && (u.optString("sign_type") == "cfl" || auth.contains("sign_type=cfl"))) {
                    val ext = if (track.optString("videoFormat").equals("ts", true)) "ts" else "mp4"
                    val subs = JSONArray()
                    val rawSubs = ep.optJSONArray("subtitleList") ?: JSONArray()
                    for (k in 0 until rawSubs.length()) {
                        val s = rawSubs.optJSONObject(k) ?: continue
                        val su = s.optJSONArray("file")?.optJSONObject(0)?.optString("url") ?: ""
                        if (su.isNotEmpty()) {
                            subs.put(JSONObject().apply {
                                put("lang", s.optString("language", "es"))
                                put("url", su)
                                put("format", s.optString("fileType", "srt"))
                            })
                        }
                    }
                    return JSONObject().apply {
                        put("url", "https://$host/vod/${track.optString("contentId")}_media.$ext")
                        put("mime", if (ext == "ts") "video/mp2t" else "video/mp4")
                        put("codec", track.optString("encodeFormat", "H264"))
                        put("quality", track.optString("quality", "1080p"))
                        put("name", play.optString("name", ""))
                        put("headers", JSONObject().apply {
                            put("Content-Auth", auth)
                            put("Content-License", lic)
                            put("User-Agent", UA_CDN)
                            put("App", APP_ID)
                            put("App-Version", APK_VERSION)
                        })
                        put("subtitles", subs)
                    }
                }
            }
        }
        throw IllegalStateException("No VOD CDN available")
    }

    private fun mapAsset(e: JSONObject, cat: String): JSONObject? {
        val cid = e.optString("contentId").trim()
        if (cid.isEmpty()) return null
        val pType = e.optString("programType", "movie")
        val isSeries = pType == "teleplay" || pType == "series" || e.optInt("volumnCount", 0) > 1
        return JSONObject().apply {
            put("id", cid)
            put("title", e.optString("name", e.optString("title")))
            put("alias", e.optString("alias", ""))
            put("category", cat)
            put("kind", if (isSeries) "serie" else "película")
            put("type", if (isSeries) "teleplay" else pType)
            put("score", e.optString("score", "8.5"))
            put("year", e.optString("releaseTime", "2024").take(4))
            put("poster", e.optString("icon", e.optString("poster")))
            put("backdrop", e.optString("stage", e.optString("poster")))
            put("synopsis", e.optString("description", ""))
            put("portal", true)
        }
    }
}
