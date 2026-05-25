# Architecture

## Codebase map

```
src/
├── packages/alpr/          # ONNX inference engine (stage1+stage2)
│   ├── index.ts            # Alpr class — orchestrates detector + OCR
│   ├── stage1.ts           # YOLOv9-t detector (letterbox → ONNX → parse)
│   ├── stage2.ts           # CCT OCR (resize → ONNX → argmax decode)
│   ├── worker.ts           # Web Worker — receives ImageBitmaps, returns detections
│   ├── client.ts           # Main-thread client — creates Worker, sends batches
│   ├── worker-protocol.ts  # Message types for worker ↔ main thread
│   └── types.ts            # BoundingBox, Detection, OcrConfig, IoU
├── capture/                # Camera capture + tiling pipeline
│   ├── profile.ts          # CaptureProfile, TileGrid, buildDefaultProfile
│   ├── tiling.ts           # generateTiles, reprojectBbox, crossTileNMS
│   ├── controller.ts       # CaptureController — per-tick orchestrator
│   └── capabilities.ts     # getCapabilities, applyConstraints, buildInitialConstraints
├── composables/            # Vue composables (stateful, singleton-where-needed)
│   ├── useAlpr.ts          # ALPR worker singleton (init, dispose, backend detection)
│   ├── useCamera.ts        # getUserMedia stream lifecycle
│   ├── useCaptureProfile.ts # Profile CRUD against IndexedDB
│   ├── useInferenceLoop.ts # requestVideoFrameCallback loop, FPS/TPS counters
│   ├── useDb.ts            # IndexedDB lifecycle (open with timeout, retry)
│   ├── usePrefs.ts         # User preferences in IndexedDB
│   ├── useSession.ts       # Recording lifecycle (start, record, stop)
│   ├── useSensors.ts       # Geolocation + device orientation
│   └── useNetwork.ts       # Online/offline detection
├── pipeline/               # Detection filtering (post-inference, pre-storage)
│   ├── index.ts            # Orchestrator — chains prefilter → stabilizer → motion → dedup
│   ├── prefilter.ts        # Stateless confidence/area/length rejects
│   ├── stabilizer.ts       # K-of-N consensus with fuzzy plate matching
│   ├── motion.ts           # Bbox drift sanity for stationary camera
│   ├── presets.ts          # Filter preset definitions
│   ├── trace.ts            # Decision trace for diagnostic sessions
│   └── fuzzy.ts            # Levenshtein distance
├── storage/                # IndexedDB schema and operations
│   ├── db.ts               # ALPRmeDB class (Dexie), v4 schema
│   └── dedup.ts            # Per-session sighting dedup with geo+time windows
├── views/                  # Route-level page components
│   ├── AppShell.vue        # Main app with tab bar (Capture, Sessions, Settings, Help)
│   ├── SetupView.vue       # First-run wizard (permissions → models → capture)
│   ├── SessionView.vue     # Single session detail (table + map + export)
│   └── ProfileEditorView.vue # Profile editor with live camera preview
├── components/             # Reusable UI pieces
│   ├── CaptureTab.vue      # Camera overlay (bbox canvas, HUD, grid editor)
│   ├── SessionsListTab.vue # Session list with delete
│   ├── SettingsTab.vue     # Model selection, FPS, filter presets, advanced params
│   ├── HelpTab.vue         # Help content + acknowledgements
│   ├── GridEditor.vue      # Tap-to-toggle grid cell overlay
│   ├── CameraControls.vue  # Slide-out drawer for zoom/focus/torch/exposure
│   └── CaptureProfileMenu.vue # Profile picker + new/edit actions
└── setup/                  # App configuration
    └── modelCatalog.ts     # STAGE1_MODELS, STAGE2_MODELS, OCR_CONFIG_URLS
```

## Composable layer

Each composable manages a focused concern with module-level state where
appropriate:

| Composable | State | Notes |
|---|---|---|
| `useAlpr` | Module-level `AlprClient` singleton | One worker for the app lifetime |
| `useCamera` | Instance-level stream + capabilities | One per AppShell / ProfileEditor |
| `useCaptureProfile` | Module-level profile list + active ID | Loaded once, shared across views |
| `useInferenceLoop` | Instance-level FPS/TPS counters | Tied to a `<video>` element |
| `useDb` | Module-level `ALPRmeDB` instance | 15s open timeout, retry on failure |
| `usePrefs` | Module-level prefs object | Loaded from DB, merged with defaults |
| `useSession` | Module-level active session + recent plates | One session at a time |
| `useSensors` | Instance-level geolocation + orientation | Permission-aware, partial-progress |
| `useNetwork` | Instance-level `navigator.onLine` | Updates status bar |

## Storage

IndexedDB via Dexie (`src/storage/db.ts`). The `ALPRmeDB` class defines the schema:

| Table | Key | Indexes | Purpose |
|-------|-----|---------|---------|
| `sessions` | `++id` | `startedAt`, `endedAt` | Recording sessions with mode + profile |
| `detections` | `++id` | `sessionId`, `plate`, `timestamp`, `[sessionId+timestamp]` | Per-plate records with location/heading |
| `crops` | `++id` | `detectionId` | Optional plate image crops |
| `assets` | `++id` | `&key` | Binary blobs keyed by type |
| `prefs` | `&key` | — | App preferences (single row) |
| `captureProfiles` | `++id` | `&name`, `updatedAt` | Named camera + grid configs |

The database opens with a 15-second timeout to surface IndexedDB issues
explicitly rather than hanging indefinitely.

## PWA and offline

Service worker via `vite-plugin-pwa` with `registerType: 'autoUpdate'`.
Precached at install time: JS, CSS, HTML, WASM (ORT runtime), JSON configs,
fonts, icons, and ONNX model files. The user must visit the app online at least
once for the models to download — after that, the app works fully offline.

The SW uses `clientsClaim: true` so new versions take effect immediately.
`cleanupOutdatedCaches: true` removes old caches on activation.

## Sensors

Camera permission is requested via `getUserMedia` (OS-level prompt).
Geolocation uses `watchPosition` (OS-level prompt).

Orientation differs by platform:
- **iOS**: `webkitCompassHeading` fires automatically (no permission needed)
- **Android**: `DeviceOrientationEvent.alpha` fires automatically
- Both are corrected for magnetic declination using the NOAA WMM model via the
  `magvar` npm package

Heading, location, altitude, and speed are attached to every recorded detection.

## Model variants

3 detector models (YOLOv9-t at 256×256, 384×384, 512×512 input) and 2 OCR
models (CCT XS v2 and CCT S v2 at 128×64 input). Models are served as static
files from `/models/`. The user selects variants in Settings or during the
first-run setup wizard. Changing models stops inference, reinitializes the ONNX
session, and resumes automatically.
