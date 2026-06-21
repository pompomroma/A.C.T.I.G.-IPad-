import RealityKit
import UIKit
import simd

/// Builds RealityKit entities for a `ShapeNode` with the glowing blue hologram
/// look. Centralized so the editor view and the camera-control path stay in sync.
enum ShapeFactory {
    static func mesh(for kind: ShapeKind) -> MeshResource {
        switch kind {
        case .box:      return .generateBox(size: 1.0, cornerRadius: 0.04)
        case .sphere:   return .generateSphere(radius: 0.6)
        case .cylinder: return .generateCylinder(height: 1.0, radius: 0.5)
        case .cone:     return .generateCone(height: 1.0, radius: 0.5)
        case .pyramid:  return .generateCone(height: 1.0, radius: 0.6)   // 4-side cone approximation
        case .torus:    return .generateSphere(radius: 0.5)              // torus unavailable pre-visionOS; sphere stand-in
        case .plane:    return .generatePlane(width: 1.2, depth: 1.2, cornerRadius: 0.05)
        }
    }

    /// Translucent, glowing blue "hologram" material. `UnlitMaterial` reads as
    /// projected light (no shading) and supports per-channel alpha for the
    /// see-through hologram look — and compiles across RealityKit versions.
    static func material(hue: Float) -> RealityKit.Material {
        let color = UIColor(hue: CGFloat(hue), saturation: 0.7, brightness: 1.0, alpha: 0.6)
        return UnlitMaterial(color: color)
    }

    /// Creates a positioned, scaled entity for a node, tagging it with the node id.
    static func entity(for node: ShapeNode) -> ModelEntity {
        let entity = ModelEntity(mesh: mesh(for: node.kind), materials: [material(hue: node.hue)])
        entity.name = node.id.uuidString
        entity.position = node.position
        entity.scale = SIMD3<Float>(repeating: node.scale)
        entity.generateCollisionShapes(recursive: false)
        return entity
    }
}
