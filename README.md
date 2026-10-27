# Wildlife Vision

Wildlife Vision is a browser-based wildlife observation and bird-image dataset tool, designed for iPad Safari and free hosting with GitHub Pages. It does not require a Mac or Swift Playgrounds.

## Run the web app

Open the HTTPS GitHub Pages URL in Safari on your iPad and allow camera access. The first AI-model load requires an internet connection; model inference and image-library storage run in the browser.

## Features

- Pretrained COCO-SSD object detection, filtered to bird detections, with bounding boxes and a confidence threshold.
- Example-based species matching using MobileNet visual features from the user's labelled photos.
- A selectable motion-tracking mode remains available for generic movement.
- Rear-camera preview, pause/resume, zoom where supported, exclusion masks, live metrics, and diagnostics.
- ZIP imports of species-named folders, individual image imports, local IndexedDB storage, duplicate detection, editable labels, dataset splits, search/filter, and CSV manifest export.

## AI behaviour and limitations

The generic detector uses a pretrained COCO-SSD model to locate objects classified as birds. It is not a specialised bird-only model and can miss distant, occluded, or unusual birds.

The species matcher is **example-based visual similarity**, not full neural-network fine-tuning. It extracts MobileNet features from labelled images and compares live bird crops against those examples. Clear photos where the bird fills much of the image and several views per species work best. Similar-looking species can be confused; treat the result as a suggestion, not a confirmed identification. Use **Learn from labelled photos** again after changing labels or adding examples. The learned feature set exists in memory for the current page session and must be rebuilt after reloading.

The model files download from public CDNs. After they load, camera frames and imported images are processed locally in the browser. Imported images and metadata remain in that browser's local database on that device. Clearing website data can erase them, and the CSV export contains metadata rather than image files. Keep separate copies of original images.

Camera zoom availability depends on the device and browser; visual zoom crops the preview and does not improve optical detail.

## Local development

Serve this folder using a static HTTP server, then open the page in a browser. Camera access generally requires HTTPS or localhost. Opening the HTML directly as a `file://` URL will not reliably allow camera access.
