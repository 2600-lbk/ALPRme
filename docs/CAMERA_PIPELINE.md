# Camera Pipeline

The camera capture pipeline replaces the old downscaled-whole-frame approach with
four primitives:

1. **High-resolution capture** at native sensor resolution via
   `drawImage(video, ...)` onto an `OffscreenCanvas`
2. **Tile-grid inference** — the source frame is divided into a uniform
   `cols × rows` grid; each cell is individually enable-able; each enabled cell
   becomes a tile that gets cropped at source resolution and dispatched to the
   worker
3. **Capture profiles** — camera params + grid + tile-overlap are bundled into
   a named `CaptureProfile` persisted in IndexedDB
4. **Capability-driven defaults** — when creating a new profile, camera controls
   (zoom, focus, exposure, white balance) are derived from what
   `track.getCapabilities()` actually advertises

## Capture modes

| Mode | Tiles | Typical resolution |
|------|-------|--------------------|
| `whole-frame` | One full-frame tile regardless of grid config | 640×480 (480p) |
| `tiled` | One per enabled grid cell | `'max'` (ideal 3840×2160) or user override |

The **default profile** uses whole-frame mode at 480p — fast, battery-friendly,
and sufficient for nearby plates. Enable tiling in the profile editor for
distant or small plates at the cost of increased compute.

## Data flow

```
CaptureProfile (IndexedDB)
        │ loaded via useCaptureProfile
        ▼
useCamera stream ──→ CaptureController
(getUserMedia +          │ src OffscreenCanvas (native res)
 applyConstraints)       │ grid-aware tile generation
                         │ tile dispatch + reprojection + NMS
        ┌────────────────┤
        ▼                ▼
requestVideoFrameCallback  AlprClient.predictBatch([{tileId, bitmap}, ...])
        │                       │
        │         ┌─────────────┘
        │         ▼
        │    Worker: crop → preprocess (letterbox) → detector → OCR
        │         │
        ▼         ▼
   per tick:    detections in tile-pixel space
   1. drawImage(video) → src canvas
   2. generateTiles(srcSize, grid, overlap, maxTiles)
   3. crop each tile at source resolution (no resize)
   4. dispatch batch to worker
   5. reproject bboxes from tile-pixel → source-pixel coords
   6. crossTileNMS(allDets, iouThreshold=0.25)
   7. emit { detections, tileCount }
```

Key files:
- `src/capture/profile.ts` — `CaptureProfile`, `TileGrid`, `buildDefaultProfile`
- `src/capture/tiling.ts` — `generateTiles`, `reprojectBbox`, `crossTileNMS`
- `src/capture/controller.ts` — `CaptureController` orchestrator
- `src/composables/useCamera.ts` — stream lifecycle + capability application
- `src/composables/useInferenceLoop.ts` — `requestVideoFrameCallback` loop

## Tile generation

`generateTiles({ srcW, srcH, grid, overlap, maxTiles })` produces a flat list
of `Tile` objects:

- Cell size in source pixels: `cellW = srcW / grid.cols`, `cellH = srcH / grid.rows`
- Each enabled cell's tile expands by `cellSize × overlap / 2` in every
  direction (clamped to frame edges). At `overlap = 0`, tiles cover the frame
  exactly; at `overlap = 0.2`, neighbours share 20% of their edge.
- Tiles are emitted in row-major order
- When more cells are enabled than `maxTilesPerFrame` allows, the tiles closest
  to the frame centre win (centre-distance priority trim)

Tiles are cropped at source resolution — no resize happens in the controller.
The worker's preprocessor handles letterboxing to the model input size,
preserving aspect ratio.

## Cross-tile NMS and dedup

After all tiles are processed, bboxes are reprojected from tile-pixel space to
source-frame pixel space. Then `crossTileNMS` runs:

1. **Greedy IoU NMS** (threshold 0.25) — keeps the highest-confidence detection
   when two reprojected bboxes overlap significantly
2. **Position-based dedup** — if two detections have the same plate text and
   their centroids are within 50 px, the lower-confidence one is suppressed

This handles the duplicate detections that occur when a plate straddles a tile
boundary (the overlap zone ensures it appears in both tiles).

## FPS vs TPS

`useInferenceLoop` exposes both:

- **`achievedFps`** — number of successful capture ticks per second. A "tick"
  runs the entire `CaptureController.capture()` pipeline and may dispatch N
  tiles. Capped by the `targetFps` setting (default 4).
- **`tilesPerSecond`** — number of *tile* dispatches per second. Equal to
  `achievedFps × tilesPerTick`. For a 2×2 grid that's `4 × 4 = 16 TPS` at 4
  FPS. The status bar shows TPS only when it differs from FPS.

The status bar also shows a **performance dot**: green when FPS ≥ 90% of
target, yellow at 50-90%, red below 50%.

## Layout

The Capture tab is a three-row flex column:

```
app-shell
├── status-bar        ALPRme + "N FPS · TPS · WASM" + REC dot
├── tab-content
│    ├── capture-top  profile pill · grid-edit toggle · gear icon
│    ├── camera-area  <video object-fit: contain>
│    │                + CaptureTab overlay (canvas, GridEditor, HUD chips)
│    │                + Sessions / Settings / Help tabs via v-show
│    └── capture-bottom  live plate log + record/stop button
└── tab-bar           Capture · Sessions · Settings · Help
```

`object-fit: contain` shows the full sensor area with letterbox bars on the long
side. The overlay math is a single display-fit transform since detections are
already in source-pixel coordinates.

HUD chips:
- **Top-left**: heading
- **Bottom-left**: altitude (above GPS coordinates)
- **Bottom-right**: speed

The bottom strip is in the flex flow (no `position: absolute`), so it never
covers the camera preview.

## Profile editor

The profile editor opens at `/profiles/:id` with a live camera preview.
It exposes:

- **Name** — editable text field
- **Capture mode** — toggles between Tiled and Whole-frame
- **Grid sliders** — cols × rows (1×1 through 4×4), dimmed in whole-frame mode
- **Resolution dropdown** — Max, 4K, 1080p, 720p, 480p; auto-snaps to mode default
- **Camera controls** — zoom, focus, exposure, torch, white balance (only
  controls the device actually advertises)
- **Grid editor** — tap cells on the live preview to toggle them on/off
