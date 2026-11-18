import SwiftUI

@main
struct SwordTVApp: App {
    private let portal = PortalClient()
    private let engine: LocalEngineServer

    init() {
        engine = LocalEngineServer(portal: portal, port: 11472)
        engine.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
