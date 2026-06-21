import Foundation

/// A streamed token from the LLM.
struct LLMToken {
    let text: String
}

/// Abstraction over the on-device language model so the rest of the app does not
/// care whether tokens come from MLX, Apple's Foundation Models framework, or
/// the offline stub. Every engine streams tokens and is cancellable, which is
/// what makes barge-in interruption possible (we just cancel the Task).
protocol LLMEngine: AnyObject {
    /// Human-readable engine name surfaced in the UI ("MLX · Qwen2.5-3B").
    var displayName: String { get }

    /// Loads weights / prepares the runtime. Reports 0...1 progress.
    func load(progress: @escaping (Double) -> Void) async throws

    /// Streams a reply for the given conversation. The continuation must respect
    /// `Task.isCancelled` so callers can interrupt mid-generation.
    func reply(to messages: [ChatMessage], system: String) -> AsyncThrowingStream<LLMToken, Error>
}

enum LLMEngineError: LocalizedError {
    case notLoaded
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .notLoaded: return "The on-device model is not loaded yet."
        case .unavailable(let why): return why
        }
    }
}

/// Selects the best available engine at runtime, with graceful fallback:
/// 1. MLX (if the dependency compiled and a model is present)
/// 2. Apple Foundation Models (iPadOS 26 / Apple Intelligence capable device)
/// 3. EchoStubEngine (always works — keeps the app usable for UI testing offline)
enum LLMEngineFactory {
    static func makeBest() -> LLMEngine {
        #if canImport(MLXLLM)
        return MLXLLMEngine()
        #else
        if #available(iOS 26.0, *), FoundationModelsEngine.isSupported {
            return FoundationModelsEngine()
        }
        return EchoStubEngine()
        #endif
    }
}

/// A dependency-free fallback engine. It does not "think" — it produces a short,
/// streamed, on-device-only canned reply so the full UI/voice/interruption loop
/// can be exercised even before the real model is installed. Replaced
/// automatically once MLX or Foundation Models is available.
final class EchoStubEngine: LLMEngine {
    let displayName = "Offline Stub (no model installed)"

    func load(progress: @escaping (Double) -> Void) async throws {
        progress(1.0)
    }

    func reply(to messages: [ChatMessage], system: String) -> AsyncThrowingStream<LLMToken, Error> {
        let last = messages.last(where: { $0.role == .user })?.text ?? ""
        let response = "A.C.T.I.G. stub here. I received: \"\(last)\". " +
            "Install the on-device model (see README) to enable real reasoning."
        return AsyncThrowingStream { continuation in
            let task = Task {
                for word in response.split(separator: " ") {
                    if Task.isCancelled { break }
                    try? await Task.sleep(nanoseconds: 45_000_000)
                    continuation.yield(LLMToken(text: String(word) + " "))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
