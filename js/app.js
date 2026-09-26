import { CATEGORIES, DEFAULT_CATEGORIES, maskPreview, prettyLabel } from "../vendor/core/rules.js";
import { CATEGORY_COLORS } from "../vendor/core/redact.js";
import { ALL_FORMATS, AudioSampleSink, AudioSampleSource, BlobSource, BufferTarget, CanvasSource, Input, Output, Quality, WebMOutputFormat, canEncodeAudio, canEncodeVideo } from "../vendor/mediabunny.mjs";
import { activeDetections, boxAt, buildTracks, clampFrameRate, downscaleGray, estimateShift, framePlan, isSceneChange, mergeBoxes, sampleTimes, verificationTimes } from "./tracker.js";

const $ = (sel) => document.querySelector(sel);
const els = {
  drop: $("#drop"), file: $("#file"), example: $("#example"), workspace: $("#workspace"), video: $("#video"), overlay: $("#overlay"),
  status: $("#status"), engine: $("#engine"), tracks: $("#tracks"), tracksEmpty: $("#tracks-empty"), timeline: $("#timeline"),
  categories: $("#categories"), terms: $("#terms"), useNer: $("#use-ner"), styleNote: $("#style-note"),
  selectAll: $("#select-all"), selectNone: $("#select-none"), rescan: $("#rescan"), reset: $("#reset"),
  exportBtn: $("#export"), cancel: $("#cancel"), bar: $("#bar"), exportStatus: $("#export-status"), verify: $("#verify"), download: $("#download"), exportCanvas: $("#export-canvas"),
  tabs: document.querySelectorAll("[role=tab]"),
};

const state = {
  url: null, file: null, name: "video", duration: 0, width: 0, height: 0, fps: 30,
  tracks: [], selected: new Set(), style: "black box", scanSeq: 0, workerSeq: 0, pending: new Map(), busy: false,
  exportAbort: false, lastMetrics: null, mediaInfo: null, scanTimes: [],
};

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const downloads = new Map();
worker.onmessage = ({ data: m }) => {
  if (m.type === "download") {
    downloads.set(m.label, m);
    const loaded = [...downloads.values()].reduce((a, d) => a + d.loaded, 0);
    const total = [...downloads.values()].reduce((a, d) => a + d.total, 0);
    if (total) setEngine(`Downloading on-device models… ${mb(loaded)} / ${mb(total)} MB`, "busy");
  } else if (m.type === "ready") {
    setEngine("✓ Engine ready — OCR, rules, face detection and Mediabunny are bundled", "ok");
  } else if (m.type === "progress") {
    if (m.text) setStatus(m.text, "busy");
  } else if (m.type === "warning") {
    setStatus(m.text, "warn");
  } else if (["scan-result", "probe-result", "error"].includes(m.type)) {
    const p = state.pending.get(m.id);
    if (!p) return;
    state.pending.delete(m.id);
    m.type === "error" ? p.reject(new Error(m.text)) : p.resolve(m);
  }
};
worker.onerror = (e) => setEngine(`Engine failed to start: ${e.message || "unknown error"}`, "warn");
worker.postMessage({ type: "warmup" });

function callWorker(type, payload, transfer = []) {
  const id = ++state.workerSeq;
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    worker.postMessage({ type, id, ...payload }, transfer);
  });
}

const scanFrame = (image, options) => callWorker("scan", { image, options }, [image.data.buffer]);
const probeMedia = (file) => callWorker("probe", { file }).then((m) => m.info);

// ------------------------------------------------------------- input

els.file.addEventListener("change", () => els.file.files[0] && loadFile(els.file.files[0]));
els.drop.addEventListener("click", (e) => e.target.closest("button,a") || els.file.click());
els.drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), els.file.click()));
for (const t of [document.body]) {
  t.addEventListener("dragover", (e) => { e.preventDefault(); els.drop.classList.add("over"); });
  t.addEventListener("dragleave", (e) => e.relatedTarget || els.drop.classList.remove("over"));
  t.addEventListener("drop", (e) => {
    e.preventDefault(); els.drop.classList.remove("over");
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("video/") || /\.(mp4|webm)$/i.test(x.name));
    if (f) loadFile(f);
  });
}
els.example.addEventListener("click", async (e) => {
  e.stopPropagation();
  setStatus("Loading fake example…", "busy");
  const res = await fetch("examples/fake-screen.webm");
  const blob = await res.blob();
  loadFile(new File([blob], "fake-screen.webm", { type: "video/webm" }));
});

async function loadFile(file) {
  if (state.busy) return;
  cleanupUrl();
  state.file = file;
  state.name = (file.name || "video").replace(/\.[^.]+$/, "");
  state.tracks = [];
  state.selected = new Set();
  state.mediaInfo = null;
  renderSide();
  setStatus("Reading container with Mediabunny…", "busy");
  try { state.mediaInfo = await probeMedia(file); }
  catch (err) { setStatus(`Could not inspect with Mediabunny (${err.message}); browser decode will still be tried.`, "warn"); }
  state.url = URL.createObjectURL(file);
  els.video.src = state.url;
  els.video.muted = true;
  els.video.preload = "auto";
  try { await waitLoaded(els.video); }
  catch {
    setStatus("This browser cannot decode that video. Try MP4 H.264/AAC or WebM VP8/VP9/AV1.", "warn");
    return;
  }
  state.duration = Number.isFinite(els.video.duration) ? els.video.duration : (state.mediaInfo?.duration || 0);
  state.width = els.video.videoWidth || state.mediaInfo?.width || 1280;
  state.height = els.video.videoHeight || state.mediaInfo?.height || 720;
  state.fps = clampFrameRate(state.mediaInfo?.frameRate || 30);
  els.overlay.width = state.width; els.overlay.height = state.height;
  els.drop.hidden = true; els.workspace.hidden = false;
  setStatus(`Loaded ${state.width}×${state.height}, ${state.duration.toFixed(1)}s. Sampling frames…`, "busy");
  drawOverlay();
  await runScan();
}

function waitLoaded(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth) return resolve();
    const ok = () => cleanup(resolve);
    const bad = () => cleanup(reject);
    const cleanup = (fn) => { video.removeEventListener("loadedmetadata", ok); video.removeEventListener("error", bad); fn(); };
    video.addEventListener("loadedmetadata", ok, { once: true });
    video.addEventListener("error", bad, { once: true });
  });
}

// ------------------------------------------------------------- scan + tracking

async function runScan() {
  if (!state.file || state.busy) return;
  state.busy = true; state.scanSeq++;
  const mine = state.scanSeq;
  disableActions(true);
  const started = performance.now();
  const categories = checkedCategories();
  const customTerms = els.terms.value.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
  const options = { categories, customTerms, useNer: els.useNer.checked };
  const times = sampleTimes(state.duration);
  state.scanTimes = times;
  const canvas = document.createElement("canvas");
  canvas.width = state.width; canvas.height = state.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const samples = [];
  let prevGray = null;
  let extraScenes = 0;
  let scannedFrames = 0;
  try {
    for (let i = 0; i < times.length; i++) {
      if (mine !== state.scanSeq) return;
      const t = times[i];
      setStatus(`Scanning sample ${i + 1}/${times.length} at ${fmt(t)}…`, "busy");
      await seek(t);
      ctx.drawImage(els.video, 0, 0, state.width, state.height);
      const imageData = ctx.getImageData(0, 0, state.width, state.height);
      const gray = downscaleGray(imageData, 96, Math.max(1, Math.round(96 * state.height / state.width)));
      let shift = { dx: 0, dy: 0 };
      let scene = false;
      if (prevGray) {
        const smallShift = estimateShift(prevGray, gray, 8);
        shift = { dx: smallShift.dx * state.width / gray.width, dy: smallShift.dy * state.height / gray.height };
        scene = isSceneChange(prevGray, gray);
        if (scene) extraScenes++;
      }
      const res = await scanFrame({ data: imageData.data, width: imageData.width, height: imageData.height }, options);
      samples.push({ t, detections: res.detections, shift });
      scannedFrames++;
      prevGray = gray;
    }
    const manual = state.tracks.filter((t) => t.source === "you");
    state.tracks = [...buildTracks(samples).map((t) => ({ ...t, end: Math.min(state.duration, t.end) })), ...manual];
    state.tracks = state.tracks.map((t, i) => ({ ...t, id: i + 1 }));
    state.selected = new Set(state.tracks.map((t) => t.id));
    const elapsed = (performance.now() - started) / 1000;
    state.lastMetrics = { scanSeconds: elapsed, scanRate: state.duration / Math.max(0.1, elapsed) };
    setStatus(`Found ${state.tracks.length} tracked item${state.tracks.length === 1 ? "" : "s"} from ${scannedFrames}/${times.length} OCR-sampled frames in ${elapsed.toFixed(1)}s (${state.lastMetrics.scanRate.toFixed(2)}× realtime). ${extraScenes} scene-change frame${extraScenes === 1 ? "" : "s"} noted.`, state.tracks.length ? "ok" : "warn");
  } catch (err) {
    setStatus(`Scan failed: ${err.message}. You can still draw manual boxes.`, "warn");
  } finally {
    state.busy = false; disableActions(false); renderAll();
  }
}

async function seek(t) {
  const dur = Number.isFinite(state.duration) && state.duration > 0
    ? state.duration
    : (Number.isFinite(els.video.duration) ? els.video.duration : 0);
  t = Math.max(0, Math.min(Number.isFinite(t) ? t : 0, Math.max(0, dur - 0.03)));
  if (Math.abs(els.video.currentTime - t) < 0.015 && els.video.readyState >= 2) return;
  await new Promise((resolve) => {
    const done = () => { els.video.removeEventListener("seeked", done); resolve(); };
    els.video.addEventListener("seeked", done, { once: true });
    els.video.currentTime = t;
  });
}

// ------------------------------------------------------------- rendering

function renderAll() { renderSide(); renderTimeline(); drawOverlay(); }

function renderSide() {
  els.tracks.replaceChildren(...state.tracks.map((tr) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.className = "track-row";
    const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: state.selected.has(tr.id) });
    cb.addEventListener("change", () => { cb.checked ? state.selected.add(tr.id) : state.selected.delete(tr.id); renderAll(); });
    const dot = Object.assign(document.createElement("span"), { className: "dot" });
    dot.style.background = CATEGORY_COLORS[tr.category] || "#64748b";
    const text = document.createElement("span");
    text.innerHTML = `<span class="name">#${tr.id} ${tr.source === "you" ? "Your box" : prettyLabel(tr.label)}</span><br><span class="preview"></span><br><span class="range">${fmt(tr.start)}–${fmt(tr.end)}</span>`;
    text.querySelector(".preview").textContent = maskPreview(tr.text || tr.category);
    label.append(cb, dot, text);
    label.addEventListener("click", (e) => { if (e.target !== cb) els.video.currentTime = tr.start; });
    li.append(label);
    return li;
  }));
  els.tracksEmpty.hidden = state.tracks.length > 0;
}

function renderTimeline() {
  els.timeline.replaceChildren();
  const dur = Math.max(0.1, state.duration);
  state.tracks.forEach((tr, i) => {
    const bar = document.createElement("button");
    bar.className = "trackbar";
    bar.title = `#${tr.id} ${prettyLabel(tr.label)} ${fmt(tr.start)}–${fmt(tr.end)}`;
    bar.style.left = `${100 * tr.start / dur}%`;
    bar.style.width = `${Math.max(0.5, 100 * (tr.end - tr.start) / dur)}%`;
    bar.style.top = `${8 + (i % 6) * 10}px`;
    bar.style.background = CATEGORY_COLORS[tr.category] || "#64748b";
    bar.addEventListener("click", () => { els.video.currentTime = tr.start; });
    els.timeline.append(bar);
  });
}

function drawOverlay() {
  const c = els.overlay;
  if (!state.width) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const detections = activeDetections(state.tracks, null, els.video.currentTime || 0);
  const lw = Math.max(2, Math.round(Math.min(c.width, c.height) / 360));
  const font = Math.max(12, Math.round(Math.min(c.width, c.height) / 48));
  ctx.font = `700 ${font}px system-ui, sans-serif`; ctx.textBaseline = "top";
  for (const d of detections) {
    const on = state.selected.has(d.id), color = CATEGORY_COLORS[d.category] || "#64748b";
    const [x, y, w, h] = rect(d.box);
    ctx.globalAlpha = on ? 0.25 : 0.08; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.setLineDash(on ? [] : [lw * 3, lw * 2]); ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    const label = String(d.id), tw = ctx.measureText(label).width + 8, ty = Math.max(0, y - font - 4);
    ctx.fillStyle = color; ctx.fillRect(x, ty, tw, font + 4); ctx.fillStyle = "#fff"; ctx.fillText(label, x + 4, ty + 2);
  }
  if (drag.box) { ctx.setLineDash([8, 5]); ctx.lineWidth = lw; ctx.strokeStyle = CATEGORY_COLORS.custom; ctx.strokeRect(drag.box.x0, drag.box.y0, drag.box.x1 - drag.box.x0, drag.box.y1 - drag.box.y0); ctx.setLineDash([]); }
}
els.video.addEventListener("timeupdate", drawOverlay);
els.video.addEventListener("play", () => requestAnimationFrame(tickOverlay));
function tickOverlay() { drawOverlay(); if (!els.video.paused && !els.video.ended) requestAnimationFrame(tickOverlay); }

// ------------------------------------------------------------- manual boxes

const drag = { start: null, box: null };
function toVideoPoint(e) {
  const r = els.overlay.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * state.width, y: ((e.clientY - r.top) / r.height) * state.height };
}
els.overlay.addEventListener("pointerdown", (e) => { if (!state.width) return; els.overlay.setPointerCapture(e.pointerId); drag.start = toVideoPoint(e); });
els.overlay.addEventListener("pointermove", (e) => {
  if (!drag.start) return;
  const p = toVideoPoint(e);
  drag.box = { x0: Math.min(p.x, drag.start.x), y0: Math.min(p.y, drag.start.y), x1: Math.max(p.x, drag.start.x), y1: Math.max(p.y, drag.start.y) };
  drawOverlay();
});
els.overlay.addEventListener("pointerup", () => {
  const b = drag.box; drag.start = drag.box = null;
  if (b && b.x1 - b.x0 > 6 && b.y1 - b.y0 > 6) {
    const mode = document.querySelector("input[name=manual-range]:checked")?.value || "whole";
    const start = mode === "from-here" ? els.video.currentTime : 0;
    const tr = { id: state.tracks.length + 1, category: "custom", label: "MANUAL", text: "manual", source: "you", start, end: state.duration, first: start, last: state.duration, frames: [{ t: start, box: b }, { t: state.duration, box: b }] };
    state.tracks.push(tr); state.selected.add(tr.id); renderAll();
  }
  drawOverlay();
});

// ------------------------------------------------------------- export + verify

els.exportBtn.addEventListener("click", exportVideo);
els.cancel.addEventListener("click", () => { state.exportAbort = true; });

async function exportVideo() {
  if (!state.file || state.busy) return;
  state.busy = true; state.exportAbort = false; disableActions(true); showTab("tab-output");
  els.cancel.hidden = false; els.download.hidden = true; els.verify.textContent = ""; els.bar.style.width = "0%";
  const canvas = els.exportCanvas; canvas.width = state.width; canvas.height = state.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const started = performance.now();
  try {
    const duration = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : els.video.duration;
    const result = await encodeWithMediabunny({ canvas, ctx, duration, started });
    const { blob, label, audioStatus } = result;
    const elapsed = (performance.now() - started) / 1000;
    state.lastMetrics = { ...(state.lastMetrics || {}), exportSeconds: elapsed, exportRate: state.duration / Math.max(0.1, elapsed), codec: label };
    els.exportStatus.textContent = `Encoded ${mb(blob.size)} MB ${label} in ${elapsed.toFixed(1)}s (${state.lastMetrics.exportRate.toFixed(2)}× realtime). ${audioStatus}`;
    const url = URL.createObjectURL(blob);
    els.download.href = url; els.download.download = `${state.name}-redacted.webm`; els.download.hidden = false;
    await verifyOutput(blob);
  } catch (err) {
    els.exportStatus.textContent = err.message;
    els.verify.textContent = "";
  } finally {
    els.video.pause(); els.cancel.hidden = true; state.busy = false; disableActions(false); drawOverlay();
  }
}

async function encodeWithMediabunny({ canvas, ctx, duration, started }) {
  const fps = clampFrameRate(state.fps);
  const frames = framePlan(duration, fps);
  const videoCodec = await chooseVideoCodec();
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality: new Quality("high"), keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps, maximumPacketCount: frames.length });

  const input = new Input({ source: new BlobSource(state.file), formats: ALL_FORMATS });
  const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
  let audioSource = null;
  let audioStatus = state.mediaInfo?.hasAudio ? "Audio could not be decoded and was not copied." : "Input had no audio track.";
  if (audioTrack && await audioTrack.canDecode().catch(() => false) && await canEncodeAudio("opus").catch(() => false)) {
    audioSource = new AudioSampleSource({ codec: "opus", quality: new Quality("high") });
    output.addAudioTrack(audioSource);
    audioStatus = "Audio preserved by re-encoding to Opus; audio content itself is not redacted.";
  }

  await output.start();
  const audioPromise = audioSource ? pipeAudio(audioTrack, audioSource, duration) : Promise.resolve();
  try {
    for (const frame of frames) {
      if (state.exportAbort) throw new Error("Export canceled");
      await seek(frame.timestamp);
      drawRedactedFrame(ctx, els.video, frame.timestamp);
      await videoSource.add(frame.timestamp, frame.duration, { keyFrame: frame.index === 0 || frame.index % Math.max(1, Math.round(fps * 2)) === 0 });
      const p = (frame.index + 1) / frames.length;
      els.bar.style.width = `${(p * 100).toFixed(1)}%`;
      const elapsed = (performance.now() - started) / 1000;
      const eta = p > 0.02 ? elapsed * (1 - p) / p : 0;
      els.exportStatus.textContent = `Encoding VP${videoCodec.slice(2)}/WebM… ${(p * 100).toFixed(0)}%${eta ? ` · ETA ${eta.toFixed(0)}s` : ""}`;
    }
    await audioPromise;
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  } finally {
    await input.dispose?.();
  }
  return { blob: new Blob([target.buffer], { type: "video/webm" }), label: `VP${videoCodec.slice(2)}/Opus WebM`, audioStatus };
}

async function pipeAudio(audioTrack, audioSource, duration) {
  const sink = new AudioSampleSink(audioTrack);
  const first = await audioTrack.getFirstTimestamp().catch(() => 0);
  for await (const sample of sink.samples(first, first + duration)) {
    const shifted = sample.timestamp - first;
    if (shifted >= duration + 0.05) { sample.close(); continue; }
    sample.setTimestamp(Math.max(0, shifted));
    await audioSource.add(sample);
    sample.close();
  }
}

function drawRedactedFrame(ctx, source, t) {
  ctx.drawImage(source, 0, 0, state.width, state.height);
  const detections = mergeBoxes(activeDetections(state.tracks, state.selected, t));
  renderRedactions(ctx, detections, state.style);
}

function renderRedactions(ctx, detections, style) {
  if (!detections.length) return;
  if (style === "black box") {
    ctx.fillStyle = "#000";
    for (const d of detections) ctx.fillRect(...rect(d.box));
    return;
  }
  const source = ctx.canvas;
  if (style === "blur" && "filter" in ctx) {
    const radius = Math.max(12, Math.min(state.width, state.height) / 40);
    for (const d of detections) {
      const [x, y, w, h] = rect(d.box);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.filter = `blur(${radius}px)`; ctx.drawImage(source, 0, 0); ctx.restore();
    }
    ctx.filter = "none";
    return;
  }
  const tmp = document.createElement("canvas"); const tctx = tmp.getContext("2d");
  const block = Math.max(8, Math.round(Math.min(state.width, state.height) / 60));
  ctx.imageSmoothingEnabled = false;
  for (const d of detections) {
    const [x, y, w, h] = rect(d.box); tmp.width = Math.max(1, Math.ceil(w / block)); tmp.height = Math.max(1, Math.ceil(h / block));
    tctx.drawImage(source, x, y, w, h, 0, 0, tmp.width, tmp.height); ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
  }
  ctx.imageSmoothingEnabled = true;
}

async function chooseVideoCodec() {
  for (const codec of ["vp9", "vp8"]) {
    if (await canEncodeVideo(codec, { width: state.width, height: state.height, quality: new Quality("high") }).catch(() => false)) return codec;
  }
  throw new Error("This browser cannot encode VP8/VP9 WebM with WebCodecs.");
}

async function verifyOutput(blob) {
  els.verify.textContent = "Verifying redacted output…"; els.verify.className = "verify";
  const video = document.createElement("video"); video.muted = true; video.src = URL.createObjectURL(blob);
  await waitLoaded(video);
  const canvas = document.createElement("canvas"); canvas.width = state.width; canvas.height = state.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const failures = [];
  const outDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : state.duration;
  const times = verificationTimes(state.duration, outDuration, state.scanTimes);
  let prevGray = null;
  let sceneFrames = 0;
  for (const t of times) {
    await new Promise((resolve) => { const done = () => { video.removeEventListener("seeked", done); resolve(); }; video.addEventListener("seeked", done, { once: true }); video.currentTime = Math.min(Math.max(0, t), Math.max(0, outDuration - 0.05)); });
    ctx.drawImage(video, 0, 0, state.width, state.height);
    const img = ctx.getImageData(0, 0, state.width, state.height);
    const gray = downscaleGray(img, 96, Math.max(1, Math.round(96 * state.height / state.width)));
    if (prevGray && isSceneChange(prevGray, gray)) sceneFrames++;
    prevGray = gray;
    const res = await scanFrame({ data: img.data, width: img.width, height: img.height }, { categories: checkedCategories(), customTerms: [], useNer: false });
    for (const d of res.detections) {
      failures.push(`${prettyLabel(d.label)} at ${fmt(t)}`);
    }
  }
  URL.revokeObjectURL(video.src);
  if (failures.length) {
    els.verify.className = "verify warn";
    els.verify.textContent = `Verification found possible readable items: ${[...new Set(failures)].join(", ")}`;
  } else {
    els.verify.className = "verify ok";
    els.verify.textContent = `✓ Verified: no sensitive items found in ${times.length} decoded output frame${times.length === 1 ? "" : "s"}${sceneFrames ? ` (${sceneFrames} scene-change frame${sceneFrames === 1 ? "" : "s"})` : ""}`;
  }
}

// ------------------------------------------------------------- controls + category UI

for (const [key, desc] of Object.entries(CATEGORIES)) {
  if (key === "codes") continue;
  const label = document.createElement("label");
  const cb = Object.assign(document.createElement("input"), { type: "checkbox", value: key, checked: DEFAULT_CATEGORIES.includes(key) && key !== "faces" });
  const dot = Object.assign(document.createElement("span"), { className: "dot" }); dot.style.background = CATEGORY_COLORS[key];
  label.append(cb, dot, Object.assign(document.createElement("span"), { textContent: desc })); els.categories.append(label);
}
els.rescan.addEventListener("click", runScan);
els.reset.addEventListener("click", () => { state.scanSeq++; cleanupUrl(); els.file.value = ""; els.workspace.hidden = true; els.drop.hidden = false; setStatus(""); });
els.selectAll.addEventListener("click", () => { state.selected = new Set(state.tracks.map((t) => t.id)); renderAll(); });
els.selectNone.addEventListener("click", () => { state.selected = new Set(); renderAll(); });
document.querySelectorAll("input[name=style]").forEach((r) => r.addEventListener("change", () => { state.style = r.value; els.styleNote.hidden = state.style === "black box"; }));
els.tabs.forEach((tab) => tab.addEventListener("click", () => showTab(tab.id)));
function showTab(id) {
  els.tabs.forEach((tab) => { const on = tab.id === id; tab.setAttribute("aria-selected", on); document.getElementById(tab.getAttribute("aria-controls")).hidden = !on; });
}
function checkedCategories() { return [...els.categories.querySelectorAll("input:checked")].map((i) => i.value); }
function disableActions(disabled) { [els.rescan, els.exportBtn, els.reset, els.file].forEach((b) => { b.disabled = disabled; }); }
function setStatus(text, kind = "") { els.status.textContent = text; els.status.dataset.kind = kind; }
function setEngine(text, kind = "") { els.engine.textContent = text; els.engine.dataset.kind = kind; }
function cleanupUrl() { if (state.url) URL.revokeObjectURL(state.url); state.url = null; els.video.removeAttribute("src"); els.video.load(); }
function rect(box) { const x = Math.floor(box.x0), y = Math.floor(box.y0); return [x, y, Math.ceil(box.x1) - x, Math.ceil(box.y1) - y]; }
function fmt(s) { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = Math.floor(s % 60), ds = Math.floor((s % 1) * 10); return `${m}:${String(r).padStart(2, "0")}.${ds}`; }
function mb(b) { return (b / 1048576).toFixed(1); }




globalThis.__videoRedactorLoadFile = loadFile;
