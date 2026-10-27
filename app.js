/* Wildlife Vision web edition. All camera processing and dataset storage stay in this browser. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    stream: null, track: null, cameraRunning: false, raf: 0, lastFrame: null,
    frameWidth: 0, frameHeight: 0, sensitivity: 30, minArea: 25, zoom: 1,
    cssZoom: 1, masks: [], drawingMask: false, maskStart: null, maskDraft: null,
    maskMode: false, showMotion: true, showMasks: true, tracks: [], nextTrackId: 1,
    logs: [], db: null, records: [], duplicateCount: 0, editingId: null,
    objectURLs: new Map(), motionScore: 0, detectionMode: "ai", detectorModel: null, featureModel: null,
    aiBusy: false, aiLastRun: 0, lastLearnedScan: 0, aiDetections: [], aiThreshold: 0.45, trainingSamples: [], trainingReady: false, rfSession: null, rfLabels: [], rfModelName: "", rfInputSize: 560, rfBusy: false, rfProvider: "unloaded", spatialTracks: [], nextSpatialId: 1, showSpatialGrid: true, showTrails: true, showCoordinates: true
  };

  const video = $('cameraVideo');
  const canvas = $('motionCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const scratch = document.createElement('canvas');
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
  const cameraStage = $('cameraStage');
  const logLimit = 500;

  function log(message, level) {
    const entry = { time: new Date(), message: String(message), level: level || 'info' };
    state.logs.push(entry);
    if (state.logs.length > logLimit) state.logs.shift();
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = entry.time.toLocaleTimeString();
    const text = document.createElement('span');
    text.className = 'log-' + entry.level;
    text.textContent = entry.message;
    line.append(time, text);
    $('consoleOutput').append(line);
    $('consoleOutput').scrollTop = $('consoleOutput').scrollHeight;
    $('logCount').textContent = String(state.logs.length);
    console[entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log']('[Wildlife Vision] ' + entry.message);
  }

  function setStatus(text, live) {
    $('topStatus').textContent = text.toUpperCase();
    $('statusDot').classList.toggle('on', !!live);
    $('liveDot').classList.toggle('on', !!live);
    $('liveLabel').textContent = live ? 'LIVE' : 'STANDBY';
  }

  function setCameraCapability(text, kind) {
    const el = $('cameraCapability');
    el.textContent = text;
    el.className = kind || 'neutral';
  }

  function openTab(name) {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === name + 'Panel'));
    if (name === 'diagnostics') $('consoleOutput').scrollTop = $('consoleOutput').scrollHeight;
    if (name === 'library') renderLibrary();
  }
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => openTab(tab.dataset.tab)));

  async function startCamera() {
    if (state.cameraRunning) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraCapability('Unavailable', 'warn');
      log('Camera API unavailable. Open the site using HTTPS in a supported browser.', 'error');
      alert('Camera access requires HTTPS and a browser that supports getUserMedia. Use the GitHub Pages HTTPS address in Safari.');
      return;
    }
    try {
      log('Requesting rear-camera permission.');
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
      });
      video.srcObject = state.stream;
      await video.play();
      state.track = state.stream.getVideoTracks()[0] || null;
      state.cameraRunning = true;
      state.lastFrame = null;
      $('cameraPlaceholder').classList.add('hidden');
      $('startCamera').disabled = true;
      $('stopCamera').disabled = false;
      $('zoomSlider').disabled = false;
      setStatus('Camera live', true);
      setCameraCapability('Granted', 'good');
      log('Camera started: ' + (video.videoWidth || '?') + ' × ' + (video.videoHeight || '?') + '.');
      inspectZoomCapabilities();
      sizeCanvases();
      if (!state.detectorModel) loadAIModels().catch((error) => log("AI model loading failed: " + error.message, "error"));
      state.raf = requestAnimationFrame(processFrame);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setCameraCapability('Permission/error', 'warn');
      setStatus('Camera unavailable', false);
      log('Camera start failed: ' + message, 'error');
      if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        alert('Safari did not grant camera access. Check the site permissions and ensure you are using the HTTPS GitHub Pages URL.');
      } else {
        alert('Could not start the camera: ' + message);
      }
    }
  }

  function stopCamera() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    state.track = null;
    state.cameraRunning = false;
    video.srcObject = null;
    state.lastFrame = null;
    state.tracks = [];
    state.aiDetections = [];
    $('birdCount').textContent = '0'; $('speciesMatchCount').textContent = '0';
    state.motionScore = 0;
    $('cameraPlaceholder').classList.remove('hidden');
    $('startCamera').disabled = false;
    $('stopCamera').disabled = true;
    $('zoomSlider').disabled = true;
    setStatus('Camera paused', false);
    setCameraCapability('Stopped', 'neutral');
    drawOverlay([]);
    updateMetrics([], 0);
    renderTracks();
    log('Camera stopped; video tracks released.');
  }

  async function inspectZoomCapabilities() {
    if (!state.track || !state.track.getCapabilities) {
      log('Camera zoom API is not exposed; CSS zoom fallback will be used.', 'warn');
      return;
    }
    const caps = state.track.getCapabilities();
    if (caps.zoom) {
      const min = Math.max(1, Number(caps.zoom.min) || 1);
      const max = Math.max(min, Math.min(6, Number(caps.zoom.max) || 3));
      $('zoomSlider').min = String(min);
      $('zoomSlider').max = String(max);
      log('Hardware zoom supported: ' + min + '× to ' + max + '×.');
    } else {
      log('Hardware zoom is not available in this browser/camera; using visual crop zoom.', 'warn');
    }
  }

  async function setZoom(value) {
    state.zoom = Number(value);
    $('zoomValue').textContent = state.zoom.toFixed(1) + '×';
    let applied = false;
    if (state.track && state.track.getCapabilities && state.track.getCapabilities().zoom && state.track.applyConstraints) {
      try {
        await state.track.applyConstraints({ advanced: [{ zoom: state.zoom }] });
        applied = true;
      } catch (error) {
        log('Hardware zoom adjustment failed; using visual zoom: ' + error.message, 'warn');
      }
    }
    state.cssZoom = applied ? 1 : state.zoom;
    video.style.transform = 'scale(' + state.cssZoom + ')';
    log('Zoom set to ' + state.zoom.toFixed(1) + '×' + (applied ? ' (camera hardware).' : ' (visual crop).'));
  }
  $('zoomSlider').addEventListener('input', (event) => setZoom(event.target.value));
  $('zoomReset').addEventListener('click', () => { $('zoomSlider').value = '1'; setZoom(1); });

  function sizeCanvases() {
    if (!video.videoWidth || !video.videoHeight) return;
    const maxWidth = 400;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(160, Math.round(video.videoWidth * scale));
    const height = Math.round(video.videoHeight * width / video.videoWidth);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      scratch.width = width; scratch.height = height;
      state.frameWidth = width; state.frameHeight = height;
      state.lastFrame = null;
    }
  }

  function processFrame() {
    if (!state.cameraRunning) return;
    if (state.detectionMode === "ai" || state.detectionMode === "rfdetr") {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) runAIDetection();
      state.raf = requestAnimationFrame(processFrame);
      return;
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      sizeCanvases();
      try {
        scratchCtx.drawImage(video, 0, 0, scratch.width, scratch.height);
        const current = scratchCtx.getImageData(0, 0, scratch.width, scratch.height);
        let regions = [];
        let changedRatio = 0;
        if (state.lastFrame) {
          const result = findMotionRegions(current.data, state.lastFrame.data, scratch.width, scratch.height);
          regions = result.regions;
          changedRatio = result.changedRatio;
        }
        state.lastFrame = current;
        const tracked = updateTracks(regions);
        drawOverlay(tracked);
        state.motionScore = changedRatio;
        updateMetrics(tracked, changedRatio);
        renderTracks();
      } catch (error) {
        log('Frame processing failed: ' + error.message, 'error');
      }
    }
    state.raf = requestAnimationFrame(processFrame);
  }


  async function loadRfDetrModel() {
    const file = $('rfModelPicker').files && $('rfModelPicker').files[0];
    if (!file) { $('rfStatus').textContent = 'Choose a compatible RF-DETR ONNX export first.'; return; }
    if (!window.ort || !window.ort.InferenceSession) throw new Error('ONNX Runtime Web did not load. Check internet access and reload.');
    $('loadRfDetr').disabled = true;
    $('rfStatus').textContent = 'Loading model into browser memory. Large models may exceed iPad memory limits…';
    try {
      const bytes = await file.arrayBuffer();
      let session;
      try {
        session = await window.ort.InferenceSession.create(bytes, { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'all' });
        state.rfProvider = 'WebGPU preferred';
      } catch (gpuError) {
        log('RF-DETR WebGPU initialisation failed; retrying with WASM: ' + gpuError.message, 'warn');
        session = await window.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        state.rfProvider = 'WASM';
      }
      state.rfSession = session;
      state.rfModelName = file.name;
      const meta = session.inputMetadata && session.inputMetadata[session.inputNames[0]];
      const dims = meta && meta.dimensions;
      state.rfInputSize = dims && dims.length >= 4 && Number.isFinite(dims[2]) && dims[2] > 0 ? dims[2] : 560;
      state.detectionMode = 'rfdetr';
      $('rfMode').className = 'button primary'; $('aiMode').className = 'button secondary'; $('motionMode').className = 'button secondary';
      $('rfStatus').textContent = 'Loaded ' + file.name + ' · input ' + state.rfInputSize + 'px · ' + state.rfProvider + '. Test with known images before relying on results.';
      $('detectorCapability').textContent = 'RF-DETR ready'; $('detectorCapability').className = 'good';
      log('RF-DETR ONNX loaded: ' + file.name + '; inputs=' + session.inputNames.join(',') + '; outputs=' + session.outputNames.join(',') + '.');
    } catch (error) {
      state.rfSession = null; $('rfStatus').textContent = 'RF-DETR load failed: ' + error.message;
      log('RF-DETR load failed: ' + error.message, 'error'); throw error;
    } finally { $('loadRfDetr').disabled = false; }
  }

  async function runRfDetrDetection() {
    if (!state.rfSession || state.rfBusy || !video.videoWidth || !video.videoHeight) return;
    state.rfBusy = true;
    try {
      const side = state.rfInputSize || 560;
      const inputCanvas = document.createElement('canvas'); inputCanvas.width = side; inputCanvas.height = side;
      const inputCtx = inputCanvas.getContext('2d', { willReadFrequently: true });
      inputCtx.fillStyle = '#fff'; inputCtx.fillRect(0, 0, side, side);
      const scale = Math.min(side / video.videoWidth, side / video.videoHeight);
      const drawW = Math.round(video.videoWidth * scale), drawH = Math.round(video.videoHeight * scale);
      const offX = Math.floor((side - drawW) / 2), offY = Math.floor((side - drawH) / 2);
      inputCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, offX, offY, drawW, drawH);
      const pixels = inputCtx.getImageData(0, 0, side, side).data, plane = side * side;
      const input = new Float32Array(plane * 3), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
      for (let p = 0; p < plane; p++) {
        input[p] = (pixels[p * 4] / 255 - mean[0]) / std[0];
        input[plane + p] = (pixels[p * 4 + 1] / 255 - mean[1]) / std[1];
        input[plane * 2 + p] = (pixels[p * 4 + 2] / 255 - mean[2]) / std[2];
      }
      const result = await state.rfSession.run({ [state.rfSession.inputNames[0]]: new window.ort.Tensor('float32', input, [1, 3, side, side]) });
      const outputs = state.rfSession.outputNames.map((name) => ({ name, tensor: result[name] }));
      const boxOutput = outputs.find((o) => { const d = o.tensor.dims || []; return d.length >= 2 && d[d.length - 1] === 4; });
      const scoreOutput = outputs.find((o) => o !== boxOutput && (o.tensor.dims || []).length >= 2);
      if (!boxOutput || !scoreOutput) throw new Error('Could not identify boxes and scores in the ONNX outputs. This export needs a model-specific adapter.');
      const boxes = boxOutput.tensor.data, scores = scoreOutput.tensor.data;
      const boxDims = boxOutput.tensor.dims, scoreDims = scoreOutput.tensor.dims;
      const count = boxDims[boxDims.length - 2], classes = scoreDims[scoreDims.length - 1], detections = [];
      for (let i = 0; i < count; i++) {
        let bestScore = -Infinity, bestClass = 0;
        for (let c = 0; c < classes; c++) {
          const raw = scores[i * classes + c], score = raw >= 0 && raw <= 1 ? raw : 1 / (1 + Math.exp(-raw));
          if (score > bestScore) { bestScore = score; bestClass = c; }
        }
        if (bestScore < state.aiThreshold) continue;
        let bx = boxes[i * 4], by = boxes[i * 4 + 1], bw = boxes[i * 4 + 2], bh = boxes[i * 4 + 3];
        if (Math.max(Math.abs(bx), Math.abs(by), Math.abs(bw), Math.abs(bh)) <= 2) {
          bx = (bx - bw / 2) * side; by = (by - bh / 2) * side; bw *= side; bh *= side;
        } else { bx -= bw / 2; by -= bh / 2; }
        const x = Math.max(0, (bx - offX) / scale), y = Math.max(0, (by - offY) / scale);
        const w = Math.min(video.videoWidth - x, bw / scale), h = Math.min(video.videoHeight - y, bh / scale);
        if (!(w > 2 && h > 2)) continue;
        if (isMasked((x + w / 2) / video.videoWidth, (y + h / 2) / video.videoHeight)) continue;
        const label = state.rfLabels[bestClass] || ('class_' + bestClass);
        detections.push({ prediction: { bbox: [x, y, w, h], score: bestScore, class: label }, match: { label, similarity: 0 } });
      }
      detections.sort((a, b) => b.prediction.score - a.prediction.score);
      state.aiDetections = detections.slice(0, 30); updateSpatialTracks(state.aiDetections); drawAIDetections();
      $('birdCount').textContent = String(state.aiDetections.length); $('speciesMatchCount').textContent = '0';
      $('aiStatus').textContent = 'RF-DETR inference completed. Verify the export’s input normalisation, box format and score format if detections look wrong.';
    } catch (error) {
      $('rfStatus').textContent = 'RF-DETR inference error: ' + error.message;
      log('RF-DETR inference failed: ' + error.message, 'error');
    } finally { state.rfBusy = false; }
  }

  async function loadAIModels() {
    if (state.detectorModel && state.featureModel) return;
    if (!window.cocoSsd || !window.mobilenet || !window.tf) {
      $('aiStatus').textContent = 'AI libraries did not load. Check internet access and reload the page.';
      throw new Error('TensorFlow.js model libraries are unavailable.');
    }
    $('loadAI').disabled = true;
    $('aiStatus').textContent = 'Loading AI models. The first download can take a while on iPad…';
    log('Loading pretrained COCO-SSD object detector.');
    try {
      await window.tf.ready();
      state.detectorModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
      log('Bird object detector loaded.');
      $('detectorCapability').textContent = 'Ready';
      $('detectorCapability').className = 'good';
      $('aiStatus').textContent = 'Loading visual feature model for species matching…';
      state.featureModel = await window.mobilenet.load({ version: 2, alpha: 1.0 });
      $('aiStatus').textContent = 'AI detector ready. To identify species, label photos in the Bird library and train the example matcher.';
      log('MobileNet feature extractor loaded.');
      $('loadAI').textContent = 'AI models ready';
      $('loadAI').classList.remove('secondary');
      $('loadAI').classList.add('primary');
      if (state.records.some((record) => record.speciesLabel && record.speciesLabel !== 'Unlabelled')) {
        log('Labelled library records found. Train the species matcher from the Bird library when ready.');
      }
    } catch (error) {
      state.detectorModel = null;
      state.featureModel = null;
      $('detectorCapability').textContent = 'Load failed';
      $('detectorCapability').className = 'warn';
      $('aiStatus').textContent = 'Could not load AI models: ' + error.message;
      throw error;
    } finally {
      $('loadAI').disabled = false;
    }
  }

  function cosineSimilarity(a, b) {
    let dot = 0, aa = 0, bb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return dot / (Math.sqrt(aa * bb) || 1);
  }

  async function extractFeatures(source) {
    const tensor = state.featureModel.infer(source, true);
    try {
      const values = await tensor.data();
      const shape = tensor.shape;
      // Pool spatial activations into a compact feature vector so larger libraries
      // do not consume hundreds of megabytes on an iPad.
      if (shape.length === 4 && shape[0] === 1) {
        const height = shape[1], width = shape[2], channels = shape[3];
        const pooled = new Array(channels).fill(0);
        const positions = height * width;
        for (let p = 0; p < positions; p++) {
          const offset = p * channels;
          for (let c = 0; c < channels; c++) pooled[c] += values[offset + c] / positions;
        }
        return pooled;
      }
      return Array.from(values);
    } finally {
      tensor.dispose();
    }
  }

  async function trainSpeciesMatcher() {
    if (!state.records.length) {
      $('importStatus').textContent = 'Import labelled bird photos first.';
      return;
    }
    if (!state.featureModel) {
      try { await loadAIModels(); } catch (error) { $('importStatus').textContent = 'AI models could not load: ' + error.message; return; }
    }
    const labelled = state.records.filter((record) => record.speciesLabel && !['Unlabelled', 'Unknown'].includes(record.speciesLabel.trim()));
    if (!labelled.length) {
      $('importStatus').textContent = 'No labelled photos found. Edit each image and assign its correct species first.';
      return;
    }
    $('trainSpecies').disabled = true;
    $('importStatus').textContent = 'Learning visual examples from ' + labelled.length + ' labelled photo(s)…';
    state.trainingSamples = [];
    let failed = 0;
    try {
      for (let i = 0; i < labelled.length; i++) {
        const record = labelled[i];
        try {
          const image = new Image();
          image.src = imageURL(record);
          await new Promise((resolve, reject) => {
            if (image.complete && image.naturalWidth) return resolve();
            image.onload = resolve; image.onerror = () => reject(new Error('Image could not be decoded'));
          });
          const features = await extractFeatures(image);
          state.trainingSamples.push({ label: record.speciesLabel.trim(), features, recordId: record.id });
        } catch (error) {
          failed++;
          log('Skipped training image ' + record.filename + ': ' + error.message, 'warn');
        }
        $('importStatus').textContent = 'Learning ' + (i + 1) + ' / ' + labelled.length + ' · ' + state.trainingSamples.length + ' usable';
        if (i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      state.trainingReady = state.trainingSamples.length > 0;
      const labels = new Set(state.trainingSamples.map((sample) => sample.label));
      $('classifierCapability').textContent = state.trainingReady ? labels.size + ' species learned' : 'Not trained';
      $('classifierCapability').className = state.trainingReady ? 'good' : 'warn';
      $('importStatus').textContent = 'Learned ' + state.trainingSamples.length + ' image example(s) across ' + labels.size + ' species · ' + failed + ' skipped. This is example-based matching, not full model-weight training.';
      $('trainSpecies').textContent = 'Relearn from photos';
      log('Species matcher ready: ' + state.trainingSamples.length + ' examples, ' + labels.size + ' species, ' + failed + ' images skipped.');
    } finally {
      $('trainSpecies').disabled = false;
    }
  }

  async function classifyCropBox(box) {
    if (!state.trainingReady || !state.featureModel) return { label: 'Unmatched', similarity: 0 };
    const crop = document.createElement('canvas');
    crop.width = 224; crop.height = 224;
    const cropCtx = crop.getContext('2d');
    const x = Math.max(0, Math.floor(box[0]));
    const y = Math.max(0, Math.floor(box[1]));
    const w = Math.max(1, Math.min(video.videoWidth - x, Math.floor(box[2])));
    const h = Math.max(1, Math.min(video.videoHeight - y, Math.floor(box[3])));
    cropCtx.fillStyle = '#fff'; cropCtx.fillRect(0, 0, 224, 224);
    cropCtx.drawImage(video, x, y, w, h, 0, 0, 224, 224);
    const features = await extractFeatures(crop);
    let best = null;
    for (const sample of state.trainingSamples) {
      const similarity = cosineSimilarity(features, sample.features);
      if (!best || similarity > best.similarity) best = { label: sample.label, similarity };
    }
    return best && best.similarity >= 0.62 ? best : { label: 'Unmatched', similarity: best ? best.similarity : 0 };
  }

  async function scanForLearnedObjects() {
    if (!state.trainingReady || !state.featureModel || Date.now() - state.lastLearnedScan < 2200) return [];
    state.lastLearnedScan = Date.now();
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return [];
    const side = Math.floor(Math.min(vw, vh) * 0.52);
    const xs = [0, Math.max(0, Math.floor((vw - side) / 2)), Math.max(0, vw - side)];
    const ys = [0, Math.max(0, vh - side)];
    const candidates = [];
    for (const y of ys) for (const x of xs) candidates.push([x, y, Math.min(side, vw - x), Math.min(side, vh - y)]);
    let best = null;
    for (const box of candidates) {
      const match = await classifyCropBox(box);
      if (match.label !== 'Unmatched' && (!best || match.similarity > best.match.similarity)) best = { box, match };
    }
    if (!best) return [];
    return [{
      prediction: { bbox: best.box, score: best.match.similarity, class: best.match.label, learned: true },
      match: best.match
    }];
  }

  async function runAIDetection() {
    if (state.detectionMode === 'rfdetr') { await runRfDetrDetection(); return; }
    if (!state.detectorModel || state.aiBusy || Date.now() - state.aiLastRun < 450) return;
    state.aiBusy = true;
    state.aiLastRun = Date.now();
    try {
      const threshold = state.aiThreshold;
      const predictions = await state.detectorModel.detect(video, 10, threshold);
      const candidates = predictions.filter((item) => item.score >= threshold).map((item) => ({
        prediction: item,
        centerX: (item.bbox[0] + item.bbox[2] / 2) / (video.videoWidth || 1),
        centerY: (item.bbox[1] + item.bbox[3] / 2) / (video.videoHeight || 1)
      })).filter((item) => !isMasked(item.centerX, item.centerY));
      const detections = [];
      for (const candidate of candidates.slice(0, 4)) {
        let match = { label: candidate.prediction.class, similarity: 0 };
        if (state.trainingReady) {
          try {
            const learned = await classifyCropBox(candidate.prediction.bbox);
            if (learned.label !== 'Unmatched') match = learned;
          } catch (error) { log('Species matching failed: ' + error.message, 'warn'); }
        }
        detections.push({ prediction: candidate.prediction, match });
      }
      if (state.trainingReady && Date.now() - state.lastLearnedScan >= 2200) {
        try {
          const learnedHits = await scanForLearnedObjects();
          if (learnedHits.length) {
            const hit = learnedHits[0];
            const box = hit.prediction.bbox;
            const overlaps = detections.some((item) => {
              const b = item.prediction.bbox;
              const cx = (box[0] + box[2] / 2), cy = (box[1] + box[3] / 2);
              return cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3];
            });
            if (!overlaps) detections.push(hit);
          }
        } catch (error) { log('Learned object scan failed: ' + error.message, 'warn'); }
      }
      detections.sort((a, b) => (b.match.similarity || b.prediction.score) - (a.match.similarity || a.prediction.score));
      state.aiDetections = detections;
      updateSpatialTracks(detections);
      drawAIDetections();
      $('birdCount').textContent = String(detections.length);
      $('speciesMatchCount').textContent = String(detections.filter((item) => item.match.label !== 'Unmatched' && item.match.similarity > 0).length);
      renderTracks();
      if (detections.length && !state.trainingReady) {
        $('aiStatus').textContent = detections.length + ' bird(s) detected. Train the species matcher to suggest species names.';
      } else if (!detections.length) {
        $('aiStatus').textContent = 'AI detector running. No birds detected in the latest frame.';
      }
    } catch (error) {
      log('AI detection failed: ' + error.message, 'error');
      $('aiStatus').textContent = 'AI detection error: ' + error.message;
    } finally {
      state.aiBusy = false;
    }
  }

  function updateSpatialTracks(detections) {
    const now = performance.now();
    state.spatialTracks.forEach((track) => { track.missed++; });
    const claimed = new Set(), next = [];
    for (const item of detections) {
      const b = item.prediction.bbox;
      const fw = video.videoWidth || 1, fh = video.videoHeight || 1;
      const box = { x: b[0] / fw, y: b[1] / fh, w: b[2] / fw, h: b[3] / fh };
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const label = item.match.label === 'Unmatched' ? (item.prediction.class || 'Object') : (item.match.label || item.prediction.class || 'Object');
      let best = null, bestCost = Infinity;
      for (const track of state.spatialTracks) {
        if (claimed.has(track.id) || track.label !== label) continue;
        const distance = Math.hypot(cx - track.cx, cy - track.cy);
        const overlap = iou(box, track.box);
        const cost = distance * 0.72 + (1 - overlap) * 0.28;
        if ((overlap > 0.01 || distance < 0.14) && cost < bestCost) { best = track; bestCost = cost; }
      }
      if (!best) {
        best = { id: state.nextSpatialId++, label, born: now, history: [], box, cx, cy, vx: 0, vy: 0, missed: 0 };
        log('Spatial track #' + best.id + ' acquired: ' + label + '.');
      } else {
        const dt = Math.max(0.04, (now - (best.updatedAt || now - 40)) / 1000);
        const rawVx = (cx - best.cx) / dt, rawVy = (cy - best.cy) / dt;
        best.vx = best.vx * 0.55 + rawVx * 0.45;
        best.vy = best.vy * 0.55 + rawVy * 0.45;
      }
      best.box = box; best.cx = cx; best.cy = cy; best.updatedAt = now; best.missed = 0; best.item = item;
      best.history.push({ x: cx, y: cy, t: now });
      if (best.history.length > 18) best.history.shift();
      claimed.add(best.id); next.push(best);
    }
    for (const track of state.spatialTracks) {
      if (track.missed > 0 && track.missed <= 8 && !next.some((item) => item.id === track.id)) next.push(track);
    }
    state.spatialTracks = next.filter((track) => track.missed <= 8);
    const active = state.spatialTracks.filter((track) => track.missed === 0);
    $('spatialCount').textContent = String(active.length);
    $('sceneSummary').textContent = active.length ? active.map((track) => track.label + ' · ' + relativePosition(track.cx, track.cy)).slice(0, 3).join(' | ') : 'No tracked objects in view';
  }

  function relativePosition(x, y) {
    const horizontal = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'centre';
    const vertical = y < 0.34 ? 'upper' : y > 0.66 ? 'lower' : 'middle';
    return vertical + ' ' + horizontal;
  }

  function movementLabel(track) {
    const speed = Math.hypot(track.vx || 0, track.vy || 0);
    if (speed < 0.025) return 'mostly still';
    const horizontal = Math.abs(track.vx) > Math.abs(track.vy) * 0.65 ? (track.vx > 0 ? 'right' : 'left') : '';
    const vertical = Math.abs(track.vy) > Math.abs(track.vx) * 0.65 ? (track.vy > 0 ? 'down' : 'up') : '';
    const direction = [vertical, horizontal].filter(Boolean).join('-');
    return direction + ' · ' + Math.round(speed * 100) + '% frame/s';
  }

  function drawSpatialOverlay() {
    if (state.showSpatialGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(185,255,128,.34)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      for (let i = 1; i < 3; i++) {
        const x = canvas.width * i / 3, y = canvas.height * i / 3;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(225,255,205,.82)'; ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('UPPER LEFT', 5, 12); ctx.fillText('UPPER CENTRE', canvas.width / 3 + 5, 12); ctx.fillText('UPPER RIGHT', canvas.width * 2 / 3 + 5, 12);
      ctx.restore();
    }
    if (state.showTrails) {
      for (const track of state.spatialTracks) {
        if (track.history.length < 2) continue;
        ctx.save(); ctx.strokeStyle = 'rgba(184,255,92,.8)'; ctx.lineWidth = 2; ctx.beginPath();
        track.history.forEach((point, index) => {
          const x = point.x * canvas.width, y = point.y * canvas.height;
          if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        const last = track.history[track.history.length - 1];
        ctx.fillStyle = '#eaffb8'; ctx.beginPath(); ctx.arc(last.x * canvas.width, last.y * canvas.height, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawAIDetections() {
    sizeCanvases();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSpatialOverlay();
    if (state.showMasks) {
      state.masks.forEach((mask) => {
        const mx = mask.x * canvas.width, my = mask.y * canvas.height;
        const mw = mask.w * canvas.width, mh = mask.h * canvas.height;
        ctx.fillStyle = 'rgba(255,174,74,.15)';
        ctx.strokeStyle = '#ffbd6b'; ctx.lineWidth = 2;
        ctx.setLineDash([7, 4]);
        ctx.fillRect(mx, my, mw, mh); ctx.strokeRect(mx, my, mw, mh);
        ctx.setLineDash([]);
      });
    }
    if (!state.showMotion) return;
    const sx = canvas.width / (video.videoWidth || canvas.width);
    const sy = canvas.height / (video.videoHeight || canvas.height);
    const cw = canvas.width, ch = canvas.height;
    for (const item of state.aiDetections) {
      const box = item.prediction.bbox;
      const x = Math.max(0, Math.min(cw, box[0] * sx));
      const y = Math.max(0, Math.min(ch, box[1] * sy));
      const w = Math.max(0, Math.min(cw - x, box[2] * sx));
      const h = Math.max(0, Math.min(ch - y, box[3] * sy));
      const pct = Math.round(item.prediction.score * 100);
      const rawLabel = item.match.label === 'Unmatched' ? String(item.prediction.class || 'OBJECT') : item.match.label;
      const spatial = state.spatialTracks.find((track) => track.missed === 0 && track.item === item);
      const label = (spatial ? '#' + spatial.id + ' ' : '') + rawLabel.toUpperCase();
      const place = spatial && state.showCoordinates ? relativePosition(spatial.cx, spatial.cy).toUpperCase() + ' · ' : '';
      const motion = spatial && state.showCoordinates ? movementLabel(spatial) + ' · ' : '';
      const text = label + '  ' + pct + '% · ' + place + motion;
      ctx.save();
      // A dark halo keeps the box legible against both bright sky and dark foliage.
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.72)'; ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#b8ff5c'; ctx.strokeRect(x, y, w, h);
      const corner = Math.min(13, Math.max(5, Math.min(w, h) * .16));
      ctx.lineWidth = 4; ctx.strokeStyle = '#eaffb8';
      ctx.beginPath();
      ctx.moveTo(x, y + corner); ctx.lineTo(x, y); ctx.lineTo(x + corner, y);
      ctx.moveTo(x + w - corner, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + corner);
      ctx.moveTo(x, y + h - corner); ctx.lineTo(x, y + h); ctx.lineTo(x + corner, y + h);
      ctx.moveTo(x + w - corner, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - corner);
      ctx.stroke();
      ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      const labelWidth = Math.min(cw, ctx.measureText(text).width + 18);
      const labelHeight = 25;
      // Prefer above the box; flip inside/below when the box touches the top.
      const labelX = Math.max(0, Math.min(cw - labelWidth, x));
      const labelY = y >= labelHeight + 4 ? y - labelHeight - 2 : Math.min(ch - labelHeight, y + 2);
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#b8ff5c';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(labelX, labelY, labelWidth, labelHeight, 5);
      else ctx.rect(labelX, labelY, labelWidth, labelHeight);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#14200b';
      ctx.textBaseline = 'middle';
      const availableTextWidth = Math.max(0, labelWidth - 12);
      let shown = text;
      while (ctx.measureText(shown).width > availableTextWidth && shown.length > 4) shown = shown.slice(0, -2) + '…';
      ctx.fillText(shown, labelX + 7, labelY + labelHeight / 2, availableTextWidth);
      ctx.restore();
    }
  }

  function isMasked(x, y) {
    for (const mask of state.masks) {
      if (x >= mask.x && x <= mask.x + mask.w && y >= mask.y && y <= mask.y + mask.h) return true;
    }
    return false;
  }

  function findMotionRegions(current, previous, width, height) {
    const step = 2;
    const cellW = Math.ceil(width / step), cellH = Math.ceil(height / step);
    const grid = new Uint8Array(cellW * cellH);
    const threshold = Number(state.sensitivity);
    let changed = 0, considered = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (isMasked(x / width, y / height)) continue;
        const p = (y * width + x) * 4;
        const cGray = (current[p] * 0.299) + (current[p + 1] * 0.587) + (current[p + 2] * 0.114);
        const oGray = (previous[p] * 0.299) + (previous[p + 1] * 0.587) + (previous[p + 2] * 0.114);
        considered++;
        if (Math.abs(cGray - oGray) > threshold) {
          grid[Math.floor(y / step) * cellW + Math.floor(x / step)] = 1;
          changed++;
        }
      }
    }
    const ratio = considered ? changed / considered : 0;
    const visited = new Uint8Array(grid.length);
    const regions = [];
    const minPixels = Math.max(4, Math.floor((width * height) * (Number(state.minArea) / 10000) / (step * step)));
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i] || visited[i]) continue;
      const stack = [i]; visited[i] = 1;
      let count = 0, minX = cellW, minY = cellH, maxX = 0, maxY = 0;
      while (stack.length) {
        const at = stack.pop(), gx = at % cellW, gy = Math.floor(at / cellW);
        count++; minX = Math.min(minX, gx); minY = Math.min(minY, gy); maxX = Math.max(maxX, gx); maxY = Math.max(maxY, gy);
        for (const d of dirs) {
          const nx = gx + d[0], ny = gy + d[1];
          if (nx < 0 || ny < 0 || nx >= cellW || ny >= cellH) continue;
          const ni = ny * cellW + nx;
          if (grid[ni] && !visited[ni]) { visited[ni] = 1; stack.push(ni); }
        }
      }
      if (count >= minPixels) {
        regions.push({ x: (minX * step) / width, y: (minY * step) / height,
          w: Math.min(1, ((maxX - minX + 1) * step) / width),
          h: Math.min(1, ((maxY - minY + 1) * step) / height),
          confidence: Math.min(0.99, count / Math.max(minPixels, 1) / 4) });
      }
    }
    regions.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    return { regions: regions.slice(0, 12), changedRatio: ratio * 100 };
  }

  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function updateTracks(regions) {
    state.tracks.forEach((track) => { track.missed++; });
    const used = new Set();
    const output = [];
    for (const region of regions) {
      let best = null, score = 0;
      for (const track of state.tracks) {
        if (used.has(track.id)) continue;
        const candidate = iou(region, track);
        if (candidate > score) { score = candidate; best = track; }
      }
      let track;
      if (best && score >= 0.12) {
        track = best; track.missed = 0; track.x = region.x; track.y = region.y; track.w = region.w; track.h = region.h;
        track.confidence = region.confidence;
      } else {
        track = { id: state.nextTrackId++, x: region.x, y: region.y, w: region.w, h: region.h, confidence: region.confidence, missed: 0, started: Date.now() };
        state.tracks.push(track);
        log('Track #' + track.id + ' created by frame differencing.');
      }
      used.add(track.id);
      output.push(track);
    }
    state.tracks = state.tracks.filter((track) => track.missed <= 5);
    return output;
  }

  function drawOverlay(tracks) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.showMasks) {
      state.masks.forEach((mask) => {
        ctx.fillStyle = 'rgba(255,174,74,.18)';
        ctx.strokeStyle = '#ffbd6b';
        ctx.lineWidth = 2;
        ctx.fillRect(mask.x * canvas.width, mask.y * canvas.height, mask.w * canvas.width, mask.h * canvas.height);
        ctx.strokeRect(mask.x * canvas.width, mask.y * canvas.height, mask.w * canvas.width, mask.h * canvas.height);
        ctx.fillStyle = '#ffcf91';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('EXCLUSION', mask.x * canvas.width + 5, mask.y * canvas.height + 13);
      });
    }
    if (state.maskDraft) {
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(state.maskDraft.x * canvas.width, state.maskDraft.y * canvas.height, state.maskDraft.w * canvas.width, state.maskDraft.h * canvas.height);
      ctx.setLineDash([]);
    }
    if (!state.showMotion) return;
    tracks.forEach((track) => {
      const x = track.x * canvas.width, y = track.y * canvas.height, w = track.w * canvas.width, h = track.h * canvas.height;
      ctx.strokeStyle = '#a7f36c'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#a7f36c';
      const label = '#' + track.id + ' MOTION';
      ctx.font = 'bold 10px ui-monospace, monospace';
      const labelWidth = ctx.measureText(label).width + 10;
      ctx.fillRect(x, Math.max(0, y - 18), labelWidth, 18);
      ctx.fillStyle = '#12200e';
      ctx.fillText(label, x + 5, Math.max(12, y - 6));
    });
  }

  function updateMetrics(tracks, score) {
    $('motionCount').textContent = String(tracks.length);
    $('trackCount').textContent = String(state.tracks.length);
    $('motionScore').textContent = score.toFixed(1) + '%';
    $('motionReadout').textContent = 'MOTION ' + score.toFixed(1) + '%';
    $('maskCount').textContent = String(state.masks.length);
  }

  function renderTracks() {
    const root = $('tracksList');
    root.replaceChildren();
    if (state.detectionMode === 'ai' || state.detectionMode === 'rfdetr') {
      if (!state.aiDetections.length) {
        root.className = 'empty-state';
        root.textContent = state.cameraRunning ? 'Waiting for AI detections. Birds must be visible and large enough for the model.' : 'Load the AI models and start the camera to detect birds.';
        return;
      }
      root.className = 'track-list';
      state.aiDetections.forEach((item, index) => {
        const card = document.createElement('div'); card.className = 'track-item';
        const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String(index + 1);
        const info = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = item.match.label === 'Unmatched' ? (item.prediction.class || 'Object') + ' detected' : item.match.label;
        const detail = document.createElement('small');
        const spatial = state.spatialTracks.find((track) => track.missed === 0 && track.item === item);
        detail.textContent = 'Detector ' + Math.round(item.prediction.score * 100) + '% confidence' +
          (item.match.similarity ? ' · visual match ' + Math.round(item.match.similarity * 100) + '%' : '') +
          (spatial ? ' · ' + relativePosition(spatial.cx, spatial.cy) + ' · ' + movementLabel(spatial) : '');
        info.append(title, detail); card.append(number, info); root.append(card);
      });
      return;
    }
    const active = state.tracks.filter((track) => track.missed <= 5);
    if (!active.length) {
      root.className = 'empty-state';
      root.textContent = state.cameraRunning ? 'No motion regions detected in the current frame.' : 'No active tracks. Start the camera and introduce movement into the frame.';
      return;
    }
    root.className = 'track-list';
    active.forEach((track) => {
      const item = document.createElement('div'); item.className = 'track-item';
      const number = document.createElement('span'); number.className = 'track-number'; number.textContent = '#' + track.id;
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = 'Motion region';
      const detail = document.createElement('small'); detail.textContent = Math.round(track.w * 100) + '% × ' + Math.round(track.h * 100) + '% frame · ' + Math.round(track.confidence * 100) + '% activity';
      info.append(title, detail); item.append(number, info); root.append(item);
    });
  }

  $('loadAI').addEventListener('click', () => loadAIModels().catch((error) => log('AI load error: ' + error.message, 'error')));
  $('loadRfDetr').addEventListener('click', () => loadRfDetrModel().catch((error) => log('RF-DETR load error: ' + error.message, 'error')));
  $('rfLabelsPicker').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      state.rfLabels = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.names) ? parsed.names : Object.values(parsed));
      $('rfLabelsName').textContent = file.name + ' · ' + state.rfLabels.length + ' labels';
      $('rfStatus').textContent = 'Loaded ' + state.rfLabels.length + ' class labels from ' + file.name + '.';
      log('Loaded RF-DETR labels: ' + state.rfLabels.length + '.');
    } catch (error) { $('rfStatus').textContent = 'Labels JSON invalid: ' + error.message; log('RF-DETR labels parse failed: ' + error.message, 'error'); }
  });
  $('rfMode').addEventListener('click', () => {
    if (!state.rfSession) { $('rfStatus').textContent = 'Load a compatible RF-DETR ONNX model first.'; return; }
    state.detectionMode = 'rfdetr'; $('rfMode').className = 'button primary'; $('aiMode').className = 'button secondary'; $('motionMode').className = 'button secondary';
    state.lastFrame = null; log('Detection mode changed to RF-DETR ONNX.');
  });
  $('trainSpecies').addEventListener('click', trainSpeciesMatcher);
  $('aiMode').addEventListener('click', () => {
    state.detectionMode = 'ai';
    $('aiMode').className = 'button primary'; $('rfMode').className = 'button secondary'; $('motionMode').className = 'button secondary';
    state.lastFrame = null; state.tracks = [];
    drawAIDetections();
    $('aiStatus').textContent = state.detectorModel ? 'AI bird detection selected.' : 'Load the AI models to begin object detection.';
    log('Detection mode changed to AI bird detection.');
  });
  $('motionMode').addEventListener('click', () => {
    state.detectionMode = 'motion';
    $('motionMode').className = 'button primary'; $('aiMode').className = 'button secondary'; $('rfMode').className = 'button secondary';
    state.aiDetections = []; state.lastFrame = null;
    drawOverlay(state.tracks);
    log('Detection mode changed to optional motion tracking.');
  });
  $('aiThreshold').addEventListener('input', (event) => {
    state.aiThreshold = Number(event.target.value) / 100;
    $('aiThresholdValue').textContent = event.target.value + '%';
  });
  $('startCamera').addEventListener('click', startCamera);
  $('stopCamera').addEventListener('click', stopCamera);
  $('resetTracks').addEventListener('click', () => {
    state.tracks = []; state.nextTrackId = 1; state.spatialTracks = []; state.nextSpatialId = 1; log('Motion and spatial tracking IDs reset.');
    drawOverlay([]); renderTracks();
  });
  $('sensitivity').addEventListener('input', (event) => {
    state.sensitivity = Number(event.target.value); $('sensitivityValue').textContent = event.target.value;
  });
  $('minArea').addEventListener('input', (event) => {
    state.minArea = Number(event.target.value); $('minAreaValue').textContent = (Number(event.target.value) / 100).toFixed(2) + '%';
  });
  $('showMotion').addEventListener('change', (event) => { state.showMotion = event.target.checked; drawAIDetections(); });
  $('showSpatialGrid').addEventListener('change', (event) => { state.showSpatialGrid = event.target.checked; drawAIDetections(); });
  $('showTrails').addEventListener('change', (event) => { state.showTrails = event.target.checked; drawAIDetections(); });
  $('showCoordinates').addEventListener('change', (event) => { state.showCoordinates = event.target.checked; drawAIDetections(); });
  $('showMasks').addEventListener('change', (event) => { state.showMasks = event.target.checked; });
  $('maskMode').addEventListener('click', () => {
    state.maskMode = !state.maskMode;
    cameraStage.classList.toggle('masking', state.maskMode);
    $('maskMode').textContent = state.maskMode ? 'Finish mask drawing' : 'Draw exclusion mask';
    $('maskHelp').classList.toggle('hidden', !state.maskMode);
    canvas.style.pointerEvents = state.maskMode ? 'auto' : 'none';
    log(state.maskMode ? 'Mask drawing enabled. Drag on the camera preview.' : 'Mask drawing disabled.');
  });
  $('clearMasks').addEventListener('click', () => {
    state.masks = []; state.maskDraft = null;
    $('maskCount').textContent = '0'; log('All exclusion masks cleared.');
  });

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!state.maskMode) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    state.maskStart = canvasPoint(event);
    state.maskDraft = { x: state.maskStart.x, y: state.maskStart.y, w: 0, h: 0 };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.maskMode || !state.maskStart) return;
    const p = canvasPoint(event), start = state.maskStart;
    state.maskDraft = { x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    drawOverlay(state.tracks.filter((track) => track.missed <= 5));
  });
  canvas.addEventListener('pointerup', () => {
    if (!state.maskStart || !state.maskDraft) return;
    const mask = state.maskDraft;
    if (mask.w > 0.015 && mask.h > 0.015) {
      state.masks.push(mask);
      log('Exclusion mask added: ' + Math.round(mask.w * 100) + '% × ' + Math.round(mask.h * 100) + '% of frame.');
    }
    state.maskStart = null; state.maskDraft = null;
    drawOverlay(state.tracks.filter((track) => track.missed <= 5));
    $('maskCount').textContent = String(state.masks.length);
  });

  // IndexedDB stores the actual image blobs and JSON-like record metadata locally.
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB is unavailable in this browser.')); return; }
      const request = indexedDB.open('WildlifeVisionDB', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('images')) {
          const store = db.createObjectStore('images', { keyPath: 'id' });
          store.createIndex('hash', 'sha256', { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local database.'));
    });
  }
  function dbRequest(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction('images', mode);
      const store = tx.objectStore('images');
      let req;
      try { req = action(store); } catch (error) { reject(error); return; }
      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Database operation failed.'));
      } else {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Database transaction failed.'));
      }
    });
  }
  async function loadRecords() {
    state.records = await dbRequest('readonly', (store) => store.getAll());
    state.records.sort((a, b) => b.importedAt - a.importedAt);
    renderLibrary();
    log('Loaded ' + state.records.length + ' dataset record(s) from local IndexedDB.');
  }
  async function digestFile(file) {
    if (!crypto.subtle) throw new Error('SHA-256 requires a secure context. Open the HTTPS GitHub Pages version.');
    const bytes = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'wv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function isImageFile(file, path) {
    const name = (path || file.name || '').toLowerCase();
    return (file.type && file.type.startsWith('image/')) || /\\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif)$/i.test(name);
  }

  async function importFiles(fileList, folderMode) {
    const files = Array.from(fileList || []).map((item) => item && item.file ? item : ({ file: item, relativePath: item.webkitRelativePath || item.name }))
      .filter((item) => item.file && isImageFile(item.file, item.relativePath));
    if (!files.length) { $('importStatus').textContent = 'No supported images found. Try a ZIP containing your species folders.'; return; }
    let imported = 0, duplicates = 0, failed = 0;
    $('importStatus').textContent = 'Importing ' + files.length + ' image(s)…';
    log('Import started for ' + files.length + ' image(s).');
    const hashes = new Set(state.records.map((record) => record.sha256));
    for (let i = 0; i < files.length; i++) {
      const item = files[i], file = item.file, relativePath = item.relativePath || file.name;
      try {
        const hash = await digestFile(file);
        if (hashes.has(hash)) { duplicates++; continue; }
        hashes.add(hash);
        let label = 'Unlabelled';
        if (folderMode) {
          const parts = relativePath.split('/').filter(Boolean);
          if (parts.length > 1) label = parts[parts.length - 2] || label;
        }
        const record = {
          id: newId(), filename: file.name, sourceName: file.name,
          relativePath, speciesLabel: label, split: 'unassigned', sha256: hash,
          importedAt: Date.now(), box: null, blob: file
        };
        await dbRequest('readwrite', (store) => store.add(record));
        state.records.unshift(record); imported++;
      } catch (error) {
        failed++;
        log('Could not import ' + file.name + ': ' + error.message, 'warn');
      }
      if (i % 8 === 0) $('importStatus').textContent = 'Processing ' + (i + 1) + ' of ' + files.length + '…';
    }
    state.duplicateCount += duplicates;
    $('duplicateTotal').textContent = String(state.duplicateCount);
    $('importStatus').textContent = 'Imported ' + imported + ' · skipped ' + duplicates + ' duplicates · failed ' + failed + '. Review the labels before using this as training data.';
    log('Import complete: ' + imported + ' added, ' + duplicates + ' duplicates skipped, ' + failed + ' failed.');
    renderLibrary();
  }

  async function importZip(file) {
    if (!window.JSZip) {
      $('importStatus').textContent = 'ZIP support could not load. Check your internet connection and reload.';
      log('JSZip library unavailable; ZIP import cannot run.', 'error');
      return;
    }
    try {
      $('importStatus').textContent = 'Opening ZIP archive…';
      const zip = await window.JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && isImageFile({name: entry.name, type: ''}, entry.name));
      if (!entries.length) {
        $('importStatus').textContent = 'No supported photos found inside that ZIP.';
        log('ZIP contained no supported image files: ' + file.name, 'warn');
        return;
      }
      $('importStatus').textContent = 'Extracting ' + entries.length + ' image(s)…';
      const items = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const blob = await entry.async('blob');
        const filename = entry.name.split('/').pop();
        const mime = /\\.jpe?g$/i.test(filename) ? 'image/jpeg' : /\\.png$/i.test(filename) ? 'image/png' : /\\.webp$/i.test(filename) ? 'image/webp' : /\\.heic$/i.test(filename) ? 'image/heic' : /\\.heif$/i.test(filename) ? 'image/heif' : /\\.gif$/i.test(filename) ? 'image/gif' : 'application/octet-stream';
        items.push({file: new File([blob], filename, {type: mime, lastModified: file.lastModified}), relativePath: entry.name});
        if (i % 20 === 0) $('importStatus').textContent = 'Extracting ' + (i + 1) + ' of ' + entries.length + '…';
      }
      await importFiles(items, true);
    } catch (error) {
      $('importStatus').textContent = 'Could not read ZIP: ' + error.message;
      log('ZIP import failed: ' + error.message, 'error');
    }
  }

  $('imagePicker').addEventListener('change', async (event) => {
    await importFiles(event.target.files, false); event.target.value = '';
  });
  $('folderPicker').addEventListener('change', async (event) => {
    await importFiles(event.target.files, true); event.target.value = '';
  });
  $('zipPicker').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) await importZip(file);
    event.target.value = '';
  });

  function imageURL(record) {
    if (!state.objectURLs.has(record.id)) state.objectURLs.set(record.id, URL.createObjectURL(record.blob));
    return state.objectURLs.get(record.id);
  }
  function renderLibrary() {
    const search = $('librarySearch').value.trim().toLowerCase();
    const split = $('splitFilter').value;
    const filtered = state.records.filter((record) => {
      const matches = (record.filename + ' ' + record.speciesLabel).toLowerCase().includes(search);
      return matches && (split === 'all' || record.split === split);
    });
    const species = new Set(state.records.map((record) => record.speciesLabel));
    $('trainSpecies').disabled = !state.records.some((record) => record.speciesLabel && !['Unlabelled', 'Unknown'].includes(record.speciesLabel.trim()));
    $('libraryCount').textContent = String(state.records.length);
    $('imageTotal').textContent = String(state.records.length);
    $('speciesTotal').textContent = String(species.size);
    $('boxTotal').textContent = String(state.records.filter((record) => record.box).length);
    $('exportCsv').disabled = !state.records.length;
    $('clearLibrary').disabled = !state.records.length;
    const root = $('imageGrid'); root.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.style.gridColumn = '1 / -1';
      empty.textContent = state.records.length ? 'No images match these filters.' : 'Import images to begin building your dataset.';
      root.append(empty); return;
    }
    filtered.forEach((record) => {
      const card = document.createElement('article'); card.className = 'image-card';
      const img = document.createElement('img'); img.src = imageURL(record); img.alt = record.speciesLabel + ' dataset image'; img.loading = 'lazy';
      const body = document.createElement('div'); body.className = 'image-card-body';
      const label = document.createElement('strong'); label.textContent = record.speciesLabel;
      const filename = document.createElement('p'); filename.textContent = record.filename; filename.title = record.filename;
      const foot = document.createElement('div'); foot.className = 'image-card-foot';
      const badge = document.createElement('span'); badge.className = 'split-badge'; badge.textContent = record.split;
      const edit = document.createElement('button'); edit.className = 'edit-button'; edit.textContent = 'Edit'; edit.addEventListener('click', () => editRecord(record.id));
      foot.append(badge, edit); body.append(label, filename, foot); card.append(img, body); root.append(card);
    });
  }
  $('librarySearch').addEventListener('input', renderLibrary);
  $('splitFilter').addEventListener('change', renderLibrary);

  function editRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    state.editingId = id;
    $('editPreview').src = imageURL(record);
    $('editLabel').value = record.speciesLabel;
    $('editSplit').value = record.split;
    $('editDialog').showModal();
  }
  $('editForm').addEventListener('submit', async (event) => {
    if (event.submitter && event.submitter.value !== 'save') return;
    event.preventDefault();
    const record = state.records.find((item) => item.id === state.editingId);
    if (!record) return;
    record.speciesLabel = $('editLabel').value.trim() || 'Unlabelled';
    record.split = $('editSplit').value;
    try {
      await dbRequest('readwrite', (store) => store.put(record));
      $('editDialog').close();
      renderLibrary();
      $('importStatus').textContent = 'Record saved.';
      log('Updated record ' + record.filename + ': label="' + record.speciesLabel + '", split=' + record.split + '.');
    } catch (error) {
      log('Could not save record: ' + error.message, 'error');
    }
  });

  function csvEscape(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
  function exportCSV() {
    const header = ['filename','species_label','split','relative_path','sha256','box_x','box_y','box_width','box_height'];
    const lines = state.records.map((record) => {
      const box = record.box || {};
      return [csvEscape(record.filename),csvEscape(record.speciesLabel),record.split,csvEscape(record.relativePath),record.sha256,box.x ?? '',box.y ?? '',box.width ?? '',box.height ?? ''].join(',');
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'WildlifeVision-dataset-manifest.csv'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    log('Exported CSV manifest for ' + state.records.length + ' image(s).');
  }
  $('exportCsv').addEventListener('click', exportCSV);

  $('clearLibrary').addEventListener('click', async () => {
    if (!state.records.length || !confirm('Delete all imported images and labels from this browser? This cannot be undone. Export the CSV first if you need it.')) return;
    try {
      await dbRequest('readwrite', (store) => store.clear());
      state.objectURLs.forEach((url) => URL.revokeObjectURL(url));
      state.objectURLs.clear(); state.records = []; state.duplicateCount = 0;
      $('duplicateTotal').textContent = '0';
      $('importStatus').textContent = 'Library cleared.';
      renderLibrary(); log('Dataset library cleared by user.', 'warn');
    } catch (error) { log('Could not clear library: ' + error.message, 'error'); }
  });

  $('clearLogs').addEventListener('click', () => {
    state.logs = []; $('consoleOutput').replaceChildren(); $('logCount').textContent = '0';
    log('Console cleared.');
  });
  $('copyLogs').addEventListener('click', async () => {
    const text = state.logs.map((entry) => entry.time.toISOString() + ' [' + entry.level.toUpperCase() + '] ' + entry.message).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      log('Copied diagnostic log to clipboard.');
    } catch (error) {
      log('Clipboard permission failed: ' + error.message, 'warn');
    }
  });

  async function init() {
    $('runtimeLabel').textContent = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'iOS Safari' : 'Browser';
    $('storageLabel').textContent = ('indexedDB' in window) ? 'IndexedDB' : 'Unavailable';
    log('Wildlife Vision web app initialising.');
    log('Runtime: ' + navigator.userAgent);
    log('Secure context: ' + (window.isSecureContext ? 'yes' : 'no') + '.');
    log('AI detector loads on demand. RF-DETR ONNX inference is available as an experimental model-upload path; motion tracking remains available as a secondary mode.');
    if (!window.isSecureContext) log('Use HTTPS (GitHub Pages) for camera access and SHA-256 duplicate checks.', 'warn');
    try {
      state.db = await openDatabase();
      await loadRecords();
      $('storageLabel').textContent = 'Ready';
      setCameraCapability('Not started', 'neutral');
      log('Local database ready.');
      $('trainSpecies').disabled = !state.records.some((record) => record.speciesLabel && !['Unlabelled', 'Unknown'].includes(record.speciesLabel.trim()));
    } catch (error) {
      $('storageLabel').textContent = 'Error';
      log('Local database initialisation failed: ' + error.message, 'error');
      $('importStatus').textContent = 'Local storage failed: ' + error.message;
    }
  }
  window.addEventListener('pagehide', () => {
    if (state.raf) cancelAnimationFrame(state.raf);
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.objectURLs.forEach((url) => URL.revokeObjectURL(url));
  });
  init();
})();