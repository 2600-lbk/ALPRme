# ALPRme

On-device license plate detection and OCR for dash camera use. All inference runs
locally — the camera feed, plate reads, and location data never leave your device
unless you explicitly export them.

## Goals

- Detect license plates from a dash-mounted phone camera using on-device ONNX
  neural network inference
- Read plate text via a two-stage pipeline: YOLOv9-t detection + CCT
  (Convolutional Character Transformer) OCR
- Record detections with time, GPS location, compass heading, altitude, and speed
- Store everything locally in IndexedDB
- Review sessions on a map with filtering and export to GeoJSON / CSV
- Run fully offline as a PWA after the first online launch

## Platform targets

| Platform | Status |
|----------|--------|
| Android Chrome 119+ | Primary |
| iOS Safari 17+ | Supported |
| Desktop Chromium | Development and testing |

## Quick start

```bash
npm install
npm run dev
```

For HTTPS (required for camera access on mobile):

```bash
bash scripts/gen-certs.sh
npm run dev:share
```

Open the HTTPS URL on your phone. The first launch walks you through permissions
and model selection. After that, you're on the capture screen.

## Model files

ONNX model files are checked into `public/models/` — no download step is needed
on a fresh clone. See [Setup](SETUP.md#model-files) for details on re-fetching
from the reference Python libraries.

## Documentation

- **[Architecture](ARCHITECTURE.md)** — codebase map, composable layer, storage, PWA, sensors
- **[Camera Pipeline](CAMERA_PIPELINE.md)** — profiles, tiling, capture modes, FPS/TPS
- **[Filtering Pipeline](FILTERING_PIPELINE.md)** — prefilter → stabilizer → motion → dedup
- **[Settings](SETTINGS.md)** — every setting that affects capture and recording
- **[Testing](TESTING.md)** — fixture setup, single-model parity, cross-model evaluation
- **[Evaluation](EVALUATION.md)** — adding custom test images, running evaluations
- **[Tiling Analysis](TILING_ANALYSIS.md)** — model combo performance, strategy recommendations
- **[Setup](SETUP.md)** — iOS HTTPS certs, dev server, troubleshooting, model re-fetch
