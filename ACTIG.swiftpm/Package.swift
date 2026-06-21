// swift-tools-version: 5.9

// ACTIG.swiftpm — A.C.T.I.G. offline on-device AI assistant for iPad Pro (M4).
//
// This is a Swift Playgrounds–compatible App package. It opens directly in
// Swift Playgrounds 4.5+ on the iPad (no Mac required) and can also be opened
// in Xcode 15+ on a Mac.
//
// On-device LLM strategy (see Brain/LLMEngine.swift):
//   • DEFAULT: Apple Foundation Models framework (Apple Intelligence, on-device,
//     zero download). Reliable in Swift Playgrounds — no external dependency.
//   • OPTIONAL: MLX Swift for a custom quantized model (Qwen2.5-3B, etc.). To
//     enable it, uncomment the dependency + product lines below; the code in
//     MLXLLMEngine.swift is already guarded by `#if canImport(MLXLLM)`.
//   • FALLBACK: an offline stub so the full UI/voice loop always runs.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "ACTIG",
    platforms: [
        .iOS("18.0")
    ],
    products: [
        .iOSApplication(
            name: "ACTIG",
            targets: ["ACTIG"],
            bundleIdentifier: "com.actig.assistant",
            teamIdentifier: nil,
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .sparkles),
            accentColor: .presetColor(.cyan),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ],
            capabilities: [
                .microphone(purposeString: "A.C.T.I.G. listens for your voice commands and wake word, fully on-device."),
                .speechRecognition(purposeString: "A.C.T.I.G. transcribes your speech on-device to understand commands."),
                .camera(purposeString: "A.C.T.I.G. uses the camera for hand-gesture controls and object analysis.")
            ],
            appCategory: .productivity
        )
    ],
    dependencies: [
        // OPTIONAL custom-model engine. Uncomment to use MLX (Metal-native, M4).
        // .package(url: "https://github.com/ml-explore/mlx-swift-examples.git", branch: "main")
    ],
    targets: [
        .executableTarget(
            name: "ACTIG",
            dependencies: [
                // Uncomment alongside the dependency above to enable MLX:
                // .product(name: "MLXLLM", package: "mlx-swift-examples"),
                // .product(name: "MLXLMCommon", package: "mlx-swift-examples")
            ],
            path: "."
        )
    ]
)
