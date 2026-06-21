import SwiftUI

/// Entry point for A.C.T.I.G. The root scene hosts the live workspace (chat
/// transcript or the 3D project space) with the Jarvis-style hologram overlay
/// floating above everything *inside the app*.
///
/// Note on "hover over every app": iPadOS does not allow third-party apps to
/// draw over other apps (there is no Android-style SYSTEM_ALERT_WINDOW). The
/// overlay therefore floats over A.C.T.I.G.'s own surfaces. The closest
/// out-of-app presence available on a stock device is the Siri Shortcut
/// ("Wake up ACTIG"), Picture-in-Picture, and Live Activities. See
/// docs/CAPABILITIES.md and docs/JAILBREAK.md.
@main
struct ACTIGApp: App {
    @StateObject private var state: AppState
    @StateObject private var assistant: AssistantController
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let appState = AppState()
        let controller = AssistantController(state: appState)
        _state = StateObject(wrappedValue: appState)
        _assistant = StateObject(wrappedValue: controller)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .environmentObject(assistant)
                .environmentObject(assistant.sceneStore)
                .preferredColorScheme(.dark)
                .task {
                    await assistant.bootstrap()
                    honorSiriWake()
                }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { honorSiriWake() }
        }
    }

    /// If the user launched us via "Hey Siri, wake up ACTIG", come online.
    private func honorSiriWake() {
        if let wake = WakeFlag.consume() {
            Task { wake ? await assistant.wake() : assistant.shutdown() }
        }
    }
}

/// The root composes the active workspace with the hologram overlay on top.
struct RootView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ZStack {
            // Deep space backdrop so the blue hologram reads as "projected light".
            HoloTheme.backdrop
                .ignoresSafeArea()

            // The current workspace beneath the overlay.
            Group {
                switch state.workspace {
                case .conversation:
                    ConversationBackdropView()
                case .scene3D:
                    SceneEditorView()
                case .camera:
                    CameraWorkspaceView()
                }
            }
            .ignoresSafeArea()

            // The always-present (in-app) Jarvis hologram layer.
            HologramOverlay()
        }
        .statusBarHidden(true)
    }
}

/// A quiet animated backdrop shown when no special workspace is active.
struct ConversationBackdropView: View {
    var body: some View {
        HoloGrid()
            .opacity(0.25)
    }
}
