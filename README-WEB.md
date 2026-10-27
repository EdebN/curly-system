# Wildlife Vision

A static HTML/CSS/JavaScript wildlife observation and bird-image dataset app for iPad Safari. It can be hosted free with GitHub Pages and does not require a Mac or Swift Playgrounds.

## Publish with GitHub Pages

1. Open this repository on GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose the configured deployment workflow or branch deployment.
4. Open the HTTPS Pages URL in Safari and allow camera access.

## Features

- Pretrained COCO-SSD live object detection filtered to birds, with bounding boxes and confidence threshold.
- MobileNet feature-based species matching learned from labelled library images.
- Optional frame-difference motion tracking mode.
- Rear-camera preview, zoom where available, exclusion masks, live metrics, and diagnostics.
- ZIP imports of species-named folders and individual photos.
- Local IndexedDB storage, SHA-256 duplicate detection, editable labels, train/validation/test splits, search/filter, and CSV manifest export.

## Limitations and data safety

The detector is a general-purpose object detector, not a specialised bird-only model. The species matcher compares visual features against examples; it does not fine-tune model weights, and its results are estimates. Use several clear images per species and rebuild the matcher after changing labels or importing examples. The matcher is rebuilt each page session and does not persist its feature vectors between reloads.

The AI libraries and model weights load from public CDNs and require internet access for initial loading. Inference runs in the browser. Imported images and labels stay in this browser on this device. Clearing site data can erase them. CSV export contains the metadata manifest, not the image files, so keep separate copies of original images.

Camera zoom support varies by device and browser; visual zoom crops the preview and does not improve optical detail.

## Local development

Serve this folder using a static HTTP server. Camera access generally requires HTTPS or localhost. Opening the page directly as a `file://` URL will not reliably allow camera access.
