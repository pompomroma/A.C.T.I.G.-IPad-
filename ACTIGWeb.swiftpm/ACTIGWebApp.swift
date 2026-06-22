import SwiftUI

/// Hosts the bundled A.C.T.I.G. web app inside a Swift Playgrounds app. A tiny
/// loopback HTTP server (see LocalWebServer) serves the WebApp/ resources so the
/// page runs in a secure context (camera / mic / WebGPU enabled), then a
/// full-screen WKWebView loads it.
@main
struct ACTIGWebApp: App {
    @StateObject private var host = WebHost()

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                if let url = host.url {
                    WebHostView(url: url).ignoresSafeArea()
                } else if let error = host.error {
                    VStack(spacing: 12) {
                        Text("A.C.T.I.G.").font(.title.bold()).foregroundStyle(.cyan)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center).padding()
                    }
                } else {
                    VStack(spacing: 14) {
                        ProgressView().tint(.cyan)
                        Text("Starting A.C.T.I.G.…").foregroundStyle(.cyan)
                    }
                }
            }
            .preferredColorScheme(.dark)
            .statusBarHidden(true)
        }
    }
}

/// Starts the local server and publishes the URL the WebView should load.
@MainActor
final class WebHost: ObservableObject {
    @Published var url: URL?
    @Published var error: String?
    private var server: LocalWebServer?

    init() { start() }

    private func start() {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("WebApp"),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            error = "Bundled web app not found."
            return
        }
        do {
            let server = try LocalWebServer(rootURL: root)
            self.server = server
            server.start { [weak self] port in
                Task { @MainActor in
                    self?.url = URL(string: "http://127.0.0.1:\(port)/index.html")
                }
            }
        } catch {
            self.error = "Could not start local server: \(error.localizedDescription)"
        }
    }
}
