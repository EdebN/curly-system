# Wildlife Vision

Wildlife Vision now has two editions in this repository:

- **Web app:** HTML, CSS and JavaScript, intended for iPad Safari and GitHub Pages. Start here if you do not have a Mac. See [README-WEB.md](README-WEB.md).
- **Native Swift app:** Swift Playgrounds project under `Sources/`. See the native-app notes below.

## Run the web app

The web version is in the repository root: `index.html`, `styles.css`, and `app.js`.

To publish it free with GitHub Pages:

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Choose branch `main` and folder `/(root)`, then save.
4. Open the HTTPS Pages URL in Safari on your iPad and grant camera access.

The web edition includes live camera preview, frame-difference motion tracking, track IDs, zoom fallback, exclusion masks, a diagnostic console, local image import, species labels, dataset split labels, SHA-256 duplicate detection, and CSV export.

**Important:** motion regions are not bird or human recognition. The original project does not include trained bird detection or species classification models, so the web app does not claim to identify species. Dataset images are stored in the browser's local IndexedDB and can be lost if website data is cleared. Export the CSV manifest regularly; it does not contain the image files themselves.

## Native Swift app

Native Swift Playgrounds bird-identification project for iPhone and iPad.

### Features

- Live AVFoundation camera preview.
- Core ML/Vision integration points for a bird detector and species classifier.
- Lightweight intersection-over-union tracking that keeps IDs across brief missed detections.
- Species-folder image import, local image storage, SHA-256 duplicate detection, editable species labels, train/validation/test split labels, and CSV manifest export.

### Open the native app

Open the project in Swift Playgrounds on an Apple device and run it. The manifest uses the Swift Playgrounds `AppleProductTypes` app declaration, including the binoculars placeholder icon and camera permission text.

The GitHub Actions workflow checks Swift syntax and expected files. It does not type-check or build the iOS app: standard GitHub SwiftPM runners do not provide Swift Playgrounds' `AppleProductTypes` module. A successful CI syntax check is not proof that the project builds in Swift Playgrounds.

### Core ML models still required

The trained models are not included. Add these to `Sources/Resources`:

- `BirdDetector.mlmodel`: an object-detection model that returns Vision object observations with a label containing `bird` or `avian`.
- `BirdSpeciesClassifier.mlmodel`: an image classifier whose output labels are species names.

Without these models, the camera preview can run, but live bird detections and species labels cannot. The app intentionally does not invent results.

### Dataset library limitations

The library imports images from folders named after species, stores copies locally, removes exact byte-for-byte duplicates, lets you correct labels and assign dataset splits, and exports a CSV manifest. Folder names are only starting labels and should be checked. Manual bounding-box annotation, model training inside the app, and automated dataset export into a trained Core ML model are not implemented.
