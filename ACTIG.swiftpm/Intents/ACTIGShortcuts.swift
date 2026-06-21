import AppIntents
import SwiftUI

/// App Intents that expose A.C.T.I.G. to Siri and the Shortcuts app. This is the
/// closest a stock-iPad app can get to a system-wide wake word: the user says
/// "Hey Siri, wake up ACTIG" and iOS launches the app into its awake state.
///
/// A small file-based flag is used to hand the wake request to the running app
/// (or to set the desired state before launch).
struct WakeUpACTIGIntent: AppIntent {
    static var title: LocalizedStringResource = "Wake up ACTIG"
    static var description = IntentDescription("Launches A.C.T.I.G. and brings the assistant online.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        WakeFlag.set(true)
        return .result()
    }
}

struct ShutdownACTIGIntent: AppIntent {
    static var title: LocalizedStringResource = "Shut down all systems"
    static var description = IntentDescription("Puts A.C.T.I.G. into dormant mode.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        WakeFlag.set(false)
        return .result()
    }
}

/// Phrases users can speak to Siri without opening Shortcuts first.
struct ACTIGShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WakeUpACTIGIntent(),
            phrases: [
                "Wake up \(.applicationName)",
                "Wake up A C T I G",
                "Bring \(.applicationName) online"
            ],
            shortTitle: "Wake up",
            systemImageName: "sparkles"
        )
        AppShortcut(
            intent: ShutdownACTIGIntent(),
            phrases: [
                "Shut down all systems on \(.applicationName)",
                "Shut down \(.applicationName)"
            ],
            shortTitle: "Shut down",
            systemImageName: "moon.zzz"
        )
    }
}

/// Tiny persisted flag the app polls on launch / foreground to honor a Siri wake.
enum WakeFlag {
    private static let key = "actig.wake.requested"
    static func set(_ on: Bool) { UserDefaults.standard.set(on, forKey: key) }
    static func consume() -> Bool? {
        guard UserDefaults.standard.object(forKey: key) != nil else { return nil }
        let v = UserDefaults.standard.bool(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        return v
    }
}
