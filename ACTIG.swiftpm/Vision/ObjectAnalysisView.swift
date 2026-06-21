import SwiftUI
import AVFoundation

/// Live camera workspace used for object analysis and (when enabled) hand
/// control. Shows a preview with a scanning reticle; the actual capture/analysis
/// is triggered by the user saying "scan this / what is this" or tapping Scan.
struct ObjectAnalysisView: View {
    @EnvironmentObject private var assistant: AssistantController
    @EnvironmentObject private var state: AppState

    var body: some View {
        ZStack {
            CameraPreview(session: assistant.cameraSession.session)
                .ignoresSafeArea()

            // Scanning reticle.
            RoundedRectangle(cornerRadius: 28)
                .stroke(HoloTheme.primary.opacity(0.8), style: StrokeStyle(lineWidth: 2, dash: [10, 6]))
                .frame(width: 320, height: 320)
                .shadow(color: HoloTheme.primary, radius: 8)

            if state.cameraControlEnabled {
                HandIndicator()
            }

            VStack {
                Label("OBJECT ANALYSIS", systemImage: "viewfinder")
                    .font(.caption.bold()).foregroundStyle(HoloTheme.accent)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(HoloTheme.panel(Capsule()))
                    .padding(.top, 24)
                Spacer()
                Button {
                    Task { await assistant.scanObject(question: "What is this object?") }
                } label: {
                    Label("Scan object", systemImage: "camera.metering.spot")
                        .font(.headline).foregroundStyle(.black)
                        .padding(.horizontal, 22).padding(.vertical, 12)
                        .background(Capsule().fill(HoloTheme.accent))
                }
                .padding(.bottom, 36)
            }
        }
        .onAppear { assistant.startCamera() }
        .onDisappear { assistant.stopCamera() }
    }
}

/// Small HUD dot following the tracked fingertip while hand control is on.
private struct HandIndicator: View {
    @EnvironmentObject private var assistant: AssistantController
    var body: some View {
        GeometryReader { geo in
            Circle()
                .fill(assistant.handTracking.pinching ? HoloTheme.danger : HoloTheme.accent)
                .frame(width: 22, height: 22)
                .shadow(color: HoloTheme.primary, radius: 8)
                .position(x: assistant.handTracking.indicator.x * geo.size.width,
                          y: assistant.handTracking.indicator.y * geo.size.height)
                .animation(.linear(duration: 0.05), value: assistant.handTracking.indicator)
        }
        .allowsHitTesting(false)
    }
}

/// UIKit camera preview layer bridged into SwiftUI.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.videoPreviewLayer.session = session
        view.videoPreviewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
