# Wildlife Vision

Wildlife Vision is a browser-based wildlife observation and bird-image dataset tool, designed for iPad Safari and free hosting with GitHub Pages. It does not require a Mac or Swift Playgrounds.

## Run the web app

The app consists of `index.html`, `styles.css`, and `app.js`.

To publish it with GitHub Pages:

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/(root)`, then save.
4. Open the HTTPS Pages URL GitHub provides in Safari on your iPad and allow camera access.

## Features

- Live camera preview, pause/resume, and camera diagnostics.
- Frame-difference motion detection with adjustable sensitivity and minimum region size.
- Track IDs that persist through brief missed detections.
- Hardware zoom when supported, with a visual crop fallback.
- User-drawn exclusion masks, motion overlays, and a diagnostic console.
- Individual image and species-folder imports.
- Local IndexedDB storage, SHA-256 duplicate detection, editable labels, dataset split labels, search/filter, and CSV manifest export.

## Important limitations

The live tracker detects changes between video frames. It does **not** identify birds, people, or species. A compatible trained detection model and a separate species-classification model would be needed for those capabilities; neither is included.

Imported images and metadata remain in the browser's local database on that device. Clearing website data can erase them, and the CSV export contains metadata rather than the image files. Back up original images separately.

Manual bounding-box annotation and in-browser model training are not implemented. Camera zoom availability depends on the device and browser; visual zoom crops the preview and does not improve optical detail.

## Local development

Serve this folder using any static HTTP server, then open the page in a browser. Camera access generally requires HTTPS or localhost. Opening the HTML directly as a `file://` URL will not reliably allow camera access.
