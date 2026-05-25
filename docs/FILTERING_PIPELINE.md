# Filtering Pipeline

Every detection from the inference loop passes through a four-stage filtering
pipeline before it reaches the database. The pipeline runs inside
`useSession.record()` and decides whether to store, update, or discard each
detection.

## Stages

### Stage 1 — Prefilter (stateless)

Cheap, stateless rejects. A detection is dropped if any of these fail:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `minDetectorConfidence` | 0.3 | Minimum YOLO detector confidence |
| `minOcrConfidence` | 0.5 | Minimum mean OCR character confidence |
| `minCharConfidence` | 0.3 | Minimum single-character OCR confidence |
| `minBboxAreaPx` | 200 | Minimum bounding box area in pixels |
| `minPlateLen` | 2 | Minimum plate string length (after stripping pad chars) |
| `maxPlateLen` | 10 | Maximum plate string length |

### Stage 2 — Stabilizer (per-session state)

K-of-N consensus with fuzzy plate matching. Within a sliding window of
`stabilizerWindowMs` (default 3000ms), the stabilizer tracks plate reads using
fuzzy matching (Levenshtein distance ≤ `fuzzyDistance`, default 1).

When K out of the last N reads agree (`consensusK` / `consensusN`, default
3/5), the peak-confidence reading from that burst is emitted. This prevents
single-frame OCR glitches from producing false records.

### Stage 3 — Motion sanity (per-session state)

Cross-checks bbox stability against GPS motion. If the device is stationary
(speed < `stationarySpeedThresholdKph`, default 3 km/h), the detection's
bounding box must not drift more than `bboxDriftMaxStationaryPx` (default 80 px)
from the last stable detection within `motionWindowMs` (default 5000ms).

This catches false positives that "jump" around the frame while the car is
parked.

### Stage 4 — Sighting dedup (per-session state)

Prevents duplicate records of the same physical plate. A "sighting" is defined
by normalized plate text + time window + geo radius:

- **Time window** (`timeWindowMs`, default 60000ms): same plate within this
  window is considered the same sighting
- **Geo radius** (`geoRadiusM`, default 50m): same plate within this distance is
  the same sighting
- **Speed-aware radius**: when `speedAwareRadius` is enabled, the geo radius
  scales with speed (faster = larger radius)
- **Retrigger**: after `retriggerWindowMs` (default 300000ms) with no
  detections, a plate can be re-emitted as a new sighting

Within a sighting, only the highest-confidence reading is stored. Subsequent
readings with higher confidence update the stored record in-place (UPDATE);
lower-confidence readings are skipped (SKIP).

## Session modes

| Mode | Behavior |
|------|----------|
| `normal` | Only emitted/stored results are recorded |
| `diagnostic` | Every detection is stored with a decision trace explaining why it was kept, skipped, or updated |

## Filter presets

Choose a preset in Settings. Advanced users can override individual thresholds.

| Preset | Description |
|--------|-------------|
| **Conservative** | Few false logs, may miss low-quality reads |
| **Balanced** | Recommended default |
| **Permissive** | Log more; risk of duplicates |
| **Log All** | No filtering at all (raw study mode) |

Each preset sets all prefilter and stabilizer parameters. Changing a preset
overwrites any custom threshold values.

## Full parameter reference

### Prefilter

| Param | Key | Default | Range |
|-------|-----|---------|-------|
| Min detector confidence | `minDetectorConfidence` | 0.3 | 0–1 |
| Min OCR confidence | `minOcrConfidence` | 0.5 | 0–1 |
| Min char confidence | `minCharConfidence` | 0.3 | 0–1 |
| Min bbox area (px) | `minBboxAreaPx` | 200 | 0–10000 |
| Min plate length | `minPlateLen` | 2 | 1–20 |
| Max plate length | `maxPlateLen` | 10 | 1–20 |

### Stabilizer

| Param | Key | Default | Range |
|-------|-----|---------|-------|
| Consensus K | `consensusK` | 3 | 1–10 |
| Consensus N | `consensusN` | 5 | 1–20 |
| Window (ms) | `stabilizerWindowMs` | 3000 | 500–30000 |
| Fuzzy distance | `fuzzyDistance` | 1 | 0–5 |

### Dedup

| Param | Key | Default | Range |
|-------|-----|---------|-------|
| Time window (ms) | `timeWindowMs` | 60000 | 5000–600000 |
| Geo radius (m) | `geoRadiusM` | 50 | 0–500 |
| Retrigger window (ms) | `retriggerWindowMs` | 300000 | 30000–3600000 |
| Retrigger radius (m) | `retriggerRadiusM` | 100 | 0–1000 |
| Speed-aware radius | `speedAwareRadius` | true | on/off |

### Motion

| Param | Key | Default | Range |
|-------|-----|---------|-------|
| Stationary speed (km/h) | `stationarySpeedThresholdKph` | 3 | 0–20 |
| Bbox drift max (px) | `bboxDriftMaxStationaryPx` | 80 | 0–500 |
| Motion window (ms) | `motionWindowMs` | 5000 | 1000–30000 |

### Inference

| Param | Key | Default | Range |
|-------|-----|---------|-------|
| Target FPS | `targetFps` | 4 | 1–15 |
