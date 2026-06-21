import Foundation
import Vision
import simd

/// Camera-based finger-movement control for the 3D space. Uses Vision's
/// `VNDetectHumanHandPoseRequest` to track the hand and interprets a pinch
/// (thumb tip near index tip) as "grab", movement-while-pinched as drag, and
/// release as drop (committing the move to undo).
///
/// This only runs when the user explicitly enables it ("enable camera controls")
/// — it is opt-in by design and never touches the screen.
@MainActor
final class HandTrackingController: ObservableObject {
    @Published var isActive = false
    @Published var pinching = false
    /// Normalized fingertip position (0...1), origin top-left. For HUD feedback.
    @Published var indicator: CGPoint = .zero

    private weak var store: SceneStore?

    private var grabbedId: UUID?
    private var grabStart: SIMD3<Float>?
    private var lastPoint: CGPoint?

    func attach(store: SceneStore) { self.store = store }
    func setActive(_ active: Bool) { isActive = active }

    /// Feed each camera frame here (called from the camera queue). Vision runs on
    /// the calling thread with a fresh request (no shared mutable state), then we
    /// hop to the main actor to update state and the scene.
    nonisolated func process(pixelBuffer: CVPixelBuffer) {
        let request = VNDetectHumanHandPoseRequest()
        request.maximumHandCount = 1
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up)
        try? handler.perform([request])
        let observation = request.results?.first

        // Extract Sendable primitives off the main actor, then hand them over.
        guard let obs = observation,
              let thumb = try? obs.recognizedPoint(.thumbTip),
              let index = try? obs.recognizedPoint(.indexTip),
              thumb.confidence > 0.3, index.confidence > 0.3 else { return }

        let indexPoint = CGPoint(x: index.location.x, y: 1 - index.location.y)
        let pinchDist = hypot(thumb.location.x - index.location.x,
                              thumb.location.y - index.location.y)
        let nowPinching = pinchDist < 0.06

        Task { @MainActor in
            self.update(indexPoint: indexPoint, nowPinching: nowPinching)
        }
    }

    private func update(indexPoint: CGPoint, nowPinching: Bool) {
        guard isActive, let store else { return }
        indicator = indexPoint

        if nowPinching && !pinching {
            beginGrab(store: store)
        } else if nowPinching, let id = grabbedId {
            dragGrab(id: id, to: indexPoint, store: store)
        } else if !nowPinching && pinching {
            endGrab(store: store)
        }
        lastPoint = indexPoint
        pinching = nowPinching
    }

    private func beginGrab(store: SceneStore) {
        let id = store.selection ?? store.shapes.last?.id
        grabbedId = id
        grabStart = id.flatMap { gid in store.shapes.first { $0.id == gid }?.position }
    }

    private func dragGrab(id: UUID, to point: CGPoint, store: SceneStore) {
        guard let last = lastPoint,
              let base = store.shapes.first(where: { $0.id == id })?.position else { return }
        let dx = Float(point.x - last.x) * 0.8
        let dy = Float(point.y - last.y) * -0.8
        store.liveMove(id: id, to: SIMD3<Float>(base.x + dx, base.y + dy, base.z))
    }

    private func endGrab(store: SceneStore) {
        if let id = grabbedId, let from = grabStart,
           let to = store.shapes.first(where: { $0.id == id })?.position {
            store.commitMove(id: id, from: from, to: to)
        }
        grabbedId = nil; grabStart = nil
    }
}
