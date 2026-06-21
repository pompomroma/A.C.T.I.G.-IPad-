import SwiftUI
import RealityKit
import simd

/// The 3D modelling project space. Renders the `SceneStore` shapes in a
/// RealityKit scene and supports on-screen manipulation (tap to select, drag to
/// move). Voice commands and camera hand-tracking drive the same store, so every
/// path benefits from the shared undo/redo + autosave.
struct SceneEditorView: View {
    @EnvironmentObject private var store: SceneStore
    @EnvironmentObject private var state: AppState

    var body: some View {
        ZStack {
            RealitySceneView()
                .environmentObject(store)
                .ignoresSafeArea()

            // Floor grid for depth cues.
            HoloGrid().opacity(0.18).allowsHitTesting(false)

            VStack {
                topBar
                Spacer()
                bottomToolbar
            }
            .padding(24)
        }
    }

    private var topBar: some View {
        HStack {
            Label("3D PROJECT SPACE", systemImage: "cube.transparent")
                .font(.caption.bold())
                .foregroundStyle(HoloTheme.accent)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(HoloTheme.panel(Capsule()))
            Spacer()
            if state.cameraControlEnabled {
                Label("HAND CONTROL ON", systemImage: "hand.raised.fingers.spread")
                    .font(.caption.bold())
                    .foregroundStyle(HoloTheme.accent)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(HoloTheme.panel(Capsule()))
            }
        }
    }

    private var bottomToolbar: some View {
        HStack(spacing: 14) {
            toolButton("plus.square", "Box") { store.addShape(.box) }
            toolButton("circle", "Sphere") { store.addShape(.sphere) }
            toolButton("cylinder", "Cyl") { store.addShape(.cylinder) }
            toolButton("triangle", "Cone") { store.addShape(.cone) }

            Divider().frame(height: 30).overlay(HoloTheme.primary.opacity(0.4))

            toolButton("plus.magnifyingglass", "Grow") { store.grow(store.selection) }
            toolButton("minus.magnifyingglass", "Shrink") { store.shrink(store.selection) }
            toolButton("trash", "Delete") { store.deleteSelected() }

            Divider().frame(height: 30).overlay(HoloTheme.primary.opacity(0.4))

            toolButton("arrow.uturn.backward", "Undo", enabled: store.canUndo) { store.undo() }
            toolButton("arrow.uturn.forward", "Redo", enabled: store.canRedo) { store.redo() }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(HoloTheme.panel(RoundedRectangle(cornerRadius: 20, style: .continuous)))
    }

    private func toolButton(_ icon: String, _ label: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 18, weight: .semibold))
                Text(label).font(.system(size: 9))
            }
            .foregroundStyle(enabled ? HoloTheme.accent : HoloTheme.primary.opacity(0.3))
            .frame(width: 46)
        }
        .disabled(!enabled)
        .buttonStyle(.plain)
    }
}

/// Camera workspace placeholder shown when the user switches to camera mode for
/// object analysis (the live preview is provided by `CameraWorkspaceView`).
struct CameraWorkspaceView: View {
    var body: some View { ObjectAnalysisView() }
}

// MARK: - RealityKit bridge

/// Bridges the `SceneStore` to a RealityKit `ARView` (non-AR camera, just a 3D
/// canvas) and keeps the rendered entities in sync with the store. Handles tap
/// selection and drag-to-move, committing moves to the undo stack.
struct RealitySceneView: UIViewRepresentable {
    @EnvironmentObject private var store: SceneStore

    func makeCoordinator() -> Coordinator { Coordinator(store: store) }

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
        view.environment.background = .color(.black)

        let anchor = AnchorEntity(world: .zero)
        view.scene.addAnchor(anchor)
        context.coordinator.anchor = anchor
        context.coordinator.arView = view

        // A fixed camera looking at the origin.
        let camera = PerspectiveCamera()
        camera.position = SIMD3<Float>(0, 0.25, 1.1)
        camera.look(at: .zero, from: camera.position, relativeTo: nil)
        let camAnchor = AnchorEntity(world: .zero)
        camAnchor.addChild(camera)
        view.scene.addAnchor(camAnchor)

        // Gestures
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.onTap(_:)))
        view.addGestureRecognizer(tap)
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.onPan(_:)))
        view.addGestureRecognizer(pan)

        context.coordinator.rebuild(from: store.shapes)
        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        context.coordinator.sync(to: store.shapes, selection: store.selection)
    }

    @MainActor
    final class Coordinator: NSObject {
        let store: SceneStore
        weak var arView: ARView?
        var anchor: AnchorEntity?
        private var entities: [UUID: ModelEntity] = [:]
        private var dragStart: SIMD3<Float>?
        private var draggingId: UUID?

        init(store: SceneStore) { self.store = store }

        /// Full rebuild (used once at setup).
        func rebuild(from shapes: [ShapeNode]) {
            entities.values.forEach { $0.removeFromParent() }
            entities.removeAll()
            shapes.forEach { add($0) }
        }

        /// Incremental sync: add new, remove gone, update transforms.
        func sync(to shapes: [ShapeNode], selection: UUID?) {
            let ids = Set(shapes.map { $0.id })
            for (id, ent) in entities where !ids.contains(id) {
                ent.removeFromParent(); entities[id] = nil
            }
            for node in shapes {
                if let ent = entities[node.id] {
                    ent.position = node.position
                    ent.scale = SIMD3<Float>(repeating: node.scale)
                } else {
                    add(node)
                }
            }
        }

        private func add(_ node: ShapeNode) {
            let ent = ShapeFactory.entity(for: node)
            anchor?.addChild(ent)
            entities[node.id] = ent
        }

        private func nodeId(for entity: Entity) -> UUID? {
            UUID(uuidString: entity.name)
        }

        @objc func onTap(_ g: UITapGestureRecognizer) {
            guard let view = arView else { return }
            let loc = g.location(in: view)
            if let hit = view.entity(at: loc), let id = nodeId(for: hit) {
                store.selection = id
            }
        }

        @objc func onPan(_ g: UIPanGestureRecognizer) {
            guard let view = arView else { return }
            let loc = g.location(in: view)
            switch g.state {
            case .began:
                if let hit = view.entity(at: loc), let id = nodeId(for: hit) {
                    draggingId = id
                    dragStart = entities[id]?.position
                    store.selection = id
                }
            case .changed:
                guard let id = draggingId, let ent = entities[id] else { return }
                // Project screen delta onto the x/y plane at the entity depth.
                let t = g.translation(in: view)
                let scale: Float = 0.0016
                let base = dragStart ?? ent.position
                let newPos = SIMD3<Float>(base.x + Float(t.x) * scale,
                                          base.y - Float(t.y) * scale,
                                          base.z)
                store.liveMove(id: id, to: newPos)
            case .ended, .cancelled:
                if let id = draggingId, let from = dragStart, let ent = entities[id] {
                    store.commitMove(id: id, from: from, to: ent.position)
                }
                draggingId = nil; dragStart = nil
            default: break
            }
        }
    }
}
