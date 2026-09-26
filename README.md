---
title: Video Redactor
emoji: 🎬
colorFrom: gray
colorTo: indigo
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
short_description: "Redact keys, names & faces in screen recordings"
thumbnail: https://huggingface.co/spaces/cleanroom-ai/video-redaction/resolve/main/assets/social-preview.png
models:
  - onnx-community/bert-small-pii-detection-ONNX
  - gravitee-io/bert-small-pii-detection
  - PaddlePaddle/PP-OCRv6_tiny_det
  - PaddlePaddle/PP-OCRv6_tiny_rec
  - opencv/face_detection_yunet
tags:
  - video
  - video-redaction
  - screen-recording
  - redaction
  - privacy
  - pii
  - pii-detection
  - face-blur
  - anonymization
  - secrets-detection
  - gdpr
  - ocr
  - onnx
  - webcodecs
  - in-browser
---

# 🎬 Video Redactor

<p align="center"><img src="assets/icon.svg" width="112" height="112" alt="Video Redactor logo"></p>

[![CI](https://github.com/paragpsawant/video-redaction/actions/workflows/ci.yml/badge.svg)](https://github.com/paragpsawant/video-redaction/actions/workflows/ci.yml)
[Open the Hugging Face demo](https://huggingface.co/spaces/cleanroom-ai/video-redaction)

**Hide keys, names & faces in screen recordings — in your browser.**

Video Redactor is a 100% client-side cleanroom-ai app for developers and PMs who need to share demos, bug repros, tutorials, and screen recordings without leaking secrets or personal information.

## Features

- Drop MP4/WebM or try the bundled synthetic example (fake data only).
- Uses the shared [`@cleanroom-ai/core`](https://github.com/paragpsawant/cleanroom-core) OCR/rules/name/face engine.
- Samples every ~0.5s and tracks boxes between samples with IoU, text similarity, scroll-shift estimation, and face interpolation.
- Review numbered boxes over the video, timeline bars, per-track checkboxes, masked previews, and manual boxes.
- Exports a redacted WebM/MP4 candidate in-browser and verifies sampled output frames with OCR/rules.
- Strict CSP: only this origin plus Hugging Face's `*.hf.co` large-file CDN; no analytics, external fonts, uploads, or server processing.

## How it works

```text
video ─► browser decode + Mediabunny container probe
      ├► sampled frames + scene-change/frame-diff cues
      ├► @cleanroom-ai/core OCR/rules/names/faces in a Worker
      ├► tracker: IoU + text similarity + scroll shift + interpolation
      ├► review UI + manual boxes
      └► canvas burn-in export ─► OCR verification on output samples
```

Blur and pixelation are offered for demos, but **black boxes are the safe default for text**.

## Run locally

```bash
npm ci
npm run vendor
npm run examples   # optional: regenerate examples/fake-screen.webm and .mp4
npm test
npm run serve
```

Then open the printed local URL. Set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` when installing on machines that may try to fetch CUDA packages.

## CI/CD

- `.github/workflows/ci.yml` runs unit/integration tests, vendors the runtime, installs ffmpeg, and runs a real-browser no-upload E2E test.
- `.github/workflows/deploy-space.yml` uploads the static app to `cleanroom-ai/video-redaction` only when `HF_TOKEN` is configured.

## Limitations

- Sampling can miss text visible for less than ~0.5s; scene-change sampling mitigates bursts but cannot guarantee every transient frame.
- Browser support for WebCodecs/MediaRecorder codecs varies. The app falls back to VP8/VP9 WebM when H.264/MP4 recording is unavailable.
- The current safe fallback exporter drops audio rather than risking unsynchronized or decoded audio; the UI tells you when that happens.
- Always review: OCR can miss tiny, blurry, stylized, or heavily animated text.

## Author

Built by **Parag Sawant** ([@paragpsawant](https://github.com/paragpsawant) · [parags.dev](https://parags.dev) · [LinkedIn](https://www.linkedin.com/in/paragsawant/)).

## Credits & licenses

Apache-2.0 app code. Uses `@cleanroom-ai/core` (Apache-2.0), PP-OCRv6, YuNet, ONNX Runtime Web, transformers.js, and **Mediabunny 1.58.0** (MPL-2.0). Vendored license texts are written to `licenses/` by `npm run vendor`; model licenses are in `models/LICENSES/`.
