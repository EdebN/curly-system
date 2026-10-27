# Wildlife Vision

Native Swift Playgrounds bird-identification project for iPhone and iPad.

## Features

- Live AVFoundation camera preview.
- Core ML/Vision integration points for a bird detector and species classifier.
- Lightweight intersection-over-union tracking that keeps IDs across brief missed detections.
- Species-folder image import, local image storage, SHA-256 duplicate detection, editable species labels, train/validation/test split labels, and CSV manifest export.

## Open the app

Open the project in Swift Playgrounds on an Apple device and run it. The manifest uses the Swift Playgrounds `AppleProductTypes` app declaration, including the binoculars placeholder icon and camera permission text.

The GitHub Actions workflow checks Swift syntax and expected files. It does not type-check or build the iOS app: standard GitHub SwiftPM runners do not provide Swift Playgrounds' `AppleProductTypes` module. A successful CI syntax check is not proof that the project builds in Swift Playgrounds.

## Core ML models still required

The trained models are not included. Add these to `Sources/Resources`:

- `BirdDetector.mlmodel`: an object-detection model that returns Vision object observations with a label containing `bird` or `avian`.
- `BirdSpeciesClassifier.mlmodel`: an image classifier whose output labels are species names.

Without these models, the camera preview can run, but live bird detections and species labels cannot. The app intentionally does not invent results.

## Dataset library limitations

The library imports images from folders named after species, stores copies locally, removes exact byte-for-byte duplicates, lets you correct labels and assign dataset splits, and exports a CSV manifest. Folder names are only starting labels and should be checked. Manual bounding-box annotation, model training inside the app, and automated dataset export into a trained Core ML model are not implemented.
