import SwiftUI

/// The always-present (in-app) Jarvis hologram layer. It hosts the pulsing
/// core, the chat box, the two mic buttons and the live status, and can be
/// dragged anywhere on screen so it "hovers" over whatever workspace is active.
///
/// When the assistant is `.dormant`, only a compact wake affordance shows.
struct HologramOverlay: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var assistant: AssistantController

    @State private var dragOffset: CGSize = .zero
    @State private var committedOffset: CGSize = CGSize(width: 0, height: 0)

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .trailing, spacing: 14) {
                Spacer()

                if state.mode == .dormant {
                    dormantBadge
                } else {
                    activePanel
                }

                micRow
            }
            .frame(maxWidth: 460, alignment: .trailing)
            .padding(20)
            .offset(x: committedOffset.width + dragOffset.width,
                    y: committedOffset.height + dragOffset.height)
            .position(x: geo.size.width - 250, y: geo.size.height / 2)
            .gesture(
                DragGesture()
                    .onChanged { dragOffset = $0.translation }
                    .onEnded { _ in
                        committedOffset.width += dragOffset.width
                        committedOffset.height += dragOffset.height
                        dragOffset = .zero
                    }
            )
        }
    }

    // MARK: - Dormant

    private var dormantBadge: some View {
        Button {
            Task { await assistant.wake() }
        } label: {
            HStack(spacing: 12) {
                HoloCore(active: false, responding: false)
                    .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text("A.C.T.I.G.")
                        .font(.headline).foregroundStyle(HoloTheme.accent)
                    Text("say “wake up ACTIG”")
                        .font(.caption2).foregroundStyle(HoloTheme.primary.opacity(0.8))
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(HoloTheme.panel(Capsule()))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Active

    private var activePanel: some View {
        HoloPanel {
            VStack(spacing: 12) {
                header
                Divider().overlay(HoloTheme.primary.opacity(0.4))
                HologramChatBox()
                    .frame(minHeight: 260, maxHeight: 420)
            }
            .padding(16)
        }
        .frame(width: 420)
        .transition(.scale(scale: 0.92).combined(with: .opacity))
    }

    private var header: some View {
        HStack(spacing: 14) {
            HoloCore(active: true, responding: state.mode == .responding)
                .frame(width: 54, height: 54)
            VStack(alignment: .leading, spacing: 2) {
                Text("A.C.T.I.G.")
                    .font(.title3.bold())
                    .foregroundStyle(HoloTheme.accent)
                Text(state.statusLine)
                    .font(.caption)
                    .foregroundStyle(HoloTheme.primary.opacity(0.9))
                    .animation(.default, value: state.statusLine)
            }
            Spacer()
            workspaceSwitch
        }
    }

    /// Quick switch between the conversation, 3D and camera surfaces.
    private var workspaceSwitch: some View {
        HStack(spacing: 8) {
            switchButton(.conversation, system: "bubble.left.and.text.bubble.right")
            switchButton(.scene3D, system: "cube.transparent")
            switchButton(.camera, system: "camera.viewfinder")
        }
    }

    private func switchButton(_ ws: Workspace, system: String) -> some View {
        Button {
            withAnimation(.spring) { state.workspace = ws }
        } label: {
            Image(systemName: system)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 34, height: 34)
                .foregroundStyle(state.workspace == ws ? Color.black : HoloTheme.primary)
                .background(
                    Circle().fill(state.workspace == ws ? HoloTheme.accent : HoloTheme.deep.opacity(0.5))
                )
                .overlay(Circle().stroke(HoloTheme.primary.opacity(0.6), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Mic buttons

    private var micRow: some View {
        HStack(spacing: 16) {
            HologramMicButton(
                title: "You",
                systemOn: "mic.fill",
                systemOff: "mic.slash.fill",
                isMuted: state.userMicMuted
            ) {
                state.userMicMuted.toggle()
                assistant.userMicMuteChanged()
            }

            HologramMicButton(
                title: "ACTIG",
                systemOn: "speaker.wave.2.fill",
                systemOff: "speaker.slash.fill",
                isMuted: state.aiVoiceMuted
            ) {
                state.aiVoiceMuted.toggle()
                assistant.aiVoiceMuteChanged()
            }
        }
        .opacity(state.mode == .dormant ? 0 : 1)
    }
}
