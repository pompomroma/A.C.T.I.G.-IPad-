import SwiftUI

/// Centralized "Jarvis" blue-hologram styling: colors, glows, glassy materials
/// and the animated scanline / grid motifs reused across the overlay.
enum HoloTheme {
    static let primary = Color(red: 0.32, green: 0.74, blue: 1.0)      // bright cyan-blue
    static let deep = Color(red: 0.05, green: 0.16, blue: 0.30)        // deep panel blue
    static let accent = Color(red: 0.55, green: 0.90, blue: 1.0)       // highlight
    static let danger = Color(red: 1.0, green: 0.35, blue: 0.42)

    /// Full-screen dark backdrop with a faint radial blue projection.
    static var backdrop: some View {
        ZStack {
            Color.black
            RadialGradient(
                colors: [primary.opacity(0.18), .black.opacity(0.0)],
                center: .center,
                startRadius: 40,
                endRadius: 900
            )
        }
    }

    /// Glassy translucent panel material with a glowing blue rim.
    static func panel<S: Shape>(_ shape: S) -> some View {
        shape
            .fill(deep.opacity(0.35))
            .background(.ultraThinMaterial, in: shape)
            .overlay(
                shape.stroke(
                    LinearGradient(
                        colors: [primary.opacity(0.9), accent.opacity(0.4)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.2
                )
            )
            .shadow(color: primary.opacity(0.55), radius: 14)
    }
}

/// A reusable rounded glass panel container.
struct HoloPanel<Content: View>: View {
    var cornerRadius: CGFloat = 22
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .background(
                HoloTheme.panel(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            )
    }
}

/// Animated faint perspective grid used behind workspaces — the "projected
/// floor" look from sci-fi HUDs.
struct HoloGrid: View {
    @State private var phase: CGFloat = 0

    var body: some View {
        TimelineView(.animation) { context in
            Canvas { ctx, size in
                let spacing: CGFloat = 48
                let t = context.date.timeIntervalSinceReferenceDate
                let drift = CGFloat((t.truncatingRemainder(dividingBy: 4)) / 4) * spacing
                var path = Path()
                var y = drift
                while y < size.height {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                    y += spacing
                }
                var x: CGFloat = 0
                while x < size.width {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: size.height))
                    x += spacing
                }
                ctx.stroke(path, with: .color(HoloTheme.primary.opacity(0.35)), lineWidth: 0.6)
            }
        }
        .blendMode(.screen)
    }
}

/// A soft pulsing ring used as the "core" of the assistant — its visual
/// heartbeat. Pulses faster while responding.
struct HoloCore: View {
    var active: Bool
    var responding: Bool
    @State private var pulse = false

    var body: some View {
        ZStack {
            ForEach(0..<3) { i in
                Circle()
                    .stroke(HoloTheme.primary.opacity(0.6 - Double(i) * 0.18), lineWidth: 2)
                    .scaleEffect(pulse ? 1.0 + CGFloat(i) * 0.18 : 0.85 + CGFloat(i) * 0.12)
                    .opacity(active ? 1 : 0.4)
            }
            Circle()
                .fill(
                    RadialGradient(
                        colors: [HoloTheme.accent, HoloTheme.primary.opacity(0.2)],
                        center: .center, startRadius: 1, endRadius: 26
                    )
                )
                .frame(width: 26, height: 26)
                .shadow(color: HoloTheme.primary, radius: active ? 16 : 6)
        }
        .frame(width: 90, height: 90)
        .onAppear { pulse = true }
        .animation(
            .easeInOut(duration: responding ? 0.5 : 1.6).repeatForever(autoreverses: true),
            value: pulse
        )
    }
}
