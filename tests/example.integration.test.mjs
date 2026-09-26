import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";
import * as ort from "onnxruntime-node";
import { OCR } from "@cleanroom-ai/core/src/ocr.js";
import { scan } from "@cleanroom-ai/core/src/pipeline.js";
import { readPng } from "@cleanroom-ai/core/testing/png.mjs";

const root = process.cwd();
const cache = join(root, ".cache", "tests");
const example = join(root, "examples", "fake-screen.webm");
const ffmpegOk = () => spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
let engines;

before(async () => {
  if (!ffmpegOk() || !existsSync(example)) return;
  const models = join(root, "node_modules", "@cleanroom-ai", "core", "models");
  const loadBytes = async (f) => readFileSync(join(models, f));
  const loadJson = async (f) => JSON.parse(readFileSync(join(models, f), "utf8"));
  engines = { ocr: await OCR.create(ort, loadBytes, loadJson, { executionProviders: ["cpu"] }) };
});

test("example video frames decode with ffmpeg and shared scan finds planted fake PII", { timeout: 180_000, skip: !ffmpegOk() ? "ffmpeg is not installed" : false }, async (t) => {
  if (!existsSync(example)) t.skip("example video has not been generated");
  mkdirSync(cache, { recursive: true });
  const frames = ["2.8", "4.8", "8.4"].map((ts, i) => join(cache, `example-${i}.png`));
  for (let i = 0; i < frames.length; i++) {
    const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", ["2.8", "4.8", "8.4"][i], "-i", example, "-frames:v", "1", frames[i]], { stdio: "inherit" });
    assert.equal(r.status, 0, "ffmpeg extracted a frame");
  }
  const labels = new Set();
  const texts = [];
  for (const f of frames) {
    const res = await scan(readPng(f), engines, { categories: ["secrets", "contact", "person"], customTerms: [], useNer: false });
    for (const d of res.detections) { labels.add(d.label); texts.push(d.text); }
  }
  for (const expected of ["AI_API_KEY", "AWS_ACCESS_KEY", "EMAIL", "PHONE", "PERSON"]) {
    assert.ok(labels.has(expected), `missing ${expected}; got ${[...labels]} texts=${JSON.stringify(texts)}`);
  }
});

