# Wildlife Vision

Wildlife Vision is a browser-based wildlife observation and bird-image dataset tool, designed for iPad Safari and free hosting with GitHub Pages.

## Train a custom YOLO11 detector

Dataset Studio stores the images and bounding-box annotations locally. In **Bird Library**, use **Train YOLO11 in Colab** to open the hosted Google Colab notebook and automatically export the current annotations as a dataset ZIP. Upload that ZIP into the notebook; it installs the trainer, trains YOLO11, and downloads the ONNX model and labels. You can also export manually with **Export YOLO dataset** and run the Python trainer described in [training/README.md](training/README.md).

```bash
python -m pip install -r training/requirements.txt
python training/train_yolo.py WildlifeVision-YOLO-dataset.zip --epochs 100 --imgsz 640
```

The trainer uses the official Ultralytics Python package, fine-tunes `yolo11n.pt`, and exports `best.onnx` plus `best.labels.json`. Upload both files in WildlifeVision's Live camera panel. Multiple annotated birds in one image are retained as separate bounding boxes.

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
