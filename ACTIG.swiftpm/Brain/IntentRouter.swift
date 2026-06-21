import Foundation

/// A command A.C.T.I.G. can act on locally, before (or instead of) consulting
/// the language model. Keeping these as fast keyword intents gives the snappy,
/// human-like reaction time the request asks for — control commands never wait
/// on token generation.
enum AssistantIntent: Equatable {
    case wake
    case shutdown
    case openSceneWorkspace
    case openConversation
    case openCamera
    case enableCameraControl
    case disableCameraControl
    case analyzeObject(question: String)
    case undo
    case redo
    case scene(SceneIntent)
    case chat(String)            // fall through to the LLM
}

/// 3D-space sub-commands parsed from natural language.
struct SceneIntent: Equatable {
    enum Action: Equatable {
        case add(ShapeKind)
        case multiply(ShapeKind, count: Int)
        case grow
        case shrink
        case delete
        case swap
        case clear
    }
    let action: Action
}

/// Parses raw user text (typed or transcribed) into an intent. This is
/// deliberately simple and deterministic; anything unrecognised becomes
/// `.chat` and is answered by the model.
enum IntentRouter {
    static func parse(_ raw: String) -> AssistantIntent {
        let t = raw.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // Lifecycle
        if t.contains("wake up actig") || t == "wake up" { return .wake }
        if t.contains("shut down all systems") || t.contains("shutdown all systems") { return .shutdown }

        // Workspace switching
        if t.matchesAny("3d project", "3d space", "modeling", "modelling", "bring up the project", "open the project") {
            return .openSceneWorkspace
        }
        if t.matchesAny("conversation", "go back to chat", "close project") { return .openConversation }

        // Camera control (opt-in only)
        if t.matchesAny("enable camera control", "enable finger control", "enable hand control", "control with my hand", "use my fingers") {
            return .enableCameraControl
        }
        if t.matchesAny("disable camera control", "stop camera control", "stop hand control", "stop finger control") {
            return .disableCameraControl
        }
        if t.matchesAny("open camera", "camera mode") { return .openCamera }

        // Object analysis
        if t.matchesAny("scan this", "what is this", "analyze this", "analyse this", "identify this", "what am i holding") {
            return .analyzeObject(question: raw)
        }

        // Undo / redo
        if t.matchesAny("undo", "go back", "previous action", "revert") { return .undo }
        if t.matchesAny("redo", "do it again") { return .redo }

        // Scene editing
        if let scene = parseScene(t) { return .scene(scene) }

        return .chat(raw)
    }

    private static func parseScene(_ t: String) -> SceneIntent? {
        guard let kind = ShapeKind.detect(in: t) ?? implicitKind(t) else {
            // Non-kind scene verbs that act on the selection.
            if t.matchesAny("bigger", "grow", "extend", "enlarge", "scale up") { return SceneIntent(action: .grow) }
            if t.matchesAny("smaller", "shrink", "scale down") { return SceneIntent(action: .shrink) }
            if t.matchesAny("delete", "remove") { return SceneIntent(action: .delete) }
            if t.matchesAny("swap", "switch places", "swap positions") { return SceneIntent(action: .swap) }
            if t.matchesAny("clear the scene", "clear scene", "remove everything", "start over") { return SceneIntent(action: .clear) }
            return nil
        }

        if let n = extractCount(t), t.matchesAny("multiply", "copies", "duplicate", "times") {
            return SceneIntent(action: .multiply(kind, count: n))
        }
        if t.matchesAny("add", "create", "make", "spawn", "call", "give me", "place") {
            return SceneIntent(action: .add(kind))
        }
        // Bare "a cube" etc. still adds it.
        return SceneIntent(action: .add(kind))
    }

    private static func implicitKind(_ t: String) -> ShapeKind? {
        ShapeKind.detect(in: t)
    }

    private static func extractCount(_ t: String) -> Int? {
        let words: [String: Int] = ["two": 2, "three": 3, "four": 4, "five": 5,
                                    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10]
        for (w, n) in words where t.contains(w) { return n }
        let digits = t.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
        return digits.first
    }
}

private extension String {
    func matchesAny(_ needles: String...) -> Bool {
        needles.contains { self.contains($0) }
    }
}
