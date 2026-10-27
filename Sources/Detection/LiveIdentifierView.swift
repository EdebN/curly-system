import SwiftUI
import AVFoundation
import UIKit

struct LiveIdentifierView: View {
    @StateObject private var camera = CameraManager()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraPreview(session: camera.session, detections: camera.detections).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("WILDLIFE VISION").font(.headline.bold()).tracking(1.1)
                        Text(camera.status).font(.caption.monospaced()).foregroundStyle(.white.opacity(0.78))
                    }
                    Spacer()
                    Circle().fill(camera.isRunning ? .green : .gray).frame(width: 9, height: 9)
                    Text(camera.isRunning ? "LIVE" : "PAUSED").font(.caption.bold())
                }
                .padding(16).background(.black.opacity(0.7))
                Spacer()
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("\(camera.detections.count) birds", systemImage: "bird.fill")
                        Spacer()
                        Text(camera.classifierReady ? "Species model ready" : "Species model missing")
                            .font(.caption2).foregroundStyle(camera.classifierReady ? .green : .orange)
                    }
                    if !camera.detectorReady {
                        Text("The camera is working, but bird detection needs a trained BirdDetector.mlmodel. Species identification also needs BirdSpeciesClassifier.mlmodel. The app will not invent species labels.")
                            .font(.caption).foregroundStyle(.white.opacity(0.85))
                    }
                    HStack {
                        Button(camera.isRunning ? "Pause camera" : "Start camera") {
                            camera.isRunning ? camera.stop() : camera.start()
                        }.buttonStyle(.borderedProminent)
                        Spacer()
                        Button("Reset tracks") { camera.resetTracking() }.buttonStyle(.bordered)
                    }
                }
                .padding(16).background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 20)).padding()
            }
        }
        .task { camera.start() }
        .alert("Camera permission required", isPresented: $camera.showPermissionAlert) {
            Button("OK", role: .cancel) { }
        } message: { Text("Allow camera access in Settings, then reopen Wildlife Vision.") }
        .preferredColorScheme(.dark)
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    let detections: [BirdDetection]

    func makeUIView(context: Context) -> PreviewLayerView {
        let view = PreviewLayerView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }
    func updateUIView(_ view: PreviewLayerView, context: Context) {
        view.previewLayer.session = session
        view.detections = detections
        view.setNeedsLayout()
    }
}

private final class PreviewLayerView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    var detections: [BirdDetection] = [] { didSet { setNeedsLayout() } }
    private var overlays: [CALayer] = []

    override func layoutSubviews() {
        super.layoutSubviews()
        overlays.forEach { $0.removeFromSuperlayer() }
        overlays.removeAll()
        for item in detections {
            let b = item.box
            let metadataRect = CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height)
            let rect = previewLayer.layerRectConverted(fromMetadataOutputRect: metadataRect)
            let box = CAShapeLayer()
            box.path = UIBezierPath(roundedRect: rect, cornerRadius: 6).cgPath
            box.fillColor = UIColor.clear.cgColor
            box.strokeColor = UIColor.systemGreen.cgColor
            box.lineWidth = 2
            layer.addSublayer(box); overlays.append(box)
            let label = CATextLayer()
            label.contentsScale = UIScreen.main.scale
            label.string = "#\(item.id)  \(item.species)  \(Int(item.confidence * 100))%"
            label.fontSize = 12
            label.foregroundColor = UIColor.black.cgColor
            label.backgroundColor = UIColor.systemGreen.cgColor
            label.frame = CGRect(x: rect.minX, y: max(0, rect.minY - 20), width: min(250, max(130, rect.width)), height: 19)
            layer.addSublayer(label); overlays.append(label)
        }
    }
}
