# Wildlife Vision web edition

A static HTML/CSS/JavaScript edition designed to run on iPad Safari and be hosted free with GitHub Pages. The existing Swift Playgrounds project remains in `Sources/` and is not deleted.

## Features included

- Rear-camera preview using `getUserMedia`, start/pause, and camera permission diagnostics.
- Frame-difference motion detection with adjustable sensitivity and minimum region size.
- Lightweight intersection-over-union matching to keep track IDs through brief missed frames.
- Hardware zoom where Safari exposes camera zoom constraints, with visual crop zoom as a fallback.
- User-drawn exclusion rectangles that ignore motion in selected areas.
- Live overlay, motion score, active tracks, and a timestamped diagnostic console.
- Individual image import and species-folder import.
- Local IndexedDB storage for image blobs and metadata, SHA-256 duplicate detection, editable species labels, train/validation/test splits, search/filter, and CSV manifest export.

## Publish with GitHub Pages

1. Open this repository on GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch `main` and folder `/(root)`, then save.
5. Open the HTTPS Pages URL GitHub shows. On iPad, open that URL in Safari and allow camera access.

If GitHub Pages is already configured for this repository, the new root `index.html` will become the page after the next deployment finishes.

## Important limitations

- The original Swift project has no trained `BirdDetector.mlmodel` or `BirdSpeciesClassifier.mlmodel`. The web app therefore does not claim to identify bird species or people. Its live detector is frame differencing: it detects pixel changes and follows moving regions, which can include birds, people, foliage, shadows, camera shake, and other motion.
- Frame differencing is not semantic object detection. A compatible trained browser model must be added to identify bird/human classes, and a species classifier must be separately trained or supplied.
- Dataset importing, labels, and image blobs stay in the browser's IndexedDB on that device/browser. Clearing site data can erase them. Export the CSV manifest regularly; the CSV does not contain the actual image files.
- The current web interface records image-level metadata and exports the same box columns as the Swift version, but manual bounding-box annotation and in-browser model training are not implemented.
- Camera zoom availability varies by device and Safari version. The visual zoom fallback crops the displayed preview and does not improve optical detail.
- Run the site from HTTPS (GitHub Pages) for camera permission and Web Crypto SHA-256 support.

## Local development

Serve this folder using any static HTTP server, then open the page in a browser. Camera access generally requires HTTPS or localhost. Opening the HTML directly as a `file://` URL will not reliably allow camera access.
