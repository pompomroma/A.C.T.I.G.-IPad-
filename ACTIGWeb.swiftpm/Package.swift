// swift-tools-version: 5.9

// ACTIGWeb.swiftpm — runs the A.C.T.I.G. web app *inside* a Swift Playgrounds app.
//
// The entire web build (web/) is bundled under WebApp/ and served from a tiny
// in-app HTTP server on http://127.0.0.1, which is a "secure context" so the web
// app's camera, microphone and (where the engine supports it) WebGPU work. This
// makes every web function importable and runnable in Swift Playgrounds on iPad —
// and the 3D space + UI + voice output run fully offline because Three.js and all
// assets are bundled locally. (See docs/SWIFT_PLAYGROUNDS.md for what needs a
// network on first run.)

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "ACTIGWeb",
    platforms: [ .iOS("16.4") ],
    products: [
        .iOSApplication(
            name: "ACTIGWeb",
            targets: ["ACTIGWeb"],
            bundleIdentifier: "com.actig.web",
            teamIdentifier: nil,
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .sparkles),
            accentColor: .presetColor(.cyan),
            supportedDeviceFamilies: [ .pad, .phone ],
            supportedInterfaceOrientations: [
                .portrait, .landscapeRight, .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ],
            capabilities: [
                .camera(purposeString: "A.C.T.I.G. uses the camera for hand-gesture controls and object analysis."),
                .microphone(purposeString: "A.C.T.I.G. listens for your voice commands.")
            ],
            appCategory: .productivity
        )
    ],
    targets: [
        .executableTarget(
            name: "ACTIGWeb",
            path: ".",
            resources: [ .copy("WebApp") ]
        )
    ]
)
