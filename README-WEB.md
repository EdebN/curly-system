# Wildlife Vision

A static HTML/CSS/JavaScript wildlife observation and bird-image dataset app for iPad Safari. It can be hosted free with GitHub Pages and does not require a Mac or Swift Playgrounds.

## Publish with GitHub Pages

1. Open this repository on GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch `main` and folder `/(root)`, then save.
5. Open the HTTPS Pages URL GitHub provides. In iPad Safari, allow camera access.

## Features

- Rear-camera preview with start/pause controls and permission diagnostics.
- Frame-difference motion detection with adjustable sensitivity and minimum region size.
- Lightweight region matching to keep track IDs through brief missed frames.
- Hardware zoom where available, with visual crop zoom as a fallback.
- User-drawn exclusion masks, motion overlay, live metrics, and a diagnostic console.
- Individual image and species-folder imports.
- Local IndexedDB storage for image blobs and metadata, SHA-256 duplicate detection, editable labels, train/validation/test splits, search/filter, and CSV manifest export.

## Limitations and data safety

The live detector finds pixel changes and tracks moving regions. It does **not** recognise birds or people and cannot identify species. A trained browser-compatible detector and a separate species classifier would be needed; neither is included.

Imported images and labels stay in this browser on this device. Clearing site data can erase them. CSV export contains the metadata manifest, not the image files, so keep separate copies of your original images.

Manual bounding-box annotation and in-browser model training are not implemented. Camera zoom support varies by device and browser; visual zoom crops the preview and does not improve optical detail.

## Local development

Serve this folder using a static HTTP server. Camera access generally requires HTTPS or localhost. Opening the page directly as a `file://` URL will not reliably allow camera access.
