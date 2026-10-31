#!/usr/bin/env python3
"""Train WildlifeVision's YOLO11 detector from a Bird Library YOLO ZIP or folder.

Example:
  python training/train_yolo.py WildlifeVision-YOLO-dataset.zip --epochs 100
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Any

try:
    import yaml
    from ultralytics import YOLO
except ImportError as exc:
    print(
        "Missing training dependencies. Run: "
        "python -m pip install -r training/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


def safe_extract(zip_path: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if target != root and root not in target.parents:
                raise ValueError(f"Unsafe path in dataset ZIP: {member.filename}")
        archive.extractall(destination)
    # Browser export places dataset.yaml at the ZIP root. Also tolerate one
    # enclosing folder, which is common when users zip a directory manually.
    if (destination / "dataset.yaml").is_file():
        return destination
    candidates = list(destination.rglob("dataset.yaml"))
    if len(candidates) != 1:
        raise FileNotFoundError(
            "Expected exactly one dataset.yaml in the ZIP; found "
            f"{len(candidates)}."
        )
    return candidates[0].parent


def load_dataset_yaml(dataset_yaml: Path) -> tuple[dict[str, Any], list[str]]:
    config = yaml.safe_load(dataset_yaml.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("dataset.yaml must contain a YAML mapping.")
    raw_names = config.get("names")
    if isinstance(raw_names, dict):
        names = [str(raw_names[key]) for key in sorted(raw_names, key=lambda x: int(x))]
    elif isinstance(raw_names, list):
        names = [str(name) for name in raw_names]
    else:
        raise ValueError("dataset.yaml needs a names list or class-index mapping.")
    if not names:
        raise ValueError("No species/classes were found in dataset.yaml.")
    if len(set(names)) != len(names):
        raise ValueError("Class names must be unique.")
    if config.get("nc") is not None and int(config["nc"]) != len(names):
        raise ValueError(f"dataset.yaml says nc={config['nc']} but lists {len(names)} names.")
    config["nc"] = len(names)
    config["names"] = names
    # Ultralytics resolves relative image paths from the YAML's directory when
    # path is '.', so write an absolute dataset root for reliable CLI use.
    config["path"] = str(dataset_yaml.parent.resolve())
    return config, names


def validate_labels(dataset_root: Path, names: list[str]) -> dict[str, int]:
    counts = {"train": 0, "val": 0, "test": 0}
    warnings: list[str] = []
    for split in counts:
        label_dir = dataset_root / "labels" / split
        image_dir = dataset_root / "images" / split
        if not image_dir.is_dir():
            if split in ("train", "val"):
                raise FileNotFoundError(f"Missing required image split: {image_dir}")
            continue
        if not label_dir.is_dir():
            raise FileNotFoundError(f"Missing YOLO label split: {label_dir}")
        images = [
            p for p in image_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
        ]
        for image in images:
            label = label_dir / (image.stem + ".txt")
            if not label.is_file():
                warnings.append(f"No label file for {image.relative_to(dataset_root)}")
                continue
            for line_number, line in enumerate(label.read_text(encoding="utf-8").splitlines(), 1):
                if not line.strip():
                    continue
                parts = line.split()
                if len(parts) != 5:
                    raise ValueError(f"{label}:{line_number}: expected 5 YOLO values, got {len(parts)}.")
                class_id = int(float(parts[0]))
                if not 0 <= class_id < len(names):
                    raise ValueError(f"{label}:{line_number}: class id {class_id} is outside 0..{len(names)-1}.")
                coords = [float(value) for value in parts[1:]]
                if any(value < 0 or value > 1 for value in coords):
                    raise ValueError(f"{label}:{line_number}: box coordinates must be between 0 and 1.")
                if coords[2] <= 0 or coords[3] <= 0:
                    raise ValueError(f"{label}:{line_number}: box width and height must be positive.")
                counts[split] += 1
    if warnings:
        print(f"Warning: {len(warnings)} image(s) have no label file. They will be treated as background images.")
        for warning in warnings[:5]:
            print("  " + warning)
    if counts["train"] == 0:
        raise ValueError("The training split contains no labelled bounding boxes.")
    if counts["val"] == 0:
        raise ValueError("The validation split contains no labelled bounding boxes.")
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description="Train and export WildlifeVision YOLO11.")
    parser.add_argument("dataset", type=Path, help="Bird Library YOLO ZIP export or extracted dataset folder.")
    parser.add_argument("--model", default="yolo11n.pt", help="Starting checkpoint: yolo11n.pt for a new model, or a previous best.pt to fine-tune.")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=-1, help="-1 lets Ultralytics estimate a safe batch size.")
    parser.add_argument("--device", default=None, help="For example 0, cpu, or mps. Default: Ultralytics auto-select.")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--output", type=Path, default=Path("wildlifevision-training"))
    parser.add_argument("--name", default="bird-detector")
    parser.add_argument("--patience", type=int, default=25)
    parser.add_argument("--resume", action="store_true", help="Resume from the last checkpoint in the selected run.")
    args = parser.parse_args()

    source = args.dataset.expanduser().resolve()
    if not source.exists():
        parser.error(f"Dataset does not exist: {source}")
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)

    if source.is_file() and source.suffix.lower() == ".zip":
        extracted = output / "dataset"
        if extracted.exists():
            shutil.rmtree(extracted)
        dataset_root = safe_extract(source, extracted)
    elif source.is_dir():
        dataset_root = source
    else:
        parser.error("Dataset must be a .zip file or an extracted dataset directory.")

    yaml_path = dataset_root / "dataset.yaml"
    if not yaml_path.is_file():
        parser.error(f"Could not find dataset.yaml in {dataset_root}")
    config, names = load_dataset_yaml(yaml_path)
    counts = validate_labels(dataset_root, names)
    resolved_yaml = output / "dataset.training.yaml"
    resolved_yaml.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")

    print("\nWildlifeVision dataset")
    print(f"  Root: {dataset_root}")
    print(f"  Classes: {len(names)}")
    print(f"  Bounding boxes: {counts}")
    for index, name in enumerate(names):
        print(f"  {index:>2}: {name}")
    print("\nStarting Ultralytics training. A GPU is recommended; CPU training is supported but slow.")
    print(f"  Starting checkpoint: {args.model}")
    print("  Existing weights will be reused where layer shapes match; the detection head is adapted when the class list changes.\n")

    if args.resume:
        last_checkpoint = output / "runs" / args.name / "weights" / "last.pt"
        if not last_checkpoint.is_file():
            parser.error(f"No checkpoint to resume at {last_checkpoint}")
        model = YOLO(str(last_checkpoint))
    else:
        model = YOLO(args.model)
    train_args: dict[str, Any] = {
        "data": str(resolved_yaml),
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": args.batch,
        "workers": args.workers,
        "project": str(output / "runs"),
        "name": args.name,
        "patience": args.patience,
        "exist_ok": True,
        "plots": True,
        "verbose": True,
    }
    if args.device:
        train_args["device"] = args.device
    if args.resume:
        train_args["resume"] = True
    model.train(**train_args)

    run_dir = output / "runs" / args.name
    best_pt = run_dir / "weights" / "best.pt"
    if not best_pt.is_file():
        raise FileNotFoundError(f"Training finished but best checkpoint was not found: {best_pt}")

    print(f"\nExporting ONNX from {best_pt}")
    best_model = YOLO(str(best_pt))
    onnx_path = Path(best_model.export(
        format="onnx",
        imgsz=args.imgsz,
        opset=17,
        simplify=True,
        nms=False,
        dynamic=False,
    ))
    names_by_id = best_model.names
    ordered_names = [
        str(names_by_id[index]) for index in range(len(names_by_id))
    ] if isinstance(names_by_id, dict) else [str(name) for name in names_by_id]
    labels_path = onnx_path.with_name("best.labels.json")
    labels_path.write_text(
        json.dumps(ordered_names, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = {
        "architecture": "Ultralytics YOLO11",
        "checkpoint": str(best_pt),
        "fine_tuned_from": args.model,
        "onnx": str(onnx_path),
        "labels": str(labels_path),
        "input_size": args.imgsz,
        "class_count": len(ordered_names),
        "classes": ordered_names,
        "output_format": "raw YOLO output; NMS disabled for WildlifeVision decoder",
    }
    (onnx_path.parent / "wildlifevision-model.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("\nTraining and export complete.")
    print(f"  ONNX:   {onnx_path}")
    print(f"  Labels: {labels_path}")
    print(f"  PT:     {best_pt}")
    print("\nIn WildlifeVision, choose best.onnx, then upload best.labels.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
