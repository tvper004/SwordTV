package com.swordtv.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var engine: LocalEngineServer
    private var isFullscreen = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val portal = PortalClient()
        engine = LocalEngineServer(portal, 11472)
        engine.start()

        webView = WebView(this).apply {
            setBackgroundColor(0xFF060B14.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.allowFileAccess = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
        }
        setContentView(webView)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.addJavascriptInterface(NativeBridge(), "SwordTVNative")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                applyFullscreenBars(true)
            }
            override fun onHideCustomView() {
                applyFullscreenBars(false)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                val shim = """
                    window.__TAURI__ = window.__TAURI__ || {
                      core: {
                        invoke: function(cmd, args) {
                          return new Promise(function(resolve, reject) {
                            try {
                              var res = window.SwordTVNative.invoke(cmd, JSON.stringify(args || {}));
                              resolve(res ? JSON.parse(res) : null);
                            } catch (e) { reject(e); }
                          });
                        }
                      }
                    };
                """.trimIndent()
                view?.evaluateJavascript(shim, null)
            }
        }

        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    override fun onDestroy() {
        engine.stop()
        super.onDestroy()
    }

    private fun applyFullscreenBars(enable: Boolean) {
        isFullscreen = enable
        runOnUiThread {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                window.insetsController?.let {
                    if (enable) {
                        it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                        it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    } else {
                        it.show(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                    }
                }
            }
        }
    }

    inner class NativeBridge {
        private val prefs = getSharedPreferences("swordtv_store", Context.MODE_PRIVATE)

        @JavascriptInterface
        fun invoke(cmd: String, argsJson: String): String {
            val args = runCatching { JSONObject(argsJson) }.getOrDefault(JSONObject())
            return when (cmd) {
                "get_settings" -> prefs.getString("settings", "{}") ?: "{}"
                "save_settings" -> {
                    prefs.edit().putString("settings", args.optJSONObject("settings")?.toString() ?: "{}").apply()
                    "null"
                }
                "get_favorites" -> prefs.getString("favorites", "[]") ?: "[]"
                "toggle_favorite" -> {
                    val item = args.optJSONObject("item") ?: return "[]"
                    val list = JSONArray(prefs.getString("favorites", "[]") ?: "[]")
                    val id = item.optString("id")
                    val out = JSONArray()
                    var removed = false
                    for (i in 0 until list.length()) {
                        val cur = list.optJSONObject(i) ?: continue
                        if (cur.optString("id") == id) removed = true else out.put(cur)
                    }
                    if (!removed) out.put(item)
                    prefs.edit().putString("favorites", out.toString()).apply()
                    out.toString()
                }
                "get_history" -> prefs.getString("history", "[]") ?: "[]"
                "save_history" -> {
                    val item = args.optJSONObject("item") ?: return "null"
                    val list = JSONArray(prefs.getString("history", "[]") ?: "[]")
                    val id = item.optString("id")
                    val out = JSONArray().put(item)
                    for (i in 0 until list.length()) {
                        val cur = list.optJSONObject(i) ?: continue
                        if (cur.optString("id") != id && out.length() < 50) out.put(cur)
                    }
                    prefs.edit().putString("history", out.toString()).apply()
                    "null"
                }
                "clear_history" -> {
                    prefs.edit().putString("history", "[]").apply()
                    "null"
                }
                "fetch_m3u_content" -> {
                    val u = args.optString("url")
                    val conn = (URL(u).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 10000; readTimeout = 15000
                    }
                    JSONObject.quote(conn.inputStream.bufferedReader().use { it.readText() })
                }
                "toggle_fullscreen" -> {
                    applyFullscreenBars(!isFullscreen)
                    "null"
                }
                else -> "null"
            }
        }
    }
}
