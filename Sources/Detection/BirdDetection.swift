import Foundation
import CoreGraphics

struct BirdDetection: Identifiable, Equatable {
    let id: Int
    var box: CGRect
    var confidence: Float
    var species: String = "Bird detected"
    var speciesConfidence: Float = 0
}

struct SpeciesPrediction: Identifiable, Equatable {
    var id: String { identifier }
    let identifier: String
    let confidence: Float
}
