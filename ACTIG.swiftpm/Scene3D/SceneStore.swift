import Foundation
import SwiftUI
import simd

/// The single source of truth for the 3D project space. Holds the shapes,
/// drives undo/redo via a command stack, and autosaves after every change.
///
/// All mutation goes through `apply(_:)` so every edit — whether from touch,
/// voice, or camera hand-tracking — is recorded and reversible.
@MainActor
final class SceneStore: ObservableObject {
    @Published private(set) var shapes: [ShapeNode] = []
    @Published var selection: UUID?

    private var undoStack: [SceneCommand] = []
    private var redoStack: [SceneCommand] = []

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    init() { load() }

    // MARK: - Command application

    /// Applies a command, records it for undo, clears the redo stack, autosaves.
    func apply(_ command: SceneCommand) {
        perform(command)
        undoStack.append(command)
        redoStack.removeAll()
        autosave()
    }

    func undo() {
        guard let cmd = undoStack.popLast() else { return }
        perform(cmd.inverse)
        redoStack.append(cmd)
        autosave()
    }

    func redo() {
        guard let cmd = redoStack.popLast() else { return }
        perform(cmd)
        undoStack.append(cmd)
        autosave()
    }

    /// Mutates `shapes` for a command without touching the history stacks.
    private func perform(_ command: SceneCommand) {
        switch command {
        case .add(let node):
            shapes.append(node)
            selection = node.id
        case .remove(let node):
            shapes.removeAll { $0.id == node.id }
            if selection == node.id { selection = shapes.last?.id }
        case .move(let id, _, let to):
            if let i = index(id) { shapes[i].position = to }
        case .scale(let id, _, let to):
            if let i = index(id) { shapes[i].scale = to }
        case .swap(let a, let b, _, let posB):
            // posB is the target for `a`; `b` gets the original `a` position,
            // both already encoded in the command's stored positions.
            if let ia = index(a), let ib = index(b) {
                let tmp = shapes[ia].position
                shapes[ia].position = posB
                shapes[ib].position = tmp
            }
        }
    }

    private func index(_ id: UUID) -> Int? { shapes.firstIndex { $0.id == id } }

    // MARK: - High-level operations (used by voice + touch + camera)

    func addShape(_ kind: ShapeKind, near: SIMD3<Float>? = nil) {
        let pos = near ?? randomSpawn()
        apply(.add(ShapeNode(kind: kind, position: pos, hue: Float.random(in: 0.45...0.62))))
    }

    func multiply(_ kind: ShapeKind, count: Int) {
        for _ in 0..<max(1, min(count, 25)) { addShape(kind) }
    }

    func grow(_ id: UUID?) { scaleSelected(id, factor: 1.25) }
    func shrink(_ id: UUID?) { scaleSelected(id, factor: 0.8) }

    private func scaleSelected(_ id: UUID?, factor: Float) {
        guard let id = id ?? selection, let i = index(id) else { return }
        let from = shapes[i].scale
        let to = max(0.02, min(from * factor, 1.2))
        apply(.scale(id: id, from: from, to: to))
    }

    func deleteSelected(_ id: UUID? = nil) {
        guard let id = id ?? selection, let node = shapes.first(where: { $0.id == id }) else { return }
        apply(.remove(node))
    }

    /// Records a drag as a single move command (call once at gesture end).
    func commitMove(id: UUID, from: SIMD3<Float>, to: SIMD3<Float>) {
        guard from != to else { return }
        apply(.move(id: id, from: from, to: to))
    }

    /// Live (uncommitted) drag — updates position without history; the final
    /// `commitMove` records the net change so undo restores the start point.
    func liveMove(id: UUID, to: SIMD3<Float>) {
        if let i = index(id) { shapes[i].position = to }
    }

    func swapFirstTwo() {
        guard shapes.count >= 2 else { return }
        let a = shapes[0], b = shapes[1]
        apply(.swap(a: a.id, b: b.id, posA: a.position, posB: b.position))
    }

    func clear() {
        for node in shapes.reversed() { apply(.remove(node)) }
    }

    private func randomSpawn() -> SIMD3<Float> {
        SIMD3<Float>(Float.random(in: -0.25...0.25),
                     Float.random(in: -0.1...0.2),
                     Float.random(in: -0.25...0.0))
    }

    // MARK: - Persistence (autosave)

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("actig_scene.json")
    }

    private func autosave() {
        if let data = try? JSONEncoder().encode(shapes) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let saved = try? JSONDecoder().decode([ShapeNode].self, from: data) else { return }
        shapes = saved
    }
}
