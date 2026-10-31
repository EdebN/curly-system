# Train WildlifeVision with Python

This is the actual YOLO11 training path. Dataset Studio remains the source of images and annotations; Python/Ultralytics performs detector training and exports the ONNX model used by the browser app.

## Quick path: Google Colab

1. Open WildlifeVision → Bird Library.
2. Click **Train YOLO11 in Colab**. The app opens the Colab notebook and starts exporting the current in-browser dataset.
3. In the notebook, upload the downloaded `WildlifeVision-YOLO-dataset.zip` when prompted.
4. Run the notebook cells in order. It installs the dependencies, trains YOLO11, exports ONNX, and downloads `best.onnx` and `best.labels.json`.
5. Back in WildlifeVision → Live camera, choose the ONNX file, upload the labels JSON, and load YOLO11.

The ZIP is the transfer format between the browser's private IndexedDB library and the separate Colab runtime. The app cannot directly expose its local browser database to Google's remote Python runtime.

## 1. Export from Bird Library

Open **Bird Library → Export YOLO dataset**. This downloads `WildlifeVision-YOLO-dataset.zip` containing:

- `images/train`, `images/val`, and `images/test`
- Matching YOLO text files in `labels/`
- `dataset.yaml` with the species/class names

Every bounding box is exported as its own YOLO label row. An image containing three birds therefore contributes three boxes, including when the birds share a species label.

Review the annotations and train/validation split before training. The trainer validates class IDs and box coordinates and stops if the required train or validation split has no labelled boxes.

## 2. Install Python dependencies

Python 3.10–3.12 is recommended for broad PyTorch wheel compatibility. Use a virtual environment:

```bash
python -m venv .venv
# macOS / Linux:
source .venv/bin/activate
# Windows:
# .venv\Scripts\activate

python -m pip install --upgrade pip
python -m pip install -r training/requirements.txt
```

Install a PyTorch build appropriate for your machine if the default dependency resolver does not select the right accelerator build. NVIDIA CUDA is recommended for faster training. CPU and Apple MPS may work but can be substantially slower.

## 3. Train and export

From the repository root:

```bash
python training/train_yolo.py WildlifeVision-YOLO-dataset.zip --epochs 100 --imgsz 640
```

The script also accepts an already-extracted dataset folder:

```bash
python training/train_yolo.py ./my-bird-dataset --epochs 100
```

Useful options:

| Option | Default | Purpose |
|---|---:|---|
| `--model` | `yolo11n.pt` | Starting Ultralytics checkpoint |
| `--epochs` | `100` | Maximum training epochs |
| `--imgsz` | `640` | Training and export image size |
| `--batch` | `-1` | Let Ultralytics estimate batch size |
| `--device` | automatic | Set `0`, `cpu`, or `mps` |
| `--workers` | `2` | Data-loader workers |
| `--output` | `wildlifevision-training` | Output directory |
| `--name` | `bird-detector` | Run name |
| `--patience` | `25` | Early-stopping patience |

## 4. Load the model in WildlifeVision

The output is written under:

```text
wildlifevision-training/
  runs/bird-detector/weights/
    best.pt
    best.onnx
    best.labels.json
    wildlifevision-model.json
```

In WildlifeVision:

1. Open **Live camera**.
2. Choose `best.onnx` using **Choose YOLO11 model (.onnx)**.
3. Choose **Upload labels JSON** and select `best.labels.json`.
4. Select **Load YOLO11**.

The ONNX export uses a 640 × 640 input by default, raw YOLO output, and NMS disabled. WildlifeVision performs class-aware non-maximum suppression itself. The labels file is a JSON array in class-ID order, which the app accepts directly.

## Notes

- The browser app does not run Python or train YOLO itself. Training happens in the Python environment where this script is run; the exported ONNX and labels files are then loaded into the browser.
- Keep the original dataset ZIP and `best.pt` checkpoint. ONNX is for deployment; the PyTorch checkpoint is the better starting point for future fine-tuning.
- Training metrics depend on annotation quality, class balance, image diversity, and split size. A completed training run does not guarantee strong recognition for rare species.
