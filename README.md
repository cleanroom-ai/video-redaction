---
title: Video Redactor
emoji: 🎬
colorFrom: pink
colorTo: gray
sdk: static
app_file: index.html
pinned: true
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

[![CI](https://github.com/cleanroom-ai/video-redaction/actions/workflows/ci.yml/badge.svg)](https://github.com/cleanroom-ai/video-redaction/actions/workflows/ci.yml)
[Open the Hugging Face demo](https://huggingface.co/spaces/cleanroom-ai/video-redaction)

**Hide keys, names & faces in screen recordings — in your browser.**

Video Redactor is a 100% client-side cleanroom-ai app for developers and PMs who need to share demos, bug repros, tutorials, and screen recordings without leaking secrets or personal information.

## Features

- Drop MP4/WebM or try the bundled synthetic example (fake data only).
- Uses the shared [`@cleanroom-ai/core`](https://github.com/cleanroom-ai/cleanroom-core) OCR/rules/name/face engine.
- Samples every ~0.25s, OCRs every sampled frame, and tracks boxes between samples with IoU, text similarity, scroll-shift estimation, and face interpolation.
- Review numbered boxes over the video, timeline bars, per-track checkboxes, masked previews, and manual boxes.
- Exports a redacted WebM in-browser with Mediabunny/WebCodecs, preserves the input audio track by re-encoding it to Opus, and verifies decoded output frames with OCR/rules.
- Strict CSP: only this origin plus Hugging Face's `*.hf.co` large-file CDN; no analytics, external fonts, uploads, or server processing.

## How it works

```text
video ─► browser decode + Mediabunny container probe
      ├► sampled frames + scene-change/frame-diff cues
      ├► @cleanroom-ai/core OCR/rules/names/faces in a Worker
      ├► tracker: IoU + text similarity + scroll shift + interpolation
      ├► review UI + manual boxes
      └► canvas burn-in WebM export + Opus audio ─► dense OCR verification on decoded output
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

- Sampling can still miss text visible between dense OCR samples; scene-change/frame-diff cues help but cannot guarantee every transient frame.
- Browser support for WebCodecs codecs varies. The app exports VP8/VP9 WebM when the browser can encode it.
- Audio is preserved but **not redacted**; use the cleanroom-ai Audio Redactor before sharing recordings with spoken secrets or personal information.
- Always review: OCR can miss tiny, blurry, stylized, or heavily animated text.

<!-- cleanroom-ai:family:start -->
## Part of cleanroom-ai

**Clean it before you share it.** Six free privacy tools built on one shared engine. Every model runs
in your browser, so nothing you open is ever uploaded.

| | Tool | Cleans | Demo | Code |
|---|---|---|---|---|
| 🕶️ | **Screenshot Redactor** | API keys, passwords, emails, card numbers, names, faces & QR codes in screenshots | [▶ Try it](https://huggingface.co/spaces/cleanroom-ai/pii-privacy-redaction) | [GitHub](https://github.com/cleanroom-ai/screenshot-redactor) |
| 🧽 | **Log Scrubber** | tokens, cookies, passwords & PII in logs, `.env`, JSON and HAR files | [▶ Try it](https://huggingface.co/spaces/cleanroom-ai/log-secret-scrubber) | [GitHub](https://github.com/cleanroom-ai/log-secret-scrubber) |
| 📄 | **PDF Redactor** | PII & secrets in PDFs, flattened and verified so no text survives | [▶ Try it](https://huggingface.co/spaces/cleanroom-ai/pdf-redaction) | [GitHub](https://github.com/cleanroom-ai/pdf-redaction) |
| 🔊 | **Audio Redactor** | bleeps names, phone & card numbers and secrets in recordings | [▶ Try it](https://huggingface.co/spaces/cleanroom-ai/audio-pii-redaction) | [GitHub](https://github.com/cleanroom-ai/audio-pii-redaction) |
| 📷 | **Photo Share-Safe** | GPS & hidden EXIF metadata; blurs faces and license plates | [▶ Try it](https://huggingface.co/spaces/cleanroom-ai/photo-exif-privacy) | [GitHub](https://github.com/cleanroom-ai/photo-exif-privacy) |
| 🎬 | **Video Redactor** 📍 *you are here* | keys, names, emails & faces tracked through screen recordings | [▶ Try it](https://huggingface.co/spaces/cleanroom-ai/video-redaction) | [GitHub](https://github.com/cleanroom-ai/video-redaction) |
| ⚙️ | **@cleanroom-ai/core** | the shared on-device engine: OCR, secret/PII rules, NER, face detection | — | [GitHub](https://github.com/cleanroom-ai/cleanroom-core) |

All tools: [Hugging Face](https://huggingface.co/cleanroom-ai) · [GitHub](https://github.com/cleanroom-ai)
<!-- cleanroom-ai:family:end -->

## Author

Built by **Parag Sawant** ([@paragpsawant](https://github.com/paragpsawant) · [parags.dev](https://parags.dev) · [LinkedIn](https://www.linkedin.com/in/paragsawant/)).

## Credits & licenses

Apache-2.0 app code. Uses `@cleanroom-ai/core` (Apache-2.0), PP-OCRv6, YuNet, ONNX Runtime Web, transformers.js, and **Mediabunny 1.58.0** (MPL-2.0). Vendored license texts are written to `licenses/` by `npm run vendor`; model licenses are in `models/LICENSES/`.
