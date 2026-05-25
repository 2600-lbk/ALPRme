import type { CameraCapabilities } from './capabilities'

/**
 * The frame is divided into a `cols × rows` uniform grid; each cell is
 * individually enable-able. Tile generation produces one model-input-sized
 * tile per enabled cell (with optional overlap into neighbours).
 *
 * Stored on the CaptureProfile in canonical (sensor-native) orientation so
 * the same grid maps to the same physical scene regardless of how the user
 * holds the device.
 */
export interface TileGrid {
  cols: number
  rows: number
  /** Per-cell enable state, row-major (index = row * cols + col). */
  enabled: boolean[]
}

export type ResolutionRequest = { width: number; height: number } | 'max'

export type CaptureMode = 'tiled' | 'whole-frame'

export interface CaptureProfile {
  id?: number
  name: string
  deviceId: string | null
  facingMode: 'environment' | 'user' | null
  resolution: ResolutionRequest
  zoom: number | null
  focusMode: 'continuous' | 'manual' | 'single-shot' | null
  focusDistance: number | null
  exposureMode: 'continuous' | 'manual' | null
  exposureCompensation: number | null
  torch: boolean
  whiteBalanceMode: 'auto' | 'manual' | string | null
  captureMode: CaptureMode
  grid: TileGrid
  /** 0..0.5; expands each cell into a neighbouring band when stitching tiles. */
  tileOverlap: number
  /** Cap on tiles generated per inference tick. Excess tiles (those farthest from
   *  the frame centre) are dropped. */
  maxTilesPerFrame: number
  /** Metadata only; coords are sensor-native so the grid is orientation-invariant. */
  authoredOrientation: 'portrait' | 'landscape'
  createdAt: number
  updatedAt: number
}

/** Convenience: a 1×1 grid with the single cell enabled (full-frame inference). */
export function singleCellGrid(): TileGrid {
  return { cols: 1, rows: 1, enabled: [true] }
}

/** Build an N-cell grid with every cell enabled. */
export function makeGrid(cols: number, rows: number): TileGrid {
  const safeCols = Math.max(1, Math.floor(cols))
  const safeRows = Math.max(1, Math.floor(rows))
  return {
    cols: safeCols,
    rows: safeRows,
    enabled: new Array(safeCols * safeRows).fill(true),
  }
}

/**
 * Resize an existing grid to a new (cols, rows). Cells in the overlap region
 * keep their enabled state; new cells default to enabled.
 */
export function resizeGrid(prev: TileGrid, cols: number, rows: number): TileGrid {
  const next = makeGrid(cols, rows)
  for (let r = 0; r < Math.min(prev.rows, next.rows); r++) {
    for (let c = 0; c < Math.min(prev.cols, next.cols); c++) {
      next.enabled[r * next.cols + c] = prev.enabled[r * prev.cols + c] ?? true
    }
  }
  return next
}

/**
 * Suggested resolution for the given mode + detector input size.
 *
 * Tiled mode wants the largest sensor frame it can get (the multi-tile slicer
 * benefits from headroom). Whole-frame mode wants the smallest standard
 * resolution that still leaves the preprocessor with little resize work —
 * smallest preset whose long edge is at least ~1.5× the model input.
 */
export function suggestResolution(
  captureMode: CaptureMode,
  modelInput: { w: number; h: number },
): ResolutionRequest {
  if (captureMode === 'tiled') return 'max'
  const target = Math.max(modelInput.w, modelInput.h) * 1.5
  if (target <= 640) return { width: 640, height: 480 }
  if (target <= 1280) return { width: 1280, height: 720 }
  if (target <= 1920) return { width: 1920, height: 1080 }
  return 'max'
}

/**
 * Derive sensible per-control defaults from the live camera's capability
 * snapshot. Called when CREATING a new profile so the editor opens with
 * values that match the hardware (zoom at native, continuous focus if the
 * device supports it, etc.) rather than null placeholders.
 */
export function defaultsFromCapabilities(caps: CameraCapabilities): Partial<CaptureProfile> {
  return {
    zoom: caps.zoom?.min ?? null,
    focusMode: caps.focusModes.includes('continuous')
      ? 'continuous'
      : (caps.focusModes[0] as CaptureProfile['focusMode'] | undefined) ?? null,
    focusDistance: null,
    exposureMode: caps.exposureModes.includes('continuous')
      ? 'continuous'
      : (caps.exposureModes[0] as CaptureProfile['exposureMode'] | undefined) ?? null,
    exposureCompensation: caps.exposureCompensation ? 0 : null,
    whiteBalanceMode: caps.whiteBalanceModes.includes('auto')
      ? 'auto'
      : caps.whiteBalanceModes[0] ?? null,
    torch: false,
  }
}

/** Build a fresh profile that runs full-frame inference at max resolution —
 *  equivalent to the pre-tiling default behaviour. Camera fields are nulled;
 *  the caller can layer `defaultsFromCapabilities(...)` on top once a camera
 *  capability snapshot is available. */
export function buildDefaultProfile(name = 'Default'): Omit<CaptureProfile, 'id'> {
  const now = Date.now()
  return {
    name,
    deviceId: null,
    facingMode: 'environment',
    resolution: { width: 640, height: 480 },
    zoom: null,
    focusMode: null,
    focusDistance: null,
    exposureMode: null,
    exposureCompensation: null,
    torch: false,
    whiteBalanceMode: null,
    captureMode: 'whole-frame',
    grid: singleCellGrid(),
    tileOverlap: 0.2,
    maxTilesPerFrame: 6,
    authoredOrientation: 'landscape',
    createdAt: now,
    updatedAt: now,
  }
}

/** Count of enabled cells in a grid. Convenience for UI summaries. */
export function enabledCellCount(grid: TileGrid): number {
  let n = 0
  for (const e of grid.enabled) if (e) n++
  return n
}
