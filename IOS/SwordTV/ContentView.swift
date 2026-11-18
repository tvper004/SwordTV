import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        SwordTVWebView()
            .ignoresSafeArea(.container, edges: .bottom)
            .background(Color(red: 0.02, green: 0.04, blue: 0.08))
            .preferredColorScheme(.dark)
    }
}

struct SwordTVWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsPictureInPictureMediaPlayback = true

        let ucc = config.userContentController
        ucc.add(context.coordinator, name: "swordtvInvoke")
        let bridgeScript = WKUserScript(source: """
            window.__TAURI__ = window.__TAURI__ || {
              core: {
                invoke: function(cmd, args) {
                  return new Promise(function(resolve, reject) {
                    var id = 'cb_' + Math.random().toString(36).slice(2);
                    window.__swordtvCallbacks = window.__swordtvCallbacks || {};
                    window.__swordtvCallbacks[id] = { resolve: resolve, reject: reject };
                    window.webkit.messageHandlers.swordtvInvoke.postMessage({ id: id, cmd: cmd, args: args || {} });
                  });
                }
              }
            };
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        ucc.addUserScript(bridgeScript)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.02, green: 0.04, blue: 0.08, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            if let url = URL(string: "http://127.0.0.1:11472/web/index.html") {
                webView.load(URLRequest(url: url))
            }
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var webView: WKWebView?
        private let defaults = UserDefaults.standard

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                if let url = URL(string: "http://127.0.0.1:11472/web/index.html") {
                    webView.load(URLRequest(url: url))
                }
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let id = body["id"] as? String,
                  let cmd = body["cmd"] as? String else { return }
            let args = body["args"] as? [String: Any] ?? [:]

            DispatchQueue.global(qos: .userInitiated).async {
                let result: Any? = self.handle(cmd: cmd, args: args)
                let jsonStr: String
                if let result, let data = try? JSONSerialization.data(withJSONObject: result, options: .fragmentsAllowed),
                   let str = String(data: data, encoding: .utf8) {
                    jsonStr = str
                } else if let str = result as? String {
                    let q = (try? JSONSerialization.data(withJSONObject: str, options: .fragmentsAllowed)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
                    jsonStr = q
                } else {
                    jsonStr = "null"
                }
                DispatchQueue.main.async {
                    self.webView?.evaluateJavaScript("window.__swordtvCallbacks['\(id)']?.resolve(\(jsonStr)); delete window.__swordtvCallbacks['\(id)'];", completionHandler: nil)
                }
            }
        }

        private func handle(cmd: String, args: [String: Any]) -> Any? {
            switch cmd {
            case "get_settings":
                return (defaults.string(forKey: "settings")?.data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? [:]
            case "save_settings":
                if let s = args["settings"], let d = try? JSONSerialization.data(withJSONObject: s) {
                    defaults.set(String(data: d, encoding: .utf8), forKey: "settings")
                }
                return nil
            case "get_favorites":
                return (defaults.string(forKey: "favorites")?.data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? []
            case "toggle_favorite":
                guard let item = args["item"] as? [String: Any], let itemId = item["id"] as? String else { return [] }
                var list = (defaults.string(forKey: "favorites")?.data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
                if let idx = list.firstIndex(where: { ($0["id"] as? String) == itemId }) { list.remove(at: idx) }
                else { list.append(item) }
                if let d = try? JSONSerialization.data(withJSONObject: list) { defaults.set(String(data: d, encoding: .utf8), forKey: "favorites") }
                return list
            case "get_history":
                return (defaults.string(forKey: "history")?.data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? []
            case "save_history":
                guard let item = args["item"] as? [String: Any], let itemId = item["id"] as? String else { return nil }
                var list = (defaults.string(forKey: "history")?.data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
                list.removeAll { ($0["id"] as? String) == itemId }
                list.insert(item, at: 0)
                if list.count > 50 { list = Array(list.prefix(50)) }
                if let d = try? JSONSerialization.data(withJSONObject: list) { defaults.set(String(data: d, encoding: .utf8), forKey: "history") }
                return nil
            case "clear_history":
                defaults.set("[]", forKey: "history")
                return nil
            case "fetch_m3u_content":
                guard let u = args["url"] as? String, let url = URL(string: u) else { return "" }
                return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            default:
                return nil
            }
        }
    }
}
