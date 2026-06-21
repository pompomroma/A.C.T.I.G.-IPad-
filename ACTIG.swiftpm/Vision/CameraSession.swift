import Foundation
import AVFoundation
import CoreImage

/// Thin wrapper over `AVCaptureSession` that vends pixel buffers to consumers
/// (hand tracking and object analysis). Runs the session off the main thread and
/// publishes the latest frame for one-shot capture.
final class CameraSession: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "actig.camera.queue")

    /// Latest frame, for one-shot analysis ("scan this").
    private(set) var latestPixelBuffer: CVPixelBuffer?

    /// Continuous frame callback (used by hand tracking).
    var onFrame: ((CVPixelBuffer) -> Void)?

    func requestAccess() async -> Bool {
        await withCheckedContinuation { cont in
            AVCaptureDevice.requestAccess(for: .video) { cont.resume(returning: $0) }
        }
    }

    func configure(front: Bool = false) {
        session.beginConfiguration()
        session.sessionPreset = .high

        let position: AVCaptureDevice.Position = front ? .front : .back
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            session.commitConfiguration()
            return
        }
        // Replace any existing inputs.
        session.inputs.forEach { session.removeInput($0) }
        session.addInput(input)

        output.setSampleBufferDelegate(self, queue: queue)
        output.alwaysDiscardsLateVideoFrames = true
        if session.canAddOutput(output) { session.addOutput(output) }

        session.commitConfiguration()
    }

    func start() {
        queue.async { [weak self] in
            guard let self, !self.session.isRunning else { return }
            self.session.startRunning()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }
}

extension CameraSession: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        latestPixelBuffer = buffer
        onFrame?(buffer)
    }
}
