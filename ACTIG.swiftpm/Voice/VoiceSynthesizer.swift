import Foundation
import AVFoundation

/// Text-to-speech with a deliberately crisp, slightly mechanical "Jarvis" voice.
/// Speaks in small chunks so generation and speech overlap (low latency) and so
/// barge-in can stop it instantly mid-sentence.
@MainActor
final class VoiceSynthesizer: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published private(set) var isSpeaking = false

    private let synth = AVSpeechSynthesizer()
    private var queue: [String] = []

    /// Called when the synthesizer finishes everything queued.
    var onFinished: (() -> Void)?

    override init() {
        super.init()
        synth.delegate = self
    }

    /// Pick a refined English voice; prefer an enhanced/premium one for the
    /// smooth-but-synthetic Jarvis timbre, falling back to the default.
    private var voice: AVSpeechSynthesisVoice? {
        let preferred = AVSpeechSynthesisVoice.speechVoices().first {
            $0.language.hasPrefix("en") && ($0.quality == .premium || $0.quality == .enhanced)
        }
        return preferred ?? AVSpeechSynthesisVoice(language: "en-GB")
    }

    /// Speak a complete sentence/utterance.
    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.voice = voice
        utterance.rate = 0.52              // brisk, attentive
        utterance.pitchMultiplier = 0.92   // slightly lowered, mechanical
        utterance.preUtteranceDelay = 0.0
        utterance.postUtteranceDelay = 0.05
        isSpeaking = true
        synth.speak(utterance)
    }

    /// Feed an incremental token stream; flushes on sentence boundaries so the
    /// assistant starts talking before the full reply is generated.
    private var buffer = ""
    func enqueueToken(_ token: String) {
        buffer += token
        if let range = buffer.rangeOfCharacter(from: CharacterSet(charactersIn: ".!?\n")) {
            let sentence = String(buffer[..<range.upperBound])
            buffer = String(buffer[range.upperBound...])
            speak(sentence)
        }
    }

    func flushBuffer() {
        if !buffer.trimmingCharacters(in: .whitespaces).isEmpty { speak(buffer) }
        buffer = ""
    }

    /// Immediately silence the voice (used for barge-in interruption).
    func stop() {
        buffer = ""
        synth.stopSpeaking(at: .immediate)
        isSpeaking = false
    }

    // MARK: - AVSpeechSynthesizerDelegate

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if !synthesizer.isSpeaking {
                isSpeaking = false
                onFinished?()
            }
        }
    }
}
