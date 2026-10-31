# Wildlife Vision

Wildlife Vision is a browser-based wildlife observation and bird-image dataset tool, designed for iPad Safari and free hosting with GitHub Pages.

## Train a custom YOLO11 detector

Follow this order:

1. Import images into **Bird Library**.
2. Bulk-label the images with their species.
3. Press **Train for Bounding Boxes** to prepare the local visual-example matcher used for box suggestions.
4. Press **Auto-generate Bounding Boxes**.
5. Review and correct the boxes in each image. Keep multiple birds as separate boxes.
6. Press **Save YOLO dataset ZIP**.
7. Press **Train in Colab**.
8. In Colab, select **Runtime → Change runtime type → T4 GPU**.
9. Upload the ZIP saved in step 6.
10. Run the cell that displays the **Train YOLO11** button, then click it.
11. Download best.onnx, best.labels.json, and best.pt.

The ZIP transfers the reviewed images and annotations from browser IndexedDB to Colab. The browser cannot expose its private local database directly to Google's remote runtime. See [training/README.md](training/README.md) for details and local training instructions.

## Run the web app

Open the HTTPS GitHub Pages URL in Safari on your iPad and allow camera access. The first AI-model load requires an internet connection; model inference and image-library storage run in the browser.

## Features

- Pretrained COCO-SSD object detection, filtered to bird detections, with bounding boxes and a confidence threshold.
- YOLO11 ONNX inference for a custom multi-class bird detector.
- Example-based species matching using MobileNet visual features from the user's labelled photos.
- A selectable motion-tracking mode remains available for generic movement.
- Rear-camera preview, pause/resume, zoom where supported, exclusion masks, live metrics, and diagnostics.
- ZIP imports of species-named folders, individual image imports, local IndexedDB storage, duplicate detection, editable labels, dataset splits, search/filter, and CSV manifest export.
- Multi-object image annotation with any number of manually drawn bird boxes per image. Birds may share the same species label; each gets an independent bounding box, and the YOLO export writes one label row per bird.

## AI behaviour and limitations

The generic detector uses a pretrained COCO-SSD model to locate objects classified as birds. Auto-annotation currently keeps up to the two strongest distinct bird boxes per image, avoiding near-identical overlapping proposals. This limit applies only to automatic proposals, not manual annotation. It is not a specialised bird-only model and can miss distant, occluded, or unusual birds. The annotation editor lets you add and remove any number of boxes manually. The image's species label is shared by all boxes.

The species matcher is **example-based visual similarity**, not detector fine-tuning. It extracts MobileNet features from labelled images and compares live bird crops against those examples. It is separate from the YOLO11 detector.

The model files download from public CDNs. After they load, camera frames and imported images are processed locally in the browser. Imported images and metadata remain in that browser's local database on that device. Clearing website data can erase them, and the CSV export contains metadata rather than image files. Keep separate copies of original images.

## Local development

Serve this folder using a static HTTP server, then open the page in a browser. Camera access generally requires HTTPS or localhost. Opening the HTML directly as a `file://` URL will not reliably allow camera access.
