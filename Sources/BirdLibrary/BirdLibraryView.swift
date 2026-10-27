import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct BirdLibraryView: View {
    @StateObject private var store = BirdDatasetStore()
    @State private var showFolderPicker = false
    @State private var showImagePicker = false
    @State private var showExportShare = false
    @State private var exportURL: URL?
    @State private var selectedRecord: BirdImageRecord?

    private var speciesCount: Int { Set(store.records.map(\.speciesLabel)).count }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        metric("Images", value: store.records.count)
                        metric("Species labels", value: speciesCount)
                        metric("Boxes", value: store.records.filter { $0.box != nil }.count)
                    }
                    Text(store.status).font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button { showImagePicker = true } label: {
                            Label("Import images", systemImage: "photo.badge.plus")
                        }
                        .buttonStyle(.borderedProminent).disabled(store.isImporting)
                        Button { showFolderPicker = true } label: {
                            Label("Import species folder", systemImage: "folder.badge.plus")
                        }
                        .buttonStyle(.bordered).disabled(store.isImporting)
                        Button { exportURL = store.exportManifest(); showExportShare = exportURL != nil } label: {
                            Label("Export CSV", systemImage: "square.and.arrow.up")
                        }.buttonStyle(.bordered).disabled(store.records.isEmpty)
                    }
                    Text("Import individual photos for manual labelling, or choose a folder containing one subfolder per species. Images are copied into app storage for offline use. Folder names are starting labels, not verified identifications.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding()
                List {
                    if store.records.isEmpty {
                        ContentUnavailableView("Your bird library is empty", systemImage: "bird", description: Text("Import a species-organised folder from Files, iCloud Drive, or another available file provider."))
                    } else {
                        ForEach(store.records) { record in
                            Button { selectedRecord = record } label: {
                                HStack(spacing: 12) {
                                    DatasetThumbnail(url: store.imageURL(for: record))
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(record.speciesLabel).font(.headline).foregroundStyle(.primary)
                                        Text(record.filename).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                        HStack(spacing: 8) {
                                            Text(record.split.rawValue.capitalized)
                                            if record.box != nil { Label("Box", systemImage: "viewfinder") }
                                        }.font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                                }.padding(.vertical, 3)
                            }
                        }
                    }
                }.listStyle(.plain)
            }
            .navigationTitle("Bird library")
            .fileImporter(isPresented: $showFolderPicker, allowedContentTypes: [.folder], allowsMultipleSelection: false) { result in
                switch result {
                case .success(let urls):
                    guard let url = urls.first else { return }
                    Task { await store.importFolder(url) }
                case .failure(let error): store.status = "Folder selection failed: \(error.localizedDescription)"
                }
            }
            .fileImporter(isPresented: $showImagePicker, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls):
                    Task { await store.importImages(urls) }
                case .failure(let error):
                    store.status = "Image selection failed: \(error.localizedDescription)"
                }
            }
            .sheet(item: $selectedRecord) { record in DatasetRecordEditor(record: record, store: store) }
            .sheet(isPresented: $showExportShare) {
                if let exportURL { ShareSheet(items: [exportURL]) }
            }
        }
    }

    private func metric(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(value)").font(.title2.bold())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DatasetThumbnail: View {
    let url: URL
    var body: some View {
        Group {
            if let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: 8).fill(.gray.opacity(0.2)).overlay(Image(systemName: "photo"))
            }
        }.frame(width: 58, height: 58).clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct DatasetRecordEditor: View {
    @Environment(\.dismiss) private var dismiss
    let record: BirdImageRecord
    @ObservedObject var store: BirdDatasetStore
    @State private var label = ""
    @State private var split: BirdImageRecord.DatasetSplit = .unassigned

    var body: some View {
        NavigationStack {
            Form {
                Section("Image") {
                    DatasetThumbnail(url: store.imageURL(for: record)).frame(maxWidth: .infinity)
                    Text(record.filename).font(.caption).textSelection(.enabled)
                }
                Section("Species label") {
                    TextField("Species name", text: $label)
                    Text("Use a consistent name per species. Folder names are starting labels, not verified identification.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Dataset split") {
                    Picker("Split", selection: $split) {
                        ForEach(BirdImageRecord.DatasetSplit.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                    }
                }
            }
            .navigationTitle("Review image").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        store.updateLabel(for: record, to: label)
                        store.updateSplit(for: record, to: split)
                        dismiss()
                    }
                }
            }
            .onAppear { label = record.speciesLabel; split = record.split }
        }
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) { }
}
