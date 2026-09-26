import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as ort from "onnxruntime-node";
import { OCR } from "@cleanroom-ai/core/src/ocr.js";
import { scan } from "@cleanroom-ai/core/src/pipeline.js";
import { openApp } from "@cleanroom-ai/core/testing/browser.mjs";
import { readPng } from "@cleanroom-ai/core/testing/png.mjs";

const base = process.argv[2] || "http://127.0.0.1:8090/";
const root = process.cwd();
const shotsDir = join(root, ".cache", "e2e");
const fakeOpenAiPrefix = ["sk", "proj"].join("-");
const fakeAwsKey = "AK" + "IAIOSFODNN7EXAMPLE";
const fakeEmail = "nikhil.kulkarni@example.test";
mkdirSync(shotsDir, { recursive: true });

let app;
let finished = false;
try {
  app = await openApp(base, { shotsDir });
  const { page, shot, assertLogo, finish } = app;

  await page.locator("#engine[data-kind=ok]").waitFor({ timeout: 180_000 });
  await assertLogo();
  console.log(`engine ready in ${app.elapsed()}s`);
  await page.evaluate(async () => {
    const res = await fetch("examples/fake-screen.webm");
    const blob = await res.blob();
    globalThis.__videoRedactorLoadFile(new File([blob], "fake-screen.webm", { type: "video/webm" }));
  });
  await page.locator("#status[data-kind=ok], #status[data-kind=warn]").waitFor({ timeout: 240_000 });
  const scanStatus = await page.locator("#status").innerText();
  const items = await page.locator("#tracks li .name").allInnerTexts();
  console.log(`scan: ${scanStatus}`);
  console.log(`tracks: ${items.join(" | ")}`);
  for (const label of ["AI API Key", "AWS Access Key", "Email", "Phone", "Person"]) {
    assert.ok(items.some((i) => i.includes(label)), `missing ${label}`);
  }
  await shot("tracks");

  await page.getByLabel("Pixelate").check();
  assert.ok(await page.locator("#style-note").isVisible(), "unsafe style warning appears");
  await page.getByLabel("Black box").check();
  await page.getByRole("tab", { name: "Preview & review" }).click();
  const box = await page.locator("#overlay").boundingBox();
  await page.mouse.move(box.x + box.width * 0.70, box.y + box.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.83, box.y + box.height * 0.82, { steps: 4 });
  await page.mouse.up();
  assert.ok((await page.locator("#tracks li .name").allInnerTexts()).some((t) => t.includes("Your box")), "manual box added");

  await page.getByRole("button", { name: "Export redacted video" }).click({ force: true });
  await page.locator("#verify").filter({ hasText: /Verified|Verification found/ }).waitFor({ timeout: 300_000 });
  const exportStatus = await page.locator("#export-status").innerText();
  const verify = await page.locator("#verify").innerText();
  console.log(`export: ${exportStatus}`);
  console.log(`verify: ${verify}`);
  await shot("exported");

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
  const outPath = join(shotsDir, download.suggestedFilename());
  await download.saveAs(outPath);
  console.log(`download: ${download.suggestedFilename()}`);
  assert.match(download.suggestedFilename(), /-redacted\.(webm|mp4)$/);

  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
    const frame = join(shotsDir, "redacted-check.png");
    const ff = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.2", "-i", outPath, "-frames:v", "1", frame], { stdio: "inherit" });
    assert.equal(ff.status, 0, "ffmpeg extracted redacted output frame");
    const models = join(root, "node_modules", "@cleanroom-ai", "core", "models");
    const loadBytes = async (f) => readFileSync(join(models, f));
    const loadJson = async (f) => JSON.parse(readFileSync(join(models, f), "utf8"));
    const engines = { ocr: await OCR.create(ort, loadBytes, loadJson, { executionProviders: ["cpu"] }) };
    const res = await scan(readPng(frame), engines, { categories: ["secrets", "contact", "person"], customTerms: [], useNer: false });
    const readable = res.detections.map((d) => d.text).join("\n");
    assert.ok(!readable.toLowerCase().includes(fakeOpenAiPrefix), `redacted output still readable: ${readable}`);
    assert.ok(!readable.includes(fakeAwsKey), `redacted output still readable: ${readable}`);
    assert.ok(!readable.toLowerCase().includes(fakeEmail), `redacted output still readable: ${readable}`);
    console.log("node verify: ffmpeg frame OCR contains no fake key/email");

    const audioIn = join(shotsDir, "audio-fixture.mp4");
    const made = spawnSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=white:s=640x360:r=30:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=2",
      "-vf", "drawtext=text='vid-audio@example.test':x=80:y=160:fontsize=36:fontcolor=black:box=1:boxcolor=white",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", audioIn,
    ], { stdio: "inherit" });
    assert.equal(made.status, 0, "ffmpeg generated audio/video fixture");
    await page.locator("#reset").click();
    await page.locator("#file").setInputFiles(audioIn);
    await page.locator("#status[data-kind=ok], #status[data-kind=warn]").waitFor({ timeout: 240_000 });
    assert.ok((await page.locator("#tracks li .name").allInnerTexts()).some((t) => t.includes("Email")), "audio fixture email detected");
    await page.getByRole("button", { name: "Export redacted video" }).click({ force: true });
    await page.locator("#verify").filter({ hasText: "Verified" }).waitFor({ timeout: 300_000 });
    const [audioDownload] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
    const audioOut = join(shotsDir, `audio-${audioDownload.suggestedFilename()}`);
    await audioDownload.saveAs(audioOut);
    const meta = ffprobe(audioOut);
    assert.ok(meta.streams.some((s) => s.codec_type === "audio"), "redacted export keeps an audio stream");
    assert.ok(Math.abs(Number(meta.format.duration) - 2) < 0.15, `export duration stayed near input: ${meta.format.duration}`);
    const rate = meta.streams.find((s) => s.codec_type === "video")?.avg_frame_rate || "0/1";
    const [num, den] = rate.split("/").map(Number);
    assert.ok(Math.abs(num / den - 30) <= 1, `export frame rate stayed near 30fps: ${rate}`);
    console.log("node verify: audio export keeps audio stream and timing");
  }
  await finish();
  finished = true;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (app?.browser && !finished) {
    await Promise.race([app.browser.close(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
  }
  process.exit(process.exitCode || 0);
}

function ffprobe(path) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
