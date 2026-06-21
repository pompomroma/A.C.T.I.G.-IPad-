import Foundation
import Speech
import AVFoundation

/// On-device speech-to-text built on `SFSpeechRecognizer`. Streams partial
/// results so the chat box updates live and the barge-in controller can react
/// the instant the user starts talking.
///
/// `requiresOnDeviceRecognition` is set so transcription stays fully offline
/// when the device supports it (the M4 iPad does).
@MainActor
final class SpeechRecognizer: ObservableObject {
    @Published var partialText: String = ""
    @Published var isListening = false
    @Published var lastError: String?

    /// Fired with the final transcript when a phrase completes.
    var onFinalResult: ((String) -> Void)?
    /// Fired as soon as any speech is detected (used for barge-in).
    var onSpeechDetected: (() -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    /// Requests mic + speech permissions. Returns true if both granted.
    func requestAuthorization() async -> Bool {
        let speechOK = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
        let micOK = await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        return speechOK && micOK
    }

    func start() throws {
        guard !isListening else { return }
        guard let recognizer, recognizer.isAvailable else {
            throw NSError(domain: "ACTIG", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Speech recognizer unavailable"])
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()
        isListening = true
        partialText = ""

        var sawSpeech = false
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            Task { @MainActor in
                if let result {
                    let text = result.bestTranscription.formattedString
                    if !text.isEmpty && !sawSpeech {
                        sawSpeech = true
                        self.onSpeechDetected?()
                    }
                    self.partialText = text
                    if result.isFinal {
                        self.onFinalResult?(text)
                        self.partialText = ""
                        sawSpeech = false
                        self.restart()
                    }
                }
                if error != nil {
                    self.restart()
                }
            }
        }
    }

    func stop() {
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning { audioEngine.stop() }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        isListening = false
        partialText = ""
    }

    /// Restarts continuous listening for the next phrase.
    private func restart() {
        stop()
        // Small delay avoids audio-engine churn between phrases.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 150_000_000)
            try? self.start()
        }
    }
}
