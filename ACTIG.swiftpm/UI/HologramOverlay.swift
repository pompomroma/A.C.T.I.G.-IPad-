import SwiftUI

/// The always-present (in-app) Jarvis hologram layer. It hosts the pulsing
/// core, the chat box, the two mic buttons and the live status, and can be
/// dragged anywhere on screen so it "hovers" over whatever workspace is active.
///
/// Layout adapts to the device: on iPad (regular width) the panel anchors to the
/// bottom-right at a fixed width; on iPhone (compact width) it spans the screen
/// width and anchors to the bottom so every control stays reachable.
///
/// When the assistant is `.dormant`, only a compact wake affordance shows.
struct HologramOverlay: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var assistant: AssistantController
    @Environment(\.horizontalSizeClass) private var hSize

    @State private var dragOffset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            let compact = hSize == .compact || geo.size.width < 500
            let panelWidth = min(compact ? geo.size.width - 20 : 420, geo.size.width - 16)
            let chatMaxHeight = geo.size.height * (compact ? 0.46 : 0.58)

            VStack(alignment: .trailing, spacing: compact ? 10 : 14) {
                Spacer(minLength: 0)

                if state.mode == .dormant {
                    dormantBadge
                } else {
                    activePanel(width: panelWidth, chatMaxHeight: chatMaxHeight, compact: compact)
                }

                micRow(compact: compact)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity,
                   alignment: compact ? .bottom : .bottomTrailing)
            .padding(compact ? 12 : 20)
            .offset(x: committedOffset.width + dragOffset.width,
                    y: committedOffset.height + dragOffset.height)
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

    private func activePanel(width: CGFloat, chatMaxHeight: CGFloat, compact: Bool) -> some View {
        HoloPanel {
            VStack(spacing: compact ? 8 : 12) {
                header(compact: compact)
                Divider().overlay(HoloTheme.primary.opacity(0.4))
                HologramChatBox()
                    .frame(minHeight: compact ? 180 : 260, maxHeight: chatMaxHeight)
            }
            .padding(compact ? 12 : 16)
        }
        .frame(width: width)
        .transition(.scale(scale: 0.92).combined(with: .opacity))
    }

    private func header(compact: Bool) -> some View {
        HStack(spacing: compact ? 10 : 14) {
            HoloCore(active: true, responding: state.mode == .responding)
                .frame(width: compact ? 44 : 54, height: compact ? 44 : 54)
            VStack(alignment: .leading, spacing: 2) {
                Text("A.C.T.I.G.")
                    .font((compact ? Font.headline : Font.title3).bold())
                    .foregroundStyle(HoloTheme.accent)
                Text(state.statusLine)
                    .font(.caption)
                    .foregroundStyle(HoloTheme.primary.opacity(0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .animation(.default, value: state.statusLine)
            }
            Spacer(minLength: 4)
            workspaceSwitch(compact: compact)
        }
    }

    /// Quick switch between the conversation, 3D and camera surfaces.
    private func workspaceSwitch(compact: Bool) -> some View {
        HStack(spacing: compact ? 6 : 8) {
            switchButton(.conversation, system: "bubble.left.and.text.bubble.right", compact: compact)
            switchButton(.scene3D, system: "cube.transparent", compact: compact)
            switchButton(.camera, system: "camera.viewfinder", compact: compact)
        }
    }

    private func switchButton(_ ws: Workspace, system: String, compact: Bool) -> some View {
        let side: CGFloat = compact ? 30 : 34
        return Button {
            withAnimation(.spring) { state.workspace = ws }
        } label: {
            Image(systemName: system)
                .font(.system(size: compact ? 13 : 15, weight: .semibold))
                .frame(width: side, height: side)
                .foregroundStyle(state.workspace == ws ? Color.black : HoloTheme.primary)
                .background(
                    Circle().fill(state.workspace == ws ? HoloTheme.accent : HoloTheme.deep.opacity(0.5))
                )
                .overlay(Circle().stroke(HoloTheme.primary.opacity(0.6), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Mic buttons

    private func micRow(compact: Bool) -> some View {
        HStack(spacing: compact ? 12 : 16) {
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
