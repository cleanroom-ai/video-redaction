import assert from "node:assert/strict";
import { test } from "node:test";
import { activeDetections, boxAt, buildTracks, downscaleGray, estimateShift, frameDifference, iou, isSceneChange, mergeBoxes, sampleTimes, textSimilarity } from "../js/tracker.js";

const det = (t, x, y, text = ["sk", "proj"].join("-") + "-abc") => ({ t, detections: [{ category: "secrets", label: "AI_API_KEY", text, source: "rule", box: { x0: x, y0: y, x1: x + 100, y1: y + 24 } }] });

test("IoU association keeps one static text track with hold margins", () => {
  const tracks = buildTracks([det(0.5, 100, 80), det(1.0, 102, 81), det(1.5, 101, 80)]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].frames.length, 3);
  assert.equal(tracks[0].start, 0);
  assert.equal(tracks[0].end, 2.3);
  assert.ok(iou(tracks[0].frames[0].box, tracks[0].frames[1].box) > 0.8);
});

test("same label and similar text associates despite OCR punctuation drift", () => {
  assert.ok(textSimilarity("Nikhil Kulkarni", "Nikhil Kulkami") > 0.65);
  const tracks = buildTracks([det(0, 50, 50, "Nikhil Kulkarni"), det(0.5, 53, 52, "Nikhil Kulkami")]);
  assert.equal(tracks.length, 1);
});

test("interpolation returns a linear face position between samples", () => {
  const tr = { start: 0, end: 1, frames: [{ t: 0, box: { x0: 0, y0: 0, x1: 10, y1: 10 } }, { t: 1, box: { x0: 10, y0: 20, x1: 20, y1: 30 } }] };
  assert.deepEqual(boxAt(tr, 0.5), { x0: 5, y0: 10, x1: 15, y1: 20 });
});

test("scroll-shift estimation recovers a synthetic image translation", () => {
  const w = 48, h = 32;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  const rgba2 = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 8; y < 18; y++) for (let x = 10; x < 26; x++) {
    let i = (y * w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; rgba[i + 3] = 255;
    i = ((y + 4) * w + (x + 3)) * 4; rgba2[i] = rgba2[i + 1] = rgba2[i + 2] = 0; rgba2[i + 3] = 255;
  }
  const a = downscaleGray({ data: rgba, width: w, height: h }, w, h);
  const b = downscaleGray({ data: rgba2, width: w, height: h }, w, h);
  const s = estimateShift(a, b, 6);
  assert.deepEqual({ dx: s.dx, dy: s.dy }, { dx: 3, dy: 4 });
});

test("scene-change detector separates small edits from page changes", () => {
  const base = { gray: new Float32Array(100).fill(100), width: 10, height: 10 };
  const small = { gray: Float32Array.from(base.gray, (v, i) => i < 2 ? 160 : v), width: 10, height: 10 };
  const big = { gray: new Float32Array(100).fill(230), width: 10, height: 10 };
  assert.ok(frameDifference(base, small) < 0.02);
  assert.equal(isSceneChange(base, small), false);
  assert.equal(isSceneChange(base, big), true);
});

test("time-range filtering and box merging return active redactions only", () => {
  const tracks = [
    { id: 1, start: 0, end: 2, category: "secrets", label: "A", frames: [{ t: 0, box: { x0: 0, y0: 0, x1: 10, y1: 10 } }] },
    { id: 2, start: 3, end: 4, category: "contact", label: "B", frames: [{ t: 3, box: { x0: 50, y0: 0, x1: 60, y1: 10 } }] },
  ];
  assert.deepEqual(activeDetections(tracks, new Set([1, 2]), 1).map((d) => d.id), [1]);
  const merged = mergeBoxes([
    { category: "secrets", box: { x0: 0, y0: 0, x1: 10, y1: 10 } },
    { category: "secrets", box: { x0: 1, y0: 1, x1: 11, y1: 11 } },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(sampleTimes(1.1, 0.5).at(-1), 1.05);
});

