# Train WildlifeVision with Python

This is the YOLO11 training path. WildlifeVision prepares the image dataset and annotations in the browser; Python/Ultralytics trains the detector and exports the ONNX model used by the browser app.

## Exact workflow

### In WildlifeVision

1. Import images into **Bird Library**.
2. Select images in bulk and assign their species labels.
3. Press **Train for Bounding Boxes**. This builds the local visual-example matcher used to help propose boxes when the generic detector misses a bird. It does not train YOLO detector weights.
4. Press **Auto-generate Bounding Boxes**.
5. Review every image. Open **Edit**, correct the boxes, and mark the annotations verified. Keep separate boxes for separate birds, including birds of the same species.
6. Press **Save YOLO dataset ZIP**.

### In Google Colab

7. Press **Train in Colab** in Bird Library to open the notebook. The button is grouped with the other preparation steps, above the image grid.
8. Select **Runtime → Change runtime type → T4 GPU**.
9. Upload the WildlifeVision-YOLO-dataset.zip saved in step 6.
10. Run the cell that displays **Train YOLO11**, then click the button.
11. When training and ONNX export finish, run the download cell. Save best.onnx, best.labels.json, and best.pt.

The ZIP is the transfer format between the browser's private IndexedDB library and the separate Colab runtime. Colab cannot directly read the browser's local database.

## Dataset contents

The ZIP contains:

- Original, full, uncropped image files in images/train, images/val, and images/test
- Matching YOLO text files in labels/
- dataset.yaml with bird species/class names

The exporter copies each stored image's original bytes directly. It does not crop, resize, or recompress images. The surrounding scene is useful training context.

Every bounding box is exported as its own YOLO label row. An image containing three birds therefore contributes three boxes, including when the birds share a species label. A bird-free Background image is exported with an empty label file and is not added to the species list. Background-labelled images that still have boxes are skipped as negatives until those boxes are cleared.

## Run locally instead

Install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r training/requirements.txt
```

Then train from the exported ZIP:

```bash
python training/train_yolo.py WildlifeVision-YOLO-dataset.zip --epochs 100 --imgsz 640
```

The script also accepts an extracted dataset directory. Use `--model best.pt` to fine-tune a previous checkpoint instead of starting from `yolo11n.pt`.

## Add species or more training images

You cannot add training data directly to an `.onnx` file. ONNX is the exported inference model. The editable training checkpoint is `best.pt`.

For more images of existing species:

1. Add and label the new photos in WildlifeVision.
2. Keep the existing species images in the library and export a dataset ZIP containing both the old and new reviewed examples.
3. In Colab, upload that ZIP and the latest `best.pt` together.
4. Train. The previous detector weights are used as the starting point, then a fresh ONNX and labels file are exported.

For new species, do the same but include labelled images and verified boxes for the new species. Keep examples of the old species in the combined dataset too. The class list is read from the new ZIP; Ultralytics reuses compatible weights and adapts the detection head for the new number of classes. Always load the new ONNX together with its matching `best.labels.json`.

**Do not use the old ONNX as the training checkpoint.** Keep each new `best.pt` and use it for the next round. This is incremental fine-tuning from a checkpoint, not a literal append operation to the ONNX file.

## Load the model in WildlifeVision

The output is written under:

```text
wildlifevision-training/
  runs/bird-detector/weights/
    best.pt
    best.onnx
    best.labels.json
    wildlifevision-model.json
```

In WildlifeVision, open **Live camera**, choose best.onnx, upload best.labels.json, and select **Load YOLO11**.

The ONNX export uses a 640 × 640 input by default, raw YOLO output, and NMS disabled. WildlifeVision performs class-aware non-maximum suppression itself. Keep the original ZIP and best.pt for future fine-tuning.


## Reducing false-positive bird detections

The dataset exporter supports explicit negative/background images. Import clear photos that contain no birds and bulk-label them exactly **Background** (or use **No bird**, **No birds**, **Negative**, or **Empty scene**). Keep the complete original photo: do not crop it to a subject or remove the surroundings. Clear every bounding box from these images. They are exported unchanged, with empty YOLO label files, and are not added as an extra species class. If a Background-labelled image still has boxes, the exporter skips it as a negative and reports how many need clearing.

Include varied backgrounds and confusing non-bird objects, especially examples from the camera locations where false detections occur. Do not label an image as Background if it contains a bird. Keep the existing labelled bird images in the same dataset so the model learns both positive and negative examples.

The live detector also ignores predictions centred in letterbox padding and applies an extra 15 percentage points of confidence to boxes touching the camera-frame boundary. This is a conservative edge filter; genuine birds partly outside the frame may be missed.
