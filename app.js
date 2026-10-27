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
    objectURLs: new Map(), motionScore: 0
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
    const active = state.tracks.filter((track) => track.missed <= 5);
    if (!active.length) {
      root.className = 'empty-state';
      root.textContent = state.cameraRunning ? 'No motion regions detected in the current frame.' : 'No active tracks. Start the camera and introduce movement into the frame.';
      return;
    }
    root.className = 'track-list';
    root.replaceChildren();
    active.forEach((track) => {
      const item = document.createElement('div'); item.className = 'track-item';
      const number = document.createElement('span'); number.className = 'track-number'; number.textContent = '#' + track.id;
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = 'Motion region';
      const detail = document.createElement('small'); detail.textContent = Math.round(track.w * 100) + '% × ' + Math.round(track.h * 100) + '% frame · ' + Math.round(track.confidence * 100) + '% activity';
      info.append(title, detail); item.append(number, info); root.append(item);
    });
  }

  $('startCamera').addEventListener('click', startCamera);
  $('stopCamera').addEventListener('click', stopCamera);
  $('resetTracks').addEventListener('click', () => {
    state.tracks = []; state.nextTrackId = 1; log('Tracking IDs reset.');
    drawOverlay([]); renderTracks();
  });
  $('sensitivity').addEventListener('input', (event) => {
    state.sensitivity = Number(event.target.value); $('sensitivityValue').textContent = event.target.value;
  });
  $('minArea').addEventListener('input', (event) => {
    state.minArea = Number(event.target.value); $('minAreaValue').textContent = (Number(event.target.value) / 100).toFixed(2) + '%';
  });
  $('showMotion').addEventListener('change', (event) => { state.showMotion = event.target.checked; });
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
    log('Detector model: unavailable. Frame differencing will report motion regions, not bird species.', 'warn');
    if (!window.isSecureContext) log('Use HTTPS (GitHub Pages) for camera access and SHA-256 duplicate checks.', 'warn');
    try {
      state.db = await openDatabase();
      await loadRecords();
      $('storageLabel').textContent = 'Ready';
      setCameraCapability('Not started', 'neutral');
      log('Local database ready.');
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