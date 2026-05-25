# Settings

All settings are persisted in IndexedDB under the `prefs` table. They survive
app restarts and PWA updates.

## Models

### Detector (Stage 1)

| Model | Input | Size | Description |
|-------|-------|------|-------------|
| YOLOv9-t 256 | 256×256 | 7.4 MB | Fastest. Best battery life. May miss small or distant plates. |
| YOLOv9-t 384 | 384×384 | 7.4 MB | **Default.** Good balance of speed and accuracy for mobile. |
| YOLOv9-t 512 | 512×512 | 7.4 MB | Highest accuracy. Noticeably slower. Best for stationary use. |

### OCR (Stage 2)

| Model | Input | Size | Description |
|-------|-------|------|-------------|
| CCT XS v2 | 128×64 | 3.2 MB | **Default.** Fastest OCR. Global Latin alphabet. 66-country region recognition. |
| CCT S v2 | 128×64 | 5.0 MB | Higher accuracy OCR. Same alphabet and region support. |

You must stop inference before changing models. The Settings tab shows a
warning and disables model cards while the inference loop is running.
After switching, the ONNX session reinitializes in the background and
inference resumes automatically.

## Target FPS

Slider from 1 to 15. Controls how many frames per second the inference loop
attempts to process. Higher values consume more CPU/GPU and battery.

The actual achieved FPS depends on model size, tile count, and device
capability. The performance dot in the status bar shows how close you are
to target: green (≥90%), yellow (50-90%), red (<50%).

## Filter presets

| Preset | Behavior |
|--------|----------|
| Conservative | Few false logs, may miss low-quality reads |
| Balanced | Recommended default |
| Permissive | Log more; risk of duplicates |
| Log All | No filtering — every detection is recorded |

Selecting a preset overwrites all prefilter and stabilizer parameters.
You can then fine-tune individual thresholds in the Advanced section.

## Advanced thresholds

These override the preset values. Tune them when a preset is close but not
quite right for your use case:

- **Detector confidence** — minimum YOLO confidence for a bbox to count
- **OCR confidence** — minimum mean character confidence for a plate read
- **Weakest-char confidence** — minimum single-character confidence
- **Min bbox area** — smallest bounding box (in pixels) to consider
- **Min / max plate length** — character count range for valid plates

## Stabilizer (K-of-N)

The stabilizer requires K out of the last N reads to agree before emitting
a detection. This prevents single-frame OCR glitches:

- **K frames to confirm** — how many agreeing reads are needed
- **N window frames** — how many recent reads to consider
- **Window (ms)** — time span for the sliding window
- **Fuzzy plate distance** — maximum Levenshtein edit distance for two reads
  to be considered "the same plate"

## Deduplication

Prevents the same physical plate from being recorded multiple times within
a short period:

- **Time window (s)** — same plate within this window is the same sighting
- **Geo radius (m)** — same plate within this distance is the same sighting
- **Speed-aware radius** — when ON, the geo radius scales with vehicle speed
  (faster driving = larger acceptable radius)

## Inference backend

The app detects WebGPU availability at startup and prefers it over WASM when
available. The current backend is shown in the status bar (WASM or WEBGPU).
There is no manual backend selection — it's automatic.
