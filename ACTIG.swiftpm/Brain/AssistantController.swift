import Foundation
import SwiftUI

/// The conductor. Owns every subsystem (LLM, voice in/out, wake word, barge-in,
/// 3D store, camera, hand tracking) and routes user input — typed or spoken —
/// through the intent router to the right place, keeping `AppState` in sync.
@MainActor
final class AssistantController: ObservableObject {
    let state: AppState
    let sceneStore = SceneStore()

    // Brain
    private var engine: LLMEngine = LLMEngineFactory.makeBest()

    // Voice
    let speech = SpeechRecognizer()
    let voice = VoiceSynthesizer()
    private let bargeIn = BargeInController()
    private let wakeWord = WakeWordDetector()

    // Vision
    let cameraSession = CameraSession()
    let handTracking = HandTrackingController()
    private let objectAnalyzer = ObjectAnalyzer()

    /// The in-flight LLM generation, cancellable for barge-in interruption.
    private var generation: Task<Void, Never>?

    init(state: AppState) {
        self.state = state
    }

    // MARK: - Bootstrap

    func bootstrap() async {
        state.messages = Conversation.load()
        handTracking.attach(store: sceneStore)
        wireVoice()
        wireBargeIn()

        await loadModel()
        await startListeningForWake()
    }

    private func loadModel() async {
        state.modelState = .loading(progress: 0)
        state.statusLine = "loading model…"
        do {
            try await engine.load { [weak self] p in
                Task { @MainActor in self?.state.modelState = .loading(progress: p) }
            }
            state.modelState = .ready(engine: engine.displayName)
            state.statusLine = "ready · \(engine.displayName)"
        } catch {
            // Fall back to the always-available stub so the app stays usable.
            engine = EchoStubEngine()
            try? await engine.load { _ in }
            state.modelState = .fallback(reason: error.localizedDescription)
            state.statusLine = "offline stub (model unavailable)"
            state.system("Model load failed: \(error.localizedDescription). Using offline stub — see README.")
        }
    }

    // MARK: - Wiring

    private func wireVoice() {
        speech.onSpeechDetected = { [weak self] in
            self?.bargeIn.userStartedSpeaking()
        }
        speech.onFinalResult = { [weak self] text in
            guard let self else { return }
            self.wakeWord.consider(transcript: text)
            // Only treat speech as a command when awake and the user isn't muted.
            if self.state.mode != .dormant && !self.state.userMicMuted {
                Task { await self.handleUserText(text, spoken: true) }
            }
        }
        // Mirror live partial transcripts into AppState for the chat box + wake word.
        speechPartialObserver()

        wakeWord.onWake = { [weak self] in Task { await self?.wake() } }
        wakeWord.onSleep = { [weak self] in self?.shutdown() }

        voice.onFinished = { [weak self] in
            guard let self else { return }
            if self.state.mode == .responding { self.state.mode = .awake; self.state.statusLine = "listening" }
        }
    }

    /// Reflect the recognizer's partial text into AppState for the live bubble.
    private func speechPartialObserver() {
        // SpeechRecognizer publishes `partialText`; observe it.
        Task { @MainActor in
            var last = ""
            while true {
                if speech.partialText != last {
                    last = speech.partialText
                    state.liveTranscript = last
                    wakeWord.consider(transcript: last)
                }
                try? await Task.sleep(nanoseconds: 120_000_000)
            }
        }
    }

    private func wireBargeIn() {
        bargeIn.onInterrupt = { [weak self] in
            guard let self else { return }
            self.voice.stop()
            self.generation?.cancel()
            self.state.statusLine = "go ahead — listening"
            self.state.mode = .awake
        }
    }

    // MARK: - Lifecycle commands

    /// Start the mic so the wake word can be heard while dormant.
    private func startListeningForWake() async {
        guard await speech.requestAuthorization() else {
            state.system("Microphone/speech permission denied — voice features disabled. Text still works.")
            return
        }
        try? speech.start()
    }

    func wake() async {
        guard state.mode == .dormant else { return }
        withAnimation(.spring) { state.mode = .awake }
        state.workspace = .conversation
        state.statusLine = "online · listening"
        speak("A.C.T.I.G. online.")
    }

    func shutdown() {
        generation?.cancel()
        voice.stop()
        speech.stop()
        cameraSession.stop()
        state.cameraControlEnabled = false
        handTracking.setActive(false)
        withAnimation(.spring) { state.mode = .dormant }
        state.statusLine = "dormant"
        // Resume minimal listening so the wake word still works.
        Task { try? await Task.sleep(nanoseconds: 400_000_000); try? speech.start() }
    }

    // MARK: - Mute toggles

    func userMicMuteChanged() {
        if state.userMicMuted { speech.stop() } else { try? speech.start() }
    }

    func aiVoiceMuteChanged() {
        if state.aiVoiceMuted { voice.stop() }
    }

    // MARK: - Input handling

    func handleUserText(_ text: String, spoken: Bool = false) async {
        let intent = IntentRouter.parse(text)

        // Show the user's message (skip echoing pure wake/sleep utterances).
        switch intent {
        case .wake, .shutdown: break
        default: state.appendUser(text)
        }
        state.liveTranscript = ""

        await route(intent, original: text)
    }

    func handleAttachment(data: Data) async {
        state.system("Attachment received (\(data.count) bytes). Image understanding runs through object analysis — point the camera or ask about it.")
    }

    private func route(_ intent: AssistantIntent, original: String) async {
        switch intent {
        case .wake: await wake()
        case .shutdown: shutdown()

        case .openSceneWorkspace:
            withAnimation(.spring) { state.workspace = .scene3D }
            speak("Opening the 3D project space.")
        case .openConversation:
            withAnimation(.spring) { state.workspace = .conversation }
        case .openCamera:
            withAnimation(.spring) { state.workspace = .camera }

        case .enableCameraControl:
            await enableCameraControl()
        case .disableCameraControl:
            state.cameraControlEnabled = false
            handTracking.setActive(false)
            speak("Camera control disabled.")

        case .analyzeObject(let question):
            if state.workspace != .camera { withAnimation(.spring) { state.workspace = .camera } }
            await scanObject(question: question)

        case .undo:
            sceneStore.undo(); speak("Reverted.")
        case .redo:
            sceneStore.redo(); speak("Restored.")

        case .scene(let s):
            applyScene(s)

        case .chat(let prompt):
            await generateReply(for: prompt)
        }
    }

    // MARK: - Scene intents

    private func applyScene(_ s: SceneIntent) {
        if state.workspace != .scene3D { withAnimation(.spring) { state.workspace = .scene3D } }
        switch s.action {
        case .add(let kind): sceneStore.addShape(kind); speak("Added a \(kind.rawValue).")
        case .multiply(let kind, let n): sceneStore.multiply(kind, count: n); speak("Created \(n) \(kind.rawValue)s.")
        case .grow: sceneStore.grow(sceneStore.selection); speak("Enlarged.")
        case .shrink: sceneStore.shrink(sceneStore.selection); speak("Shrunk.")
        case .delete: sceneStore.deleteSelected(); speak("Deleted.")
        case .swap: sceneStore.swapFirstTwo(); speak("Swapped positions.")
        case .clear: sceneStore.clear(); speak("Scene cleared.")
        }
    }

    // MARK: - LLM reply (interruptible)

    private func generateReply(for prompt: String) async {
        generation?.cancel()
        bargeIn.beginReply()
        state.mode = .responding
        state.statusLine = "thinking…"

        let history = state.messages
        let streamId = state.beginAssistantStream()

        generation = Task { [weak self] in
            guard let self else { return }
            do {
                var spokeAnything = false
                let stream = self.engine.reply(to: history, system: Conversation.systemPrompt)
                for try await token in stream {
                    if Task.isCancelled { break }
                    self.state.appendToken(token.text, to: streamId)
                    if !self.state.aiVoiceMuted {
                        self.voice.enqueueToken(token.text)
                        spokeAnything = true
                    }
                    if self.state.statusLine == "thinking…" { self.state.statusLine = "responding" }
                }
                if Task.isCancelled {
                    self.state.discardStream(streamId)   // abandon interrupted reply
                } else {
                    self.state.finishStream(streamId)
                    if !self.state.aiVoiceMuted { self.voice.flushBuffer() }
                    if !spokeAnything { self.state.mode = .awake; self.state.statusLine = "listening" }
                }
            } catch {
                self.state.appendToken(" [error: \(error.localizedDescription)]", to: streamId)
                self.state.finishStream(streamId)
            }
            self.bargeIn.endReply()
            Conversation.save(self.state.messages)
        }
    }

    // MARK: - Voice helper

    private func speak(_ text: String) {
        state.system(text)
        guard !state.aiVoiceMuted else { return }
        voice.speak(text)
    }

    // MARK: - Camera

    func enableCameraControl() async {
        guard await cameraSession.requestAccess() else {
            state.system("Camera permission denied.")
            return
        }
        cameraSession.configure(front: true)        // front cam for hand gestures
        // Capture the tracker directly; `process` is nonisolated so it can run on
        // the camera queue and hops to the main actor internally.
        let tracker = handTracking
        cameraSession.onFrame = { [weak tracker] buffer in
            tracker?.process(pixelBuffer: buffer)
        }
        cameraSession.start()
        handTracking.setActive(true)
        state.cameraControlEnabled = true
        if state.workspace == .conversation { withAnimation(.spring) { state.workspace = .scene3D } }
        speak("Camera hand control enabled. Pinch to grab a shape and move it.")
    }

    func startCamera() {
        Task {
            guard await cameraSession.requestAccess() else { return }
            // Back cam for object analysis unless hand control already configured.
            if !state.cameraControlEnabled { cameraSession.configure(front: false) }
            cameraSession.start()
        }
    }

    func stopCamera() {
        if !state.cameraControlEnabled { cameraSession.stop() }
    }

    func scanObject(question: String) async {
        guard let buffer = cameraSession.latestPixelBuffer else {
            state.system("No camera frame yet — point the camera at the object and try again.")
            return
        }
        state.statusLine = "analysing…"
        let analysis = await objectAnalyzer.analyze(pixelBuffer: buffer)
        // Feed the structured observation to the LLM so the answer is conversational.
        let prompt = """
        I pointed the camera at an object. On-device vision reports: \(analysis.summary).
        The user asks: "\(question)". Answer concisely based on this.
        """
        state.appendUser(question)
        await generateReply(for: prompt)
    }
}
