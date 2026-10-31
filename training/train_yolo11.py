#!/usr/bin/env python3
"""Train a WildlifeVision YOLO11 detector from an exported dataset ZIP.

Run in Google Colab or a machine with Python and (preferably) an NVIDIA GPU:
  pip install ultralytics
  python train_yolo11.py WildlifeVision-YOLO-dataset.zip --epochs 100 --imgsz 640

The ZIP must contain dataset.yaml plus images/{train,val,test} and
labels/{train,val,test}, in standard Ultralytics YOLO detection format.
"""
from __future__ import annotations

import argparse
import shutil
import tempfile
import zipfile
from pathlib import Path

import yaml
from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset_zip", type=Path)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--model", default="yolo11n.pt",
                        help="Start with yolo11n.pt, yolo11s.pt, etc.")
    parser.add_argument("--name", default="wildlifevision-yolo11")
    parser.add_argument("--project", default="runs/detect")
    parser.add_argument("--device", default=None,
                        help="0 for first CUDA GPU, cpu for CPU, or omit for auto")
    args = parser.parse_args()

    archive = args.dataset_zip.expanduser().resolve()
    if not archive.is_file():
        raise SystemExit(f"Dataset ZIP not found: {archive}")

    work = Path(tempfile.mkdtemp(prefix="wildlifevision-yolo-"))
    dataset_dir = work / "dataset"
    dataset_dir.mkdir()
    with zipfile.ZipFile(archive) as zf:
        bad = zf.testzip()
        if bad:
            raise SystemExit(f"Corrupt ZIP member: {bad}")
        for member in zf.infolist():
            target = (dataset_dir / member.filename).resolve()
            if dataset_dir.resolve() not in target.parents and target != dataset_dir.resolve():
                raise SystemExit(f"Unsafe ZIP path: {member.filename}")
        zf.extractall(dataset_dir)

    yaml_path = dataset_dir / "dataset.yaml"
    if not yaml_path.is_file():
        raise SystemExit("dataset.yaml is missing from the ZIP.")
    config = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    names = config.get("names")
    if not isinstance(names, list) or not names:
        raise SystemExit("dataset.yaml must contain a non-empty names list.")
    for split in ("train", "val"):
        image_dir = dataset_dir / "images" / split
        label_dir = dataset_dir / "labels" / split
        if not image_dir.is_dir() or not label_dir.is_dir():
            raise SystemExit(f"Missing images/{split} or labels/{split}.")
        images = [p for p in image_dir.iterdir() if p.suffix.lower() in
                  {".jpg", ".jpeg", ".png", ".webp"}]
        if not images:
            raise SystemExit(f"No images found in images/{split}.")
        for image in images:
            label = label_dir / f"{image.stem}.txt"
            if not label.exists():
                raise SystemExit(f"Missing YOLO label file: {label.name}")

    config["path"] = str(dataset_dir)
    config["train"] = "images/train"
    config["val"] = "images/val"
    if (dataset_dir / "images" / "test").is_dir():
        config["test"] = "images/test"
    resolved_yaml = dataset_dir / "dataset-training.yaml"
    resolved_yaml.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")

    model = YOLO(args.model)
    results = model.train(
        data=str(resolved_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        name=args.name,
        project=args.project,
        device=args.device,
        patience=20,
        cache=False,
        plots=True,
    )
    best = Path(results.save_dir) / "weights" / "best.pt"
    if not best.is_file():
        raise SystemExit(f"Training finished but best.pt was not found: {best}")

    trained = YOLO(str(best))
    trained.val(data=str(resolved_yaml), imgsz=args.imgsz, device=args.device)
    onnx_path = trained.export(format="onnx", imgsz=args.imgsz, opset=17, simplify=True)
    print("\nTraining complete.")
    print(f"Best PyTorch weights: {best}")
    print(f"ONNX export: {onnx_path}")
    print("Keep the dataset YAML and class order with the model. Review predictions on unseen photos before trusting it.")


if __name__ == "__main__":
    main()
