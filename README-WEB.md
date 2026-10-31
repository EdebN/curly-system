# WildlifeVision

A static HTML/CSS/JavaScript wildlife observation and bird-image dataset app for iPad Safari and desktop browsers. It can be hosted free with GitHub Pages and does not require Swift or a Mac.

## Run the trained YOLO11 detector

1. Train the dataset with Ultralytics YOLO11 in Colab.
2. Export the best checkpoint to ONNX (640px, NMS disabled).
3. Open WildlifeVision over its GitHub Pages HTTPS address.
4. In the Detection panel, choose the exported `.onnx` file and select **Load YOLO11**.
5. Start the camera. The YOLO11 mode displays every retained detection with its class name, confidence and bounding box.

The app includes the 25 class names from the WildlifeVision dataset. If you train a different class list, upload a JSON file containing either a string array or an object with a `names` array before loading the model.

### Expected ONNX output

The browser adapter supports the standard raw Ultralytics detection output shaped `[1, 4 + classes, anchors]` or `[1, anchors, 4 + classes]`. It expects YOLO centre-x/centre-y/width/height boxes and per-class confidence scores. It performs class-aware non-maximum suppression in the browser, so export with `nms=False`.

The model file is selected locally and held in browser memory for the current page session. It is not committed to this repository, uploaded to a server, or persisted across reloads. Select it again after refreshing the page. Inference runs locally using ONNX Runtime Web, preferring WebGPU and falling back to WASM where available.

## Existing features

- Rear-camera preview, zoom where available, exclusion masks, live metrics, diagnostics and optional frame-difference motion tracking.
- YOLO11 multi-object detection with confidence filtering, class-aware duplicate suppression, spatial tracking and multiple boxes per frame.
- COCO-SSD and MobileNet example-based species matching remain available as the original AI mode.
- ZIP imports of species-named folders and individual photos.
- Local IndexedDB storage, SHA-256 duplicate detection, editable labels, train/validation/test splits, search/filter, and CSV manifest export.

## Limitations and data safety

Detection quality depends on the training data and validation results. Confidence is a model score, not a calibrated probability or guarantee of species identification. Review predictions on genuinely unseen images before relying on them. A small validation set can make per-class metrics unstable.

The ONNX Runtime Web library loads from a public CDN, so the first page load requires internet access. The model itself is selected from the user's device and inference runs in the browser. Imported images and labels stay in this browser on this device. Clearing site data can erase them. CSV export contains the metadata manifest, not the image files, so keep separate copies of original images.

Camera access requires HTTPS or localhost. Camera zoom support varies by device and browser; visual zoom crops the preview and does not improve optical detail.

## Local development

Serve this folder using a static HTTP server. Opening the page directly as a `file://` URL will not reliably allow camera access.
