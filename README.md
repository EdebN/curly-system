# Wildlife Vision

Native Swift Playgrounds bird-identification project.

## Features
- AVFoundation live camera preview and SwiftUI interface.
- Core ML loaders for a bird detector and species classifier.
- Lightweight IoU tracking with persistent IDs across brief missed detections.
- Species-organised image import, local storage, SHA-256 duplicate detection, editable labels, dataset splits, and CSV manifest export.

## Required models
The trained Core ML models are not included. Add `BirdDetector.mlmodel` and `BirdSpeciesClassifier.mlmodel` to `Sources/Resources`. Until then, the live camera preview works, but detections and species labels are unavailable.

The detector is expected to identify labels containing `bird` or `avian`. The classifier's output labels should match the species labels in the library. Manual bounding-box annotation and in-app model training are not implemented.

Open this Swift Playgrounds project on an Apple device to build and test it. The package manifest declares camera access and uses the Swift Playgrounds binoculars placeholder icon.
