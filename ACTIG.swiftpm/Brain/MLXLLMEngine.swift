import Foundation

// The MLX engine is only compiled when the mlx-swift-examples dependency is
// present. If you remove that dependency in Swift Playgrounds (e.g. to avoid a
// linker limit), this whole file no-ops and LLMEngineFactory falls back to the
// Foundation Models engine or the offline stub. See Package.swift.
#if canImport(MLXLLM)
import MLXLLM
import MLXLMCommon

/// On-device LLM powered by Apple's MLX framework. Metal-accelerated and
/// M-series native. Default model: Qwen2.5-3B-Instruct 4-bit (~1.8 GB), a strong
/// quality/speed balance on the M4. Change `modelId` to swap models.
final class MLXLLMEngine: LLMEngine {
    let displayName = "MLX · Qwen2.5-3B-Instruct (4-bit)"

    /// Hugging Face repo id of an MLX-format model. The weights download once on
    /// first launch (needs network that one time), then run fully offline.
    private let modelId = "mlx-community/Qwen2.5-3B-Instruct-4bit"

    private var container: ModelContainer?

    func load(progress: @escaping (Double) -> Void) async throws {
        let configuration = ModelConfiguration(id: modelId)
        container = try await LLMModelFactory.shared.loadContainer(
            configuration: configuration
        ) { p in
            progress(p.fractionCompleted)
        }
        progress(1.0)
    }

    func reply(to messages: [ChatMessage], system: String) -> AsyncThrowingStream<LLMToken, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let container else { throw LLMEngineError.notLoaded }

                    // Build the chat prompt from system + transcript.
                    var chat: [Chat.Message] = [.system(system)]
                    for m in messages {
                        switch m.role {
                        case .user: chat.append(.user(m.text))
                        case .assistant: chat.append(.assistant(m.text))
                        case .system: break
                        }
                    }

                    let userInput = UserInput(chat: chat)

                    try await container.perform { (context: ModelContext) in
                        let input = try await context.processor.prepare(input: userInput)
                        let params = GenerateParameters(temperature: 0.7, topP: 0.9)

                        let stream = try MLXLMCommon.generate(
                            input: input,
                            parameters: params,
                            context: context
                        )

                        for await item in stream {
                            if Task.isCancelled { break }
                            if case .chunk(let text) = item {
                                continuation.yield(LLMToken(text: text))
                            }
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
#endif
