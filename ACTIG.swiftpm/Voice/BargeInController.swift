import Foundation

/// Coordinates "barge-in": if the user starts speaking while A.C.T.I.G. is
/// generating or talking, we immediately cancel the in-flight reply and the
/// voice, then listen to the new request. This is what gives the natural,
/// human-like conversational fluency described in the request — you can cut the
/// assistant off and restate.
///
/// The controller is intentionally tiny; it just wires the speech-detected
/// signal to cancellation handlers owned by `AssistantController`.
@MainActor
final class BargeInController {
    /// True while a reply (generation + speech) is in progress and therefore
    /// interruptible.
    private(set) var replyInFlight = false

    /// Invoked when the user barges in. Set by `AssistantController`.
    var onInterrupt: (() -> Void)?

    func beginReply() { replyInFlight = true }
    func endReply() { replyInFlight = false }

    /// Called by the speech recognizer the moment user speech is detected.
    func userStartedSpeaking() {
        guard replyInFlight else { return }
        replyInFlight = false
        onInterrupt?()
    }
}
