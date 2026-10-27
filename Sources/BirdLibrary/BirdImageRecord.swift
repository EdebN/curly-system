import Foundation

struct BirdImageRecord: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var filename: String
    var relativePath: String
    var speciesLabel: String
    var sourceName: String
    var importedAt: Date = Date()
    var sha256: String
    var box: NormalizedBox? = nil
    var split: DatasetSplit = .unassigned

    enum DatasetSplit: String, Codable, CaseIterable { case unassigned, train, validation, test }
}

struct NormalizedBox: Codable, Hashable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}
