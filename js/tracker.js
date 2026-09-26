export const HOLD_MARGIN = 0.8;
export const DEFAULT_SAMPLE_INTERVAL = 0.25;

export function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  return inter / Math.max(1, areaA + areaB - inter);
}

export function expandBox(box, pad = 3) {
  return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
}

export function moveBox(box, shift = { dx: 0, dy: 0 }) {
  return { x0: box.x0 + shift.dx, y0: box.y0 + shift.dy, x1: box.x1 + shift.dx, y1: box.y1 + shift.dy };
}

export function textSimilarity(a = "", b = "") {
  const x = normalizeText(a), y = normalizeText(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s) => {
    if (s.length <= 2) return new Set([s]);
    const out = new Set();
    for (let i = 0; i <= s.length - 2; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = grams(x), B = grams(y);
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / Math.max(1, A.size + B.size - hit);
}

const normalizeText = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);

export function buildTracks(samples, { margin = HOLD_MARGIN, iouThreshold = 0.25 } = {}) {
  const tracks = [];
  let nextId = 1;
  for (const sample of samples) {
    const used = new Set();
    for (const raw of sample.detections || []) {
      if (!raw?.box) continue;
      const det = { ...raw, box: expandBox(raw.box, 4) };
      let best = null;
      for (const tr of tracks) {
        if (used.has(tr.id) || tr.category !== det.category || tr.label !== det.label) continue;
        const last = tr.frames.at(-1);
        const shifted = moveBox(last.box, sample.shift || { dx: 0, dy: 0 });
        const score = iou(shifted, det.box) + 0.35 * textSimilarity(tr.text, det.text);
        if (score >= iouThreshold && (!best || score > best.score)) best = { tr, score };
      }
      if (best) {
        best.tr.frames.push({ t: sample.t, box: det.box });
        best.tr.last = sample.t;
        if (!best.tr.text && det.text) best.tr.text = det.text;
        used.add(best.tr.id);
      } else {
        tracks.push({ id: nextId++, label: det.label || "MANUAL", category: det.category || "custom", text: det.text || "", source: det.source || "scan", first: sample.t, last: sample.t, frames: [{ t: sample.t, box: det.box }] });
      }
    }
  }
  for (const tr of tracks) {
    tr.frames.sort((a, b) => a.t - b.t);
    tr.start = Math.max(0, tr.first - margin);
    tr.end = tr.last + margin;
  }
  return mergeTracks(tracks);
}

export function mergeTracks(tracks) {
  const out = [];
  for (const tr of tracks) {
    const prev = out.find((x) => x.category === tr.category && x.label === tr.label && textSimilarity(x.text, tr.text) > 0.88 && rangesTouch(x, tr) && iou(boxAt(x, tr.start), boxAt(tr, tr.start)) > 0.2);
    if (!prev) { out.push({ ...tr }); continue; }
    prev.frames = [...prev.frames, ...tr.frames].sort((a, b) => a.t - b.t);
    prev.start = Math.min(prev.start, tr.start);
    prev.end = Math.max(prev.end, tr.end);
    prev.first = Math.min(prev.first, tr.first);
    prev.last = Math.max(prev.last, tr.last);
  }
  return out.map((t, i) => ({ ...t, id: i + 1 }));
}

const rangesTouch = (a, b) => Math.max(a.start, b.start) <= Math.min(a.end, b.end) + 0.55;

export function boxAt(track, t) {
  const frames = track.frames || [];
  if (!frames.length) return track.box;
  if (t <= frames[0].t) return frames[0].box;
  if (t >= frames.at(-1).t) return frames.at(-1).box;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (t <= b.t) {
      const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return {
        x0: lerp(a.box.x0, b.box.x0, p), y0: lerp(a.box.y0, b.box.y0, p),
        x1: lerp(a.box.x1, b.box.x1, p), y1: lerp(a.box.y1, b.box.y1, p),
      };
    }
  }
  return frames.at(-1).box;
}

export function activeDetections(tracks, selected, t) {
  return tracks.filter((tr) => (!selected || selected.has(tr.id)) && t >= tr.start && t <= tr.end).map((tr) => ({ ...tr, box: boxAt(tr, t) }));
}

export function downscaleGray(image, outW = 96, outH = 54) {
  const { data, width, height } = image;
  const gray = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const sy0 = Math.floor(y * height / outH), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * height / outH));
    for (let x = 0; x < outW; x++) {
      const sx0 = Math.floor(x * width / outW), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * width / outW));
      let sum = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        const i = (yy * width + xx) * 4;
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        n++;
      }
      gray[y * outW + x] = sum / Math.max(1, n);
    }
  }
  return { gray, width: outW, height: outH };
}

export function frameDifference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.gray.length; i++) sum += Math.abs(a.gray[i] - b.gray[i]);
  return sum / Math.max(1, a.gray.length) / 255;
}

export function isSceneChange(prev, curr, threshold = 0.12) {
  return frameDifference(prev, curr) >= threshold;
}

export function estimateShift(prev, curr, maxShift = 8) {
  let best = { dx: 0, dy: 0, score: Infinity };
  const w = prev.width, h = prev.height;
  for (let dy = -maxShift; dy <= maxShift; dy++) for (let dx = -maxShift; dx <= maxShift; dx++) {
    let err = 0, n = 0;
    for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y += 2) {
      for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x += 2) {
        err += Math.abs(prev.gray[y * w + x] - curr.gray[(y + dy) * w + (x + dx)]);
        n++;
      }
    }
    const score = err / Math.max(1, n);
    if (score < best.score) best = { dx, dy, score };
  }
  return best;
}

export function sampleTimes(duration, every = DEFAULT_SAMPLE_INTERVAL) {
  const times = [0];
  for (let t = every; t < duration - 0.05; t += every) times.push(Number(t.toFixed(3)));
  if (duration > 0.1) times.push(Math.max(0, duration - 0.05));
  return [...new Set(times)];
}

export function framePlan(duration, fps = 30) {
  const rate = clampFrameRate(fps);
  const total = Math.max(1, Math.round(Math.max(0.001, duration) * rate));
  const step = 1 / rate;
  return Array.from({ length: total }, (_, i) => {
    const timestamp = Number((i * step).toFixed(6));
    const remaining = Math.max(0.001, duration - timestamp);
    return { index: i, timestamp, duration: Number(Math.min(step, remaining).toFixed(6)) };
  });
}

export function verificationTimes(inputDuration, outputDuration = inputDuration, sampledTimes = [], every = DEFAULT_SAMPLE_INTERVAL) {
  const outDuration = Math.max(0.001, outputDuration || inputDuration || 0.001);
  const scale = outDuration / Math.max(0.001, inputDuration || outDuration);
  const times = [
    ...sampleTimes(outDuration, every),
    ...sampledTimes.map((t) => Math.min(Math.max(0, t * scale), Math.max(0, outDuration - 0.05))),
  ];
  return [...new Set(times.map((t) => Number(t.toFixed(3))))].sort((a, b) => a - b);
}

export function clampFrameRate(fps) {
  return Math.min(120, Math.max(1, Number.isFinite(fps) && fps > 0 ? fps : 30));
}

export function mergeBoxes(boxes, threshold = 0.65) {
  const out = [];
  for (const d of boxes) {
    const hit = out.find((x) => x.category === d.category && iou(x.box, d.box) > threshold);
    if (!hit) out.push({ ...d });
    else hit.box = { x0: Math.min(hit.box.x0, d.box.x0), y0: Math.min(hit.box.y0, d.box.y0), x1: Math.max(hit.box.x1, d.box.x1), y1: Math.max(hit.box.y1, d.box.y1) };
  }
  return out;
}

const lerp = (a, b, p) => a + (b - a) * p;
