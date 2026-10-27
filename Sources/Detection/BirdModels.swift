import Foundation
import Vision
import CoreML
import CoreGraphics

final class BirdDetector {
    private let visionModel: VNCoreMLModel?
    let loadError: String?

    init() {
        guard let url = Bundle.main.url(forResource: "BirdDetector", withExtension: "mlmodelc") ?? Bundle.module.url(forResource: "BirdDetector", withExtension: "mlmodelc") else {
            visionModel = nil
            loadError = "BirdDetector.mlmodel is not bundled yet. Import and annotate data, then add a trained detector model."
            return
        }
        do {
            visionModel = try VNCoreMLModel(for: MLModel(contentsOf: url))
            loadError = nil
        } catch {
            visionModel = nil
            loadError = "Could not load BirdDetector: \(error.localizedDescription)"
        }
    }

    var isReady: Bool { visionModel != nil }

    func detect(in pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) throws -> [(CGRect, Float)] {
        guard let visionModel else { return [] }
        let request = VNCoreMLRequest(model: visionModel)
        request.imageCropAndScaleOption = .scaleFill
        try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation).perform([request])
        return (request.results as? [VNRecognizedObjectObservation] ?? [])
            .filter { observation in
                observation.labels.contains { $0.identifier.localizedCaseInsensitiveContains("bird") }
                    || observation.labels.contains { $0.identifier.localizedCaseInsensitiveContains("avian") }
            }
            .map { observation in
                (observation.boundingBox, observation.labels.first?.confidence ?? observation.confidence)
            }
    }
}

final class SpeciesClassifier {
    private let visionModel: VNCoreMLModel?
    let loadError: String?

    init() {
        guard let url = Bundle.main.url(forResource: "BirdSpeciesClassifier", withExtension: "mlmodelc") ?? Bundle.module.url(forResource: "BirdSpeciesClassifier", withExtension: "mlmodelc") else {
            visionModel = nil
            loadError = "BirdSpeciesClassifier.mlmodel is not bundled yet."
            return
        }
        do {
            visionModel = try VNCoreMLModel(for: MLModel(contentsOf: url))
            loadError = nil
        } catch {
            visionModel = nil
            loadError = "Could not load species classifier: \(error.localizedDescription)"
        }
    }

    var isReady: Bool { visionModel != nil }

    func classify(crop: CGImage, orientation: CGImagePropertyOrientation = .up, limit: Int = 5) throws -> [SpeciesPrediction] {
        guard let visionModel else { return [] }
        let request = VNCoreMLRequest(model: visionModel)
        request.imageCropAndScaleOption = .centerCrop
        try VNImageRequestHandler(cgImage: crop, orientation: orientation).perform([request])
        return Array((request.results as? [VNClassificationObservation] ?? []).prefix(limit))
            .map { SpeciesPrediction(identifier: $0.identifier, confidence: $0.confidence) }
    }
}
