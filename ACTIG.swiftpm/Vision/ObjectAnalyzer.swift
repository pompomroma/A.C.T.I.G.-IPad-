import Foundation
import Vision
import CoreImage

/// The result of analysing an object shown to the camera.
struct ObjectAnalysis {
    let classifications: [(label: String, confidence: Float)]
    let recognizedText: [String]
    let dominantColors: [String]

    /// A compact natural-language summary handed to the LLM so it can answer the
    /// user's question with context.
    var summary: String {
        var parts: [String] = []
        if let top = classifications.first {
            let others = classifications.dropFirst().prefix(3).map { $0.label }.joined(separator: ", ")
            parts.append("Likely a \(top.label) (\(Int(top.confidence * 100))% confidence)" +
                         (others.isEmpty ? "" : "; possibly: \(others)"))
        }
        if !recognizedText.isEmpty {
            parts.append("Visible text: \"\(recognizedText.prefix(8).joined(separator: " "))\"")
        }
        if !dominantColors.isEmpty {
            parts.append("Dominant colours: \(dominantColors.joined(separator: ", "))")
        }
        return parts.isEmpty ? "No distinguishing features detected." : parts.joined(separator: ". ")
    }
}

/// Runs Vision requests on a single captured frame to identify an object: image
/// classification, on-image text (OCR) and dominant colours. The structured
/// `summary` is then passed to the LLM so A.C.T.I.G. can answer questions about
/// what it sees — all on-device.
final class ObjectAnalyzer {
    func analyze(pixelBuffer: CVPixelBuffer) async -> ObjectAnalysis {
        async let classes = classify(pixelBuffer)
        async let text = recognizeText(pixelBuffer)
        let colors = dominantColors(pixelBuffer)
        return ObjectAnalysis(classifications: await classes,
                              recognizedText: await text,
                              dominantColors: colors)
    }

    // MARK: - Classification

    private func classify(_ buffer: CVPixelBuffer) async -> [(String, Float)] {
        await withCheckedContinuation { cont in
            let request = VNClassifyImageRequest { req, _ in
                let results = (req.results as? [VNClassificationObservation] ?? [])
                    .filter { $0.confidence > 0.1 }
                    .prefix(5)
                    .map { ($0.identifier.replacingOccurrences(of: "_", with: " "), $0.confidence) }
                cont.resume(returning: Array(results))
            }
            let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up)
            try? handler.perform([request])
        }
    }

    // MARK: - OCR

    private func recognizeText(_ buffer: CVPixelBuffer) async -> [String] {
        await withCheckedContinuation { cont in
            let request = VNRecognizeTextRequest { req, _ in
                let strings = (req.results as? [VNRecognizedTextObservation] ?? [])
                    .compactMap { $0.topCandidates(1).first?.string }
                cont.resume(returning: strings)
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up)
            try? handler.perform([request])
        }
    }

    // MARK: - Colours

    private func dominantColors(_ buffer: CVPixelBuffer) -> [String] {
        let ci = CIImage(cvPixelBuffer: buffer)
        let context = CIContext()
        guard let filter = CIFilter(name: "CIAreaAverage",
                                    parameters: [kCIInputImageKey: ci,
                                                 kCIInputExtentKey: CIVector(cgRect: ci.extent)]),
              let output = filter.outputImage else { return [] }
        var bitmap = [UInt8](repeating: 0, count: 4)
        context.render(output, toBitmap: &bitmap, rowBytes: 4,
                       bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                       format: .RGBA8, colorSpace: nil)
        return [colorName(r: bitmap[0], g: bitmap[1], b: bitmap[2])]
    }

    private func colorName(r: UInt8, g: UInt8, b: UInt8) -> String {
        let rf = Int(r), gf = Int(g), bf = Int(b)
        if rf > 180 && gf > 180 && bf > 180 { return "white" }
        if rf < 60 && gf < 60 && bf < 60 { return "black" }
        if rf > gf && rf > bf { return "red/warm" }
        if gf > rf && gf > bf { return "green" }
        if bf > rf && bf > gf { return "blue" }
        return "neutral grey"
    }
}
