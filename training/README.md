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

7. Press **Train in Colab** in Bird Library to open the notebook.
8. Select **Runtime → Change runtime type → T4 GPU**.
9. Upload the WildlifeVision-YOLO-dataset.zip saved in step 6.
10. Run the cell that displays **Train YOLO11**, then click the button.
11. When training and ONNX export finish, run the download cell. Save best.onnx, best.labels.json, and best.pt.

The ZIP is the transfer format between the browser's private IndexedDB library and the separate Colab runtime. Colab cannot directly read the browser's local database.

## Dataset contents

The ZIP contains:

- images/train, images/val, and images/test
- Matching YOLO text files in labels/
- dataset.yaml with species/class names

Every bounding box is exported as its own YOLO label row. An image containing three birds therefore contributes three boxes, including when the birds share a species label.

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

The script also accepts an extracted dataset directory. Useful options include --model, --epochs, --imgsz, --batch, --device, --workers, --output, --name, and --patience.

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
