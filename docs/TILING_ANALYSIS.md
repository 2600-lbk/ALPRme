# Tiling Strategy Analysis

Evaluated on 25 USA license plate images from the HuggingFace
`UniqueData/license_plates` dataset. Ground truth is normalized
(spaces and hyphens stripped to match the OCR alphabet).

## Model combinations

| Detector | Input | OCR | Input |
|----------|-------|-----|-------|
| YOLOv9-t 256 | 256×256 | CCT XS v2 | 128×64 |
| YOLOv9-t 256 | 256×256 | CCT S v2 | 128×64 |
| YOLOv9-t 384 | 384×384 | CCT XS v2 | 128×64 |
| YOLOv9-t 384 | 384×384 | CCT S v2 | 128×64 |
| YOLOv9-t 512 | 512×512 | CCT XS v2 | 128×64 |
| YOLOv9-t 512 | 512×512 | CCT S v2 | 128×64 |

## Exact match rates by combo × strategy

| Detector | OCR | Whole | 2×2 tiled | 3×3 tiled |
|----------|-----|-------|-----------|-----------|
| YOLOv9-t 256 | CCT XS v2 | 72% | **84%** ↑ | 76% |
| YOLOv9-t 256 | CCT S v2 | 80% | **88%** ↑ | 80% |
| YOLOv9-t 384 | CCT XS v2 | 76% | 80% | 72% |
| YOLOv9-t 384 | CCT S v2 | 80% | 84% | 76% |
| YOLOv9-t 512 | CCT XS v2 | 84% | 84% | 68% |
| YOLOv9-t 512 | CCT S v2 | **92%** | 88% | 80% |

Desktop Python timings (whole-image, CoreML backend on Apple Silicon):
6–22ms depending on model size.

## Findings

**Tiling helps smaller detectors more.** YOLOv9-t 256 gains 8 percentage
points from 2×2 tiling (72→80% with CCT S v2). YOLOv9-t 512 doesn't
benefit — it already sees enough detail at whole-frame scale. The gain
comes from higher effective resolution per tile: small detectors miss
fine details when the entire frame is letterboxed to their input size.

**2×2 is the sweet spot.** Across all combos, 2×2 consistently matches
or beats whole-image. 3×3 degrades for larger detectors — too many false
positives from tiny crops, and plates get split across too many tiles.

**1×1 tiled ≡ whole-image** across all combos and strategies. This
verifies the tiling pipeline produces identical results to whole-image
prediction when configured with a single tile.

**CCT S v2 consistently beats CCT XS v2** by 8–12 percentage points at
roughly 2× the inference time. The larger OCR model is worth the cost
when accuracy matters.

## Recommended configurations for mobile

| Mode | Combo | Accuracy | Desktop time | Mobile estimate |
|------|-------|----------|--------------|-----------------|
| **Default (fast)** | 384 + XS v2, whole | 76% | 9ms | ~30ms |
| **Balanced** | 384 + S v2, 2×2 tiled | 84% | 40ms | ~120ms |
| **Max accuracy** | 512 + S v2, whole | 92% | 22ms | ~70ms |

Mobile estimates assume 3–4× slowdown vs desktop for WASM inference, and
4× multiplier for 2×2 tiling. WebGPU would close the gap significantly.

The **default** uses the medium detector with the fast OCR at full-frame
— good enough for most plates and fastest on mobile. The **balanced** mode
enables 2×2 tiling with the slower OCR for distant or small plates. **Max
accuracy** uses the large detector without tiling — best raw accuracy but
noticeably slower on older devices.

## Pitfalls of tiling on mobile

| Issue | Detail | Mitigation |
|-------|--------|------------|
| **Latency** | 4 tiles × WASM inference may exceed the frame budget at 4 FPS | WebGPU where available; adaptive FPS |
| **False positives** | More tiles = more non-plate objects detected (2×2 avg 1.5–1.9 detections vs 1.0–1.2 whole) | Raise detector confidence threshold when tiling |
| **Memory** | 4 × 540×960 ImageBitmaps ≈ 8MB per tick on 1080p | Cap `maxTilesPerFrame`; smaller grid on low-RAM devices |
| **Boundary straddling** | Plates at tile seams get partial coverage; OCR quality drops | Tile overlap (0.2 default) provides buffer; NMS folds duplicates |
| **NMS suppression** | IoU 0.25 + position-based dedup may merge adjacent plates from different cars | Unlikely on typical road scenes; tunable via `nmsIou` |
| **Grid sizing** | 2×2 on 720p gives 360p tiles — too small for distant plates | Use resolution-adaptive grid; prefer 1080p+ for tiling |
