import Foundation

// Apple's on-device Foundation Models framework (Apple Intelligence) is used as
// a zero-download fallback when the MLX dependency is absent and the device
// supports it (iPadOS 26+, Apple-Intelligence-capable — the M4 iPad qualifies).
//
// The framework is gated behind `canImport(FoundationModels)` so the project
// still builds on older toolchains / Swift Playgrounds versions that lack it.
//
// ESCAPE HATCH: if Swift Playgrounds reports a compile error in this file on
// your iPadOS version (the Foundation Models API can shift between point
// releases), add the custom Swift flag `ACTIG_NO_APPLE_INTELLIGENCE` in the
// app's build settings. The app then falls back to MLX (if enabled) or the
// offline stub — no other edits required.
#if canImport(FoundationModels) && !ACTIG_NO_APPLE_INTELLIGENCE
import FoundationModels

@available(iOS 26.0, *)
final class FoundationModelsEngine: LLMEngine {
    let displayName = "Apple Foundation Models (on-device)"

    static var isSupported: Bool {
        SystemLanguageModel.default.availability == .available
    }

    private var session: LanguageModelSession?

    func load(progress: @escaping (Double) -> Void) async throws {
        guard FoundationModelsEngine.isSupported else {
            throw LLMEngineError.unavailable("Apple Intelligence is not available on this device.")
        }
        session = LanguageModelSession()
        progress(1.0)
    }

    func reply(to messages: [ChatMessage], system: String) -> AsyncThrowingStream<LLMToken, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let session = LanguageModelSession(instructions: system)
                    let prompt = messages.last(where: { $0.role == .user })?.text ?? ""

                    let responseStream = session.streamResponse(to: prompt)
                    var previous = ""
                    for try await partial in responseStream {
                        if Task.isCancelled { break }
                        // Foundation Models streams cumulative snapshots; emit the delta.
                        let full = partial.content
                        if full.count > previous.count {
                            let delta = String(full.dropFirst(previous.count))
                            continuation.yield(LLMToken(text: delta))
                            previous = full
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
#else
// Stand-in so references compile when the framework is unavailable.
@available(iOS 26.0, *)
final class FoundationModelsEngine: LLMEngine {
    let displayName = "Apple Foundation Models (unavailable)"
    static var isSupported: Bool { false }
    func load(progress: @escaping (Double) -> Void) async throws {
        throw LLMEngineError.unavailable("FoundationModels framework not present in this toolchain.")
    }
    func reply(to messages: [ChatMessage], system: String) -> AsyncThrowingStream<LLMToken, Error> {
        AsyncThrowingStream { $0.finish(throwing: LLMEngineError.unavailable("unavailable")) }
    }
}
#endif
