import Foundation
import simd

/// The kinds of primitive a user can "call" into the 3D space.
enum ShapeKind: String, CaseIterable, Codable {
    case box, sphere, cylinder, cone, pyramid, torus, plane

    /// Map loose natural language to a kind ("cube" -> box, "ball" -> sphere…).
    static func detect(in text: String) -> ShapeKind? {
        let map: [String: ShapeKind] = [
            "cube": .box, "box": .box, "block": .box,
            "sphere": .sphere, "ball": .sphere, "orb": .sphere,
            "cylinder": .cylinder, "tube": .cylinder, "can": .cylinder,
            "cone": .cone,
            "pyramid": .pyramid,
            "torus": .torus, "donut": .torus, "ring": .torus,
            "plane": .plane, "floor": .plane, "panel": .plane
        ]
        for (k, v) in map where text.contains(k) { return v }
        return nil
    }
}

/// A serializable shape instance in the scene.
struct ShapeNode: Identifiable, Codable, Equatable {
    let id: UUID
    var kind: ShapeKind
    var position: SIMD3<Float>
    var scale: Float
    var hue: Float   // 0...1 around the blue hologram palette

    init(id: UUID = UUID(), kind: ShapeKind, position: SIMD3<Float>, scale: Float = 0.12, hue: Float = 0.55) {
        self.id = id
        self.kind = kind
        self.position = position
        self.scale = scale
        self.hue = hue
    }
}

/// A reversible edit. Each command knows how to apply and revert itself, which
/// is what powers automatic undo/redo and the "bring back previous actions"
/// requirement. Commands are recorded by `SceneStore` onto an undo/redo stack.
enum SceneCommand: Equatable {
    case add(ShapeNode)
    case remove(ShapeNode)
    case move(id: UUID, from: SIMD3<Float>, to: SIMD3<Float>)
    case scale(id: UUID, from: Float, to: Float)
    case swap(a: UUID, b: UUID, posA: SIMD3<Float>, posB: SIMD3<Float>)

    /// The inverse command used when undoing.
    var inverse: SceneCommand {
        switch self {
        case .add(let n): return .remove(n)
        case .remove(let n): return .add(n)
        case .move(let id, let from, let to): return .move(id: id, from: to, to: from)
        case .scale(let id, let from, let to): return .scale(id: id, from: to, to: from)
        case .swap(let a, let b, let pa, let pb): return .swap(a: a, b: b, posA: pb, posB: pa)
        }
    }
}
