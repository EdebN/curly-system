import Foundation
import Vision
import CoreML
import CoreGraphics

final class BirdDetector {
    private let visionModel: VNCoreMLModel?
    let loadError: String?

    init() {
        guard let url = Bundle.main.url(forResource: "BirdDetector", withExtension: "mlmodelc") else {
            visionModel = nil
            loadError = "BirdDetector.mlmodel is not bundled yet. Import and label bird images, then add a trained object-detection model."
            return
        }

        guard let model = try? MLModel(contentsOf: url),
              let loadedVisionModel = try? VNCoreMLModel(for: model) else {
            visionModel = nil
            loadError = "BirdDetector could not be loaded. Check that the bundled Core ML model is valid."
            return
        }

        visionModel = loadedVisionModel
        loadError = nil
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
        guard let url = Bundle.main.url(forResource: "BirdSpeciesClassifier", withExtension: "mlmodelc") else {
            visionModel = nil
            loadError = "BirdSpeciesClassifier.mlmodel is not bundled yet."
            return
        }

        guard let model = try? MLModel(contentsOf: url),
              let loadedVisionModel = try? VNCoreMLModel(for: model) else {
            visionModel = nil
            loadError = "Bird species classifier could not be loaded. Check that the bundled Core ML model is valid."
            return
        }

        visionModel = loadedVisionModel
        loadError = nil
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
