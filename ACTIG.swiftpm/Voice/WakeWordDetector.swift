import Foundation

/// Detects the wake phrase "wake up ACTIG" and the sleep phrase
/// "shut down all systems" from the live speech transcript.
///
/// IMPORTANT iPadOS limitation: a third-party app cannot run an always-on wake
/// word while it is in the background or the device is asleep — only Siri has
/// that privilege. So this detector works while A.C.T.I.G. is the foreground
/// app. For hands-free launch from anywhere, the app also ships a Siri Shortcut
/// ("Hey Siri, wake up ACTIG") — see Intents/ACTIGShortcuts.swift and
/// docs/CAPABILITIES.md.
@MainActor
final class WakeWordDetector {
    var onWake: (() -> Void)?
    var onSleep: (() -> Void)?

    private let wakePhrases = ["wake up actig", "wake up act", "wake up a c t i g", "wakeup actig"]
    private let sleepPhrases = ["shut down all systems", "shutdown all systems", "shut down all system"]

    /// Feed every partial/final transcript here while listening.
    func consider(transcript: String) {
        let t = transcript.lowercased()
        if wakePhrases.contains(where: t.contains) {
            onWake?()
        } else if sleepPhrases.contains(where: t.contains) {
            onSleep?()
        }
    }
}
