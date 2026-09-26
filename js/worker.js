import * as ort from "../vendor/ort/ort.wasm.min.mjs";
import { configureOrt, createEngineCache } from "../vendor/core/engines.js";
import { scan } from "../vendor/core/pipeline.js";
import { ALL_FORMATS, BlobSource, Input } from "../vendor/mediabunny.mjs";

const BASE = new URL("../", import.meta.url);
const WASM_PATH = new URL("vendor/ort/", BASE).href;
configureOrt(ort, WASM_PATH);

const post = (msg) => self.postMessage(msg);
const cache = createEngineCache({
  ort,
  base: BASE,
  wasmPath: WASM_PATH,
  importTransformers: () => import("../vendor/transformers.web.min.js"),
  onProgress: ({ label, loaded, total }) => post({ type: "download", label, loaded, total }),
});
const pendingNerFailure = { warned: false };

async function enginesFor(options) {
  const engines = { ocr: await cache.ocr() };
  if (options.categories?.includes("faces")) engines.faces = await cache.faces();
  if (options.useNer) {
    try { engines.ner = await cache.ner(); }
    catch (err) {
      if (!pendingNerFailure.warned) post({ type: "warning", text: `Name/address model unavailable (${err.message}); using rules only.` });
      pendingNerFailure.warned = true;
    }
  }
  return engines;
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === "warmup") {
      await cache.ocr();
      post({ type: "ready", part: "ocr", mediabunny: true });
      return;
    }
    if (msg.type === "probe") {
      const input = new Input({ source: new BlobSource(msg.file), formats: ALL_FORMATS });
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      const frameRate = video ? await video.computeFrameRateMetrics({ targetPacketCount: 256 }).then((m) => m.bestGuessFrameRate).catch(() => null) : null;
      const info = {
        duration: await input.computeDuration().catch(() => null),
        width: video ? await video.getDisplayWidth().catch(() => null) : null,
        height: video ? await video.getDisplayHeight().catch(() => null) : null,
        frameRate,
        videoCodec: video ? await video.getCodec().catch(() => "unknown") : null,
        audioCodec: audio ? await audio.getCodec().catch(() => null) : null,
        hasAudio: Boolean(audio),
      };
      await input.dispose?.();
      post({ type: "probe-result", id: msg.id, info });
      return;
    }
    if (msg.type === "scan") {
      const engines = await enginesFor(msg.options);
      const result = await scan(msg.image, engines, { ...msg.options, onProgress: (text) => post({ type: "progress", id: msg.id, text }) });
      post({ type: "scan-result", id: msg.id, detections: result.detections, timings: result.timings, lines: result.lines.length });
    }
  } catch (err) {
    post({ type: "error", id: msg.id, text: err?.message || String(err) });
  }
};
