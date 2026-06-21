import SwiftUI

/// A single blue hologram mic/speaker button. Two of these are shown: one mutes
/// the user's microphone (stop listening), the other mutes A.C.T.I.G.'s spoken
/// voice. Muted state dims the glow and switches to the slashed icon.
struct HologramMicButton: View {
    let title: String
    let systemOn: String
    let systemOff: String
    let isMuted: Bool
    let action: () -> Void

    @State private var ripple = false

    var body: some View {
        Button {
            action()
            ripple.toggle()
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    Circle()
                        .fill(HoloTheme.deep.opacity(0.55))
                        .overlay(
                            Circle().stroke(
                                isMuted ? HoloTheme.danger.opacity(0.8) : HoloTheme.primary.opacity(0.9),
                                lineWidth: 1.5
                            )
                        )
                        .frame(width: 58, height: 58)
                        .shadow(color: isMuted ? HoloTheme.danger.opacity(0.4) : HoloTheme.primary.opacity(0.6),
                                radius: isMuted ? 4 : 12)

                    Image(systemName: isMuted ? systemOff : systemOn)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(isMuted ? HoloTheme.danger : HoloTheme.accent)
                        .symbolEffect(.bounce, value: ripple)
                }
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(HoloTheme.primary.opacity(0.85))
            }
        }
        .buttonStyle(.plain)
    }
}
