import Foundation
import Combine
import CryptoKit
import ImageIO

@MainActor
final class BirdDatasetStore: ObservableObject {
    @Published private(set) var records: [BirdImageRecord] = []
    @Published private(set) var isImporting = false
    @Published var status = "Import individual bird images or a folder organised by species."
    @Published private(set) var lastImportCount = 0

    private let fm = FileManager.default
    private let folderName = "BirdDataset"

    private var rootURL: URL {
        fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(folderName, isDirectory: true)
    }
    private var imagesURL: URL { rootURL.appendingPathComponent("Images", isDirectory: true) }
    private var manifestURL: URL { rootURL.appendingPathComponent("manifest.json") }

    init() {
        do {
            try fm.createDirectory(at: imagesURL, withIntermediateDirectories: true)
            records = try loadManifest()
        } catch {
            status = "Library setup failed: \(error.localizedDescription)"
        }
    }

    /// Imports a folder tree. Images inherit their label from their immediate parent folder.
    func importFolder(_ selectedURL: URL) async {
        guard !isImporting else { return }
        isImporting = true
        lastImportCount = 0
        status = "Reading species folders…"
        let didAccess = selectedURL.startAccessingSecurityScopedResource()
        defer {
            if didAccess { selectedURL.stopAccessingSecurityScopedResource() }
            isImporting = false
        }

        let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey]
        guard let enumerator = fm.enumerator(
            at: selectedURL,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            status = "Could not read that folder. Try a folder available offline in Files."
            return
        }

        // NSEnumerator's Sequence.makeIterator() is unavailable in Swift 6 async
        // contexts, so consume it explicitly instead of using a for-in loop.
        var imageURLs: [URL] = []
        while let fileURL = enumerator.nextObject() as? URL {
            let values = try? fileURL.resourceValues(forKeys: Set(keys))
            if values?.isRegularFile == true && isImage(fileURL) {
                imageURLs.append(fileURL)
            }
        }
        await importFiles(imageURLs, speciesRoot: selectedURL)
    }

    /// Imports selected image files directly. Their initial label is "Unlabelled".
    func importImages(_ selectedURLs: [URL]) async {
        guard !isImporting else { return }
        isImporting = true
        lastImportCount = 0
        status = "Importing selected images…"
        let access = selectedURLs.map { ($0, $0.startAccessingSecurityScopedResource()) }
        defer {
            for (url, didAccess) in access where didAccess {
                url.stopAccessingSecurityScopedResource()
            }
            isImporting = false
        }
        await importFiles(selectedURLs, speciesRoot: nil)
    }

    private func importFiles(_ fileURLs: [URL], speciesRoot: URL?) async {
        do {
            try fm.createDirectory(at: imagesURL, withIntermediateDirectories: true)
            var knownHashes = Set(records.map(\.sha256))
            var imported = 0
            var skipped = 0
            var newRecords: [BirdImageRecord] = []

            for fileURL in fileURLs {
                guard isImage(fileURL) else { continue }
                do {
                    let data = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
                    guard !data.isEmpty,
                          CGImageSourceCreateWithData(data as CFData, nil) != nil else {
                        skipped += 1
                        continue
                    }

                    let digest = SHA256.hash(data: data)
                        .map { String(format: "%02x", $0) }.joined()
                    guard knownHashes.insert(digest).inserted else {
                        skipped += 1
                        continue
                    }

                    let parent = fileURL.deletingLastPathComponent().lastPathComponent
                    let species: String
                    if let speciesRoot {
                        species = parent == speciesRoot.lastPathComponent ? "Unlabelled" : parent
                    } else {
                        species = "Unlabelled"
                    }

                    let ext = fileURL.pathExtension.isEmpty ? "jpg" : fileURL.pathExtension.lowercased()
                    let name = "\(UUID().uuidString).\(ext)"
                    let destination = imagesURL.appendingPathComponent(name)
                    try data.write(to: destination, options: .atomic)
                    newRecords.append(BirdImageRecord(
                        filename: fileURL.lastPathComponent,
                        relativePath: "Images/\(name)",
                        speciesLabel: species,
                        sourceName: fileURL.lastPathComponent,
                        sha256: digest
                    ))
                    imported += 1
                } catch {
                    skipped += 1
                }
            }

            records.append(contentsOf: newRecords)
            try saveManifest()
            lastImportCount = imported
            status = "Imported \(imported) images · skipped \(skipped) duplicates or unreadable files. Review labels before training."
        } catch {
            status = "Import failed: \(error.localizedDescription)"
        }
    }

    func imageURL(for record: BirdImageRecord) -> URL {
        rootURL.appendingPathComponent(record.relativePath)
    }

    func updateLabel(for record: BirdImageRecord, to label: String) {
        guard let index = records.firstIndex(where: { $0.id == record.id }) else { return }
        let cleaned = label.trimmingCharacters(in: .whitespacesAndNewlines)
        records[index].speciesLabel = cleaned.isEmpty ? "Unlabelled" : cleaned
        do {
            try saveManifest()
            status = "Label updated."
        } catch {
            status = "Could not save label: \(error.localizedDescription)"
        }
    }

    func updateSplit(for record: BirdImageRecord, to split: BirdImageRecord.DatasetSplit) {
        guard let index = records.firstIndex(where: { $0.id == record.id }) else { return }
        records[index].split = split
        do {
            try saveManifest()
        } catch {
            status = "Could not save split: \(error.localizedDescription)"
        }
    }

    func exportManifest() -> URL? {
        let output = fm.temporaryDirectory.appendingPathComponent("WildlifeVision-dataset-manifest.csv")
        let header = "filename,species_label,split,relative_path,sha256,box_x,box_y,box_width,box_height"
        let lines = records.map { record in
            let box = record.box
            return [
                csv(record.filename), csv(record.speciesLabel), record.split.rawValue,
                csv(record.relativePath), record.sha256,
                box.map { String($0.x) } ?? "", box.map { String($0.y) } ?? "",
                box.map { String($0.width) } ?? "", box.map { String($0.height) } ?? ""
            ].joined(separator: ",")
        }
        do {
            let csvText = ([header] + lines).joined(separator: "\n")
            try Data(csvText.utf8).write(to: output, options: .atomic)
            return output
        } catch {
            status = "CSV export failed: \(error.localizedDescription)"
            return nil
        }
    }

    private func isImage(_ url: URL) -> Bool {
        ["jpg", "jpeg", "png", "heic", "heif", "webp", "tif", "tiff", "bmp"]
            .contains(url.pathExtension.lowercased())
    }

    private func loadManifest() throws -> [BirdImageRecord] {
        guard fm.fileExists(atPath: manifestURL.path) else { return [] }
        return try JSONDecoder().decode([BirdImageRecord].self, from: Data(contentsOf: manifestURL))
    }

    private func saveManifest() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(records).write(to: manifestURL, options: .atomic)
    }

    private func csv(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
