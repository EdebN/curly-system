import Foundation
import Combine
import AVFoundation
import Vision
import UIKit
import ImageIO
import CoreImage

final class CameraManager: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    @Published private(set) var detections: [BirdDetection] = []
    @Published private(set) var status = "Camera is starting"
    @Published private(set) var isRunning = false
    @Published private(set) var detectorReady = false
    @Published private(set) var classifierReady = false
    @Published var showPermissionAlert = false

    private let sessionQueue = DispatchQueue(label: "wildlife.camera.session")
    private let visionQueue = DispatchQueue(label: "wildlife.camera.vision")
    private let detector = BirdDetector()
    private let classifier = SpeciesClassifier()
    private let tracker = BirdTracker()
    private var configured = false
    private var processing = false
    private var lastInferenceAt = Date.distantPast
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    override init() {
        super.init()
        detectorReady = detector.isReady
        classifierReady = classifier.isReady
        status = detector.isReady ? "Bird detector loaded" : "Model required: no bird detector bundled"
    }

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted { self.configureAndStart() }
                    else { self.status = "Camera permission denied"; self.showPermissionAlert = true }
                }
            }
        default:
            status = "Enable camera access in Settings"
            showPermissionAlert = true
        }
    }

    func stop() {
        sessionQueue.async {
            if self.session.isRunning { self.session.stopRunning() }
            DispatchQueue.main.async { self.isRunning = false; self.status = "Camera paused" }
        }
    }

    func resetTracking() {
        // The tracker is owned by the vision queue. Reset it there to avoid
        // racing an in-flight camera frame.
        visionQueue.async {
            self.tracker.reset()
            DispatchQueue.main.async { self.detections = [] }
        }
    }

    private func configureAndStart() {
        sessionQueue.async {
            if !self.configured {
                self.session.beginConfiguration()
                self.session.sessionPreset = .high
                guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                      let input = try? AVCaptureDeviceInput(device: camera), self.session.canAddInput(input) else {
                    self.session.commitConfiguration()
                    DispatchQueue.main.async { self.status = "Could not configure the camera" }
                    return
                }
                self.session.addInput(input)
                let output = AVCaptureVideoDataOutput()
                output.alwaysDiscardsLateVideoFrames = true
                output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
                output.setSampleBufferDelegate(self, queue: self.visionQueue)
                guard self.session.canAddOutput(output) else {
                    self.session.commitConfiguration()
                    DispatchQueue.main.async { self.status = "Could not configure video output" }
                    return
                }
                self.session.addOutput(output)
                if let connection = output.connection(with: .video), connection.isVideoOrientationSupported {
                    connection.videoOrientation = .portrait
                }
                self.session.commitConfiguration()
                self.configured = true
            }
            if !self.session.isRunning { self.session.startRunning() }
            DispatchQueue.main.async {
                self.isRunning = true
                self.status = self.detector.isReady ? "Live · running on device" : "Live camera · bird detector model missing"
            }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !processing, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        guard Date().timeIntervalSince(lastInferenceAt) >= 0.28 else { return }
        lastInferenceAt = Date()
        processing = true
        defer { processing = false }
        guard detector.isReady else { return }
        do {
            let boxes = try detector.detect(in: buffer, orientation: .right)
            var tracked = tracker.update(boxes: boxes)
            if classifier.isReady {
                let image = CIImage(cvPixelBuffer: buffer)
                for index in tracked.indices {
                    guard let crop = makeCrop(from: image, normalizedBox: tracked[index].box),
                          let cgImage = ciContext.createCGImage(crop, from: crop.extent),
                          let prediction = try? classifier.classify(crop: cgImage, limit: 1).first else { continue }
                    let label = prediction.confidence >= 0.55 ? prediction.identifier : "Uncertain bird"
                    tracker.updateSpecies(trackID: tracked[index].id, species: label, confidence: prediction.confidence)
                    tracked[index].species = label
                    tracked[index].speciesConfidence = prediction.confidence
                }
            }
            DispatchQueue.main.async {
                self.detections = tracked
                self.status = "Live · \(tracked.count) bird detection(s)"
            }
        } catch {
            DispatchQueue.main.async { self.status = "Detector error: \(error.localizedDescription)" }
        }
    }

    private func makeCrop(from image: CIImage, normalizedBox: CGRect) -> CIImage? {
        let extent = image.extent
        let rect = CGRect(x: extent.minX + normalizedBox.minX * extent.width,
                          y: extent.minY + normalizedBox.minY * extent.height,
                          width: normalizedBox.width * extent.width,
                          height: normalizedBox.height * extent.height).intersection(extent)
        guard !rect.isNull, rect.width >= 2, rect.height >= 2 else { return nil }
        return image.cropped(to: rect)
    }
}
