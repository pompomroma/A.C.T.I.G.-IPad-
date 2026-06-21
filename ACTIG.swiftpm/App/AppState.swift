import SwiftUI
import Combine

/// Lifecycle mode of the assistant.
enum AssistantMode: Equatable {
    /// Booted but not actively listening — waiting for the wake word / launch.
    case dormant
    /// Active: overlay visible, listening, ready to converse.
    case awake
    /// Generating or speaking a reply.
    case responding
}

/// Which workspace surface fills the screen behind the hologram overlay.
enum Workspace: Equatable {
    case conversation
    case scene3D
    case camera
}

/// A single line in the conversation transcript.
struct ChatMessage: Identifiable, Equatable {
    enum Role { case user, assistant, system }
    let id = UUID()
    let role: Role
    var text: String
    var isStreaming: Bool = false
    let timestamp = Date()
}

/// App-wide observable state shared across the UI, voice, brain and 3D layers.
@MainActor
final class AppState: ObservableObject {
    // Lifecycle
    @Published var mode: AssistantMode = .dormant
    @Published var workspace: Workspace = .conversation

    // Mute toggles surfaced as the two blue hologram mic buttons.
    @Published var userMicMuted: Bool = false   // stop listening to the user
    @Published var aiVoiceMuted: Bool = false   // stop A.C.T.I.G. speaking aloud

    // Whether camera-based finger control is currently enabled (opt-in only).
    @Published var cameraControlEnabled: Bool = false

    // Live transcript.
    @Published var messages: [ChatMessage] = []

    // The user's in-progress partial transcription (shown live in the chat box).
    @Published var liveTranscript: String = ""

    // Status line shown in the hologram (e.g. "listening", "thinking", "loading model").
    @Published var statusLine: String = "dormant"

    // Model readiness.
    @Published var modelState: ModelLoadState = .idle

    enum ModelLoadState: Equatable {
        case idle
        case loading(progress: Double)
        case ready(engine: String)
        case failed(reason: String)
        case fallback(reason: String)
    }

    // MARK: - Convenience mutations

    func appendUser(_ text: String) {
        messages.append(ChatMessage(role: .user, text: text))
    }

    /// Starts a streaming assistant message and returns its id so tokens can be
    /// appended as the LLM produces them.
    func beginAssistantStream() -> UUID {
        let msg = ChatMessage(role: .assistant, text: "", isStreaming: true)
        messages.append(msg)
        return msg.id
    }

    func appendToken(_ token: String, to id: UUID) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[idx].text += token
    }

    func finishStream(_ id: UUID) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[idx].isStreaming = false
    }

    /// Removes a (usually partially generated) assistant message — used when the
    /// user interrupts and we abandon the reply.
    func discardStream(_ id: UUID) {
        messages.removeAll { $0.id == id }
    }

    func system(_ text: String) {
        messages.append(ChatMessage(role: .system, text: text))
    }
}
