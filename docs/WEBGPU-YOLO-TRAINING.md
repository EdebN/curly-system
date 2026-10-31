# Local WebGPU YOLO11 training in Dataset Studio

## Status

**Design committed; trainer implementation is not yet present.** The current application can export the Dataset Studio annotations as a YOLO dataset and run a user-supplied YOLO11 ONNX model. It does not train YOLO weights in the browser. The existing **Learn from labelled photos** action builds the separate MobileNet example matcher; it must not be presented as detector training.

This document defines the implementation target so the browser UI, dataset format, training engine, and ONNX detector remain compatible. It is not a claim that the training pipeline is already working.

## Product constraints

- Keep the workflow inside the existing **Bird library / Dataset Studio** tab. Do not create a separate hosted service or require Colab.
- All image decoding, augmentation, training, validation, checkpoints, and export stay on the user's device.
- Reuse the existing IndexedDB records, labels, bounding boxes, and train/validation/test split assignments. Do not create a second dataset store or require a second annotation pass.
- Support multiple objects in one image. Every annotated box becomes an independent training target; there is no two-box cap in the training data path.
- Use the existing class list when present, but derive the final class map from the selected dataset and preserve its exact order in the exported labels JSON.
- Keep the existing ONNX inference adapter contract: raw YOLO detection output, 640 × 640 input by default, NMS disabled in the exported graph, and class-aware NMS in the browser detector.

## Training target

Initial scope is **YOLO11n detection** only. Do not silently substitute an image classifier, feature matcher, confidence-threshold adjustment, or synthetic detector and call it YOLO training.

The implementation must train actual detector parameters, including the YOLO11 feature extractor, feature-pyramid/aggregation layers, and detection head. It must implement the corresponding forward pass, gradient computation, detection losses (box regression, classification, and distribution focal loss), and an optimizer. A WebGPU availability check by itself is not a trainer.

## Browser architecture

1. **Dataset adapter**
   - Read records and image blobs from the existing IndexedDB database.
   - Convert normalized annotation boxes into YOLO targets.
   - Validate missing labels, invalid boxes, empty splits, and class-index consistency before training.
   - Decode and resize images in a worker where supported.

2. **WebGPU engine**
   - Request `navigator.gpu` and a GPU device only after the user presses Train.
   - Run GPU compute through WGSL kernels. The engine must include real forward and backward passes; GPU preprocessing followed by CPU-only weight updates does not qualify.
   - Keep the training engine in a dedicated worker where browser support permits, and report progress to the Dataset Studio panel.
   - Use deterministic, bounded batches and expose batch size, image size, epochs, and learning rate.
   - Do not assume WebGPU exists in every browser. Safari/iPad and older devices need a clear unsupported state; do not silently fall back to a fake or different training method.

3. **Training lifecycle**
   - Provide start, pause/resume, and cancel controls.
   - Show epoch, batch progress, training loss, validation loss, precision, recall, and mAP where those metrics can be computed correctly.
   - Save resumable checkpoints locally (prefer OPFS with an IndexedDB fallback); handle quota errors and interrupted sessions.
   - Never upload photos, labels, gradients, or weights to a remote service.

4. **Export**
   - Export a trained detector as ONNX plus a labels JSON sidecar.
   - Validate the exported model's input/output names and tensor shapes before offering it for download.
   - Keep export compatible with the current YOLO11 raw-output decoder in `app.js`.
   - If ONNX export cannot be performed in-browser with the selected implementation, state that limitation explicitly rather than exporting an incompatible file.

## Dataset Studio UI

The controls belong in the existing `#libraryPanel`:

- A dedicated **Train YOLO11** action, separate from **Learn from labelled photos**.
- Dataset summary showing labelled images, annotated boxes, class count, and train/validation/test counts.
- Training settings with safe defaults for YOLO11n.
- A capability/status area showing WebGPU availability, device limits, and estimated memory constraints.
- Progress, metrics, checkpoint state, and clear errors.
- Export controls for ONNX and labels JSON.

The example-based matcher remains available, but its label must continue to make clear that it does not update detector weights.

## Acceptance tests

- A dataset containing two or more birds in one image produces all corresponding targets.
- Class IDs and names remain stable from Dataset Studio through training and ONNX inference.
- Train/validation/test records are not mixed.
- A tiny deterministic fixture can complete a forward pass, backward pass, and optimizer update; at least one detector weight must change.
- A saved checkpoint can be restored and training can continue.
- The validation path computes metrics from predictions and ground-truth boxes, not from training loss or guessed values.
- The exported ONNX model passes a shape/metadata check and can be loaded by the existing browser inference adapter.
- No dataset content is sent over the network.
- Unsupported WebGPU browsers receive a clear explanation and retain all existing dataset and ONNX inference features.

## Important technical caveat

WebGPU is a GPU compute API, not a complete automatic-differentiation or YOLO training framework. The browser engine therefore needs an actual differentiable implementation of the selected YOLO11n graph and its loss functions. Existing ONNX Runtime Web inference support and TensorFlow.js WebGPU inference support do not, by themselves, provide this training pipeline. Do not mark this feature complete until the acceptance tests above pass on real hardware.
