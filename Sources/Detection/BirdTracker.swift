import Foundation
import CoreGraphics

/// Lightweight IoU tracker. IDs survive brief misses; it is not a learned tracker.
final class BirdTracker {
    private struct Track {
        var detection: BirdDetection
        var missedFrames: Int = 0
    }
    private var tracks: [Int: Track] = [:]
    private var nextID = 1
    private let maximumMissedFrames = 5
    private let minimumIoU: CGFloat = 0.12

    func reset() { tracks.removeAll(); nextID = 1 }

    func update(boxes: [(CGRect, Float)]) -> [BirdDetection] {
        for id in Array(tracks.keys) { tracks[id]?.missedFrames += 1 }
        var used = Set<Int>()
        var output: [BirdDetection] = []
        for (box, confidence) in boxes {
            var bestID: Int?
            var bestScore: CGFloat = 0
            for (id, track) in tracks where !used.contains(id) {
                let score = intersectionOverUnion(box, track.detection.box)
                if score > bestScore { bestScore = score; bestID = id }
            }
            let id: Int
            if let candidate = bestID, bestScore >= minimumIoU {
                id = candidate
            } else {
                id = nextID
                nextID += 1
            }
            used.insert(id)
            let previousSpecies = tracks[id]?.detection.species ?? "Bird detected"
            let previousSpeciesConfidence = tracks[id]?.detection.speciesConfidence ?? 0
            let detection = BirdDetection(id: id, box: box, confidence: confidence,
                                          species: previousSpecies,
                                          speciesConfidence: previousSpeciesConfidence)
            tracks[id] = Track(detection: detection, missedFrames: 0)
            output.append(detection)
        }
        tracks = tracks.filter { $0.value.missedFrames <= maximumMissedFrames }
        return output
    }

    func updateSpecies(trackID: Int, species: String, confidence: Float) {
        guard var track = tracks[trackID] else { return }
        if confidence >= track.detection.speciesConfidence {
            track.detection.species = species
            track.detection.speciesConfidence = confidence
            tracks[trackID] = track
        }
    }

    private func intersectionOverUnion(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let intersection = a.intersection(b)
        guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else { return 0 }
        let intersectionArea = intersection.width * intersection.height
        let unionArea = a.width * a.height + b.width * b.height - intersectionArea
        return unionArea > 0 ? intersectionArea / unionArea : 0
    }
}
