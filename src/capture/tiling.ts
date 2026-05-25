import type { BoundingBox } from '@/packages/alpr/types'
import { iou } from '@/packages/alpr/types'
import type { WorkerDetection } from '@/packages/alpr/worker-protocol'
import type { TileGrid } from './profile'

export interface Tile {
  id: string
  /** Source-frame pixel rect this tile was cropped from. */
  srcX: number
  srcY: number
  srcW: number
  srcH: number
  /** Destination size in pixels (the crop dimensions sent to the worker;
   *  the worker's preprocessor letterboxes this to model input size). */
  dstW: number
  dstH: number
  /** Grid coordinates (diagnostics + UI). */
  row: number
  col: number
}

export interface GenerateTilesOptions {
  srcW: number
  srcH: number
  grid: TileGrid
  /** Fraction of cell-edge that bleeds into the neighbouring cell. 0..0.5. */
  overlap: number
  /** Cap on tiles returned. Excess tiles (lowest priority) are dropped. */
  maxTiles?: number
}

/**
 * Generate the set of tiles to run through the detector for a given source frame.
 *
 * Each enabled cell of the `grid` becomes one tile. Cells expand symmetrically
 * by `overlap * cellSize` in each direction (clamped to the frame bounds) so
 * detections that straddle a cell boundary still land inside at least one tile.
 *
 * When more tiles are generated than `maxTiles` allows, the tiles closest to
 * the frame centre win — peripheral cells get dropped under load.
 */
export function generateTiles(opts: GenerateTilesOptions): Tile[] {
  const { srcW, srcH, grid, overlap, maxTiles } = opts
  const cols = Math.max(1, Math.floor(grid.cols))
  const rows = Math.max(1, Math.floor(grid.rows))
  const cellW = srcW / cols
  const cellH = srcH / rows
  const safeOverlap = Math.min(0.49, Math.max(0, overlap))
  const padX = cellW * safeOverlap / 2
  const padY = cellH * safeOverlap / 2

  let tiles: Tile[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (!(grid.enabled[idx] ?? false)) continue
      const baseX = c * cellW
      const baseY = r * cellH
      const expandedX = Math.max(0, baseX - padX)
      const expandedY = Math.max(0, baseY - padY)
      const expandedRight = Math.min(srcW, baseX + cellW + padX)
      const expandedBottom = Math.min(srcH, baseY + cellH + padY)
      const expandedW = expandedRight - expandedX
      const expandedH = expandedBottom - expandedY
      tiles.push({
        id: `r${r}c${c}`,
        srcX: expandedX,
        srcY: expandedY,
        srcW: expandedW,
        srcH: expandedH,
        dstW: expandedW,
        dstH: expandedH,
        row: r,
        col: c,
      })
    }
  }

  if (maxTiles != null && tiles.length > maxTiles) {
    tiles = trimTilesByPriority(tiles, srcW, srcH, maxTiles)
  }

  return tiles
}

/** Keep the N tiles closest to the frame centre. */
function trimTilesByPriority(tiles: Tile[], srcW: number, srcH: number, maxTiles: number): Tile[] {
  const cx = srcW / 2
  const cy = srcH / 2
  const scored = tiles
    .map(t => {
      const tcx = t.srcX + t.srcW / 2
      const tcy = t.srcY + t.srcH / 2
      const dx = tcx - cx
      const dy = tcy - cy
      return { t, d2: dx * dx + dy * dy }
    })
    .sort((a, b) => a.d2 - b.d2)
  return scored.slice(0, maxTiles).map(s => s.t)
}

/**
 * Convert a bbox in tile-pixel coordinates (the model's output space, which
 * letterbox-undo has already mapped back to the tile's full pixel extent) into
 * source-frame pixel coordinates.
 */
export function reprojectBbox(bbox: BoundingBox, tile: Tile): BoundingBox {
  const sx = tile.srcW / tile.dstW
  const sy = tile.srcH / tile.dstH
  return {
    x1: tile.srcX + bbox.x1 * sx,
    y1: tile.srcY + bbox.y1 * sy,
    x2: tile.srcX + bbox.x2 * sx,
    y2: tile.srcY + bbox.y2 * sy,
  }
}

/**
 * Greedy NMS across tile boundaries. Detections with IoU above the threshold
 * keep only the highest-confidence one. Also suppresses detections with
 * identical plate text whose centroids are very close (position-based dedup
 * for tile-boundary duplicates where IoU may be borderline).
 * Operates on source-frame coordinates.
 */
export function crossTileNMS(
  dets: WorkerDetection[],
  iouThreshold: number,
): WorkerDetection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence)
  const kept: WorkerDetection[] = []
  for (const d of sorted) {
    let suppressed = false
    for (const k of kept) {
      if (iou(d.bbox, k.bbox) > iouThreshold) { suppressed = true; break }
      // Position-based dedup: same plate text and centroids within 50 px
      if (d.plate && k.plate && d.plate === k.plate) {
        const dcx = (d.bbox.x1 + d.bbox.x2) / 2
        const dcy = (d.bbox.y1 + d.bbox.y2) / 2
        const kcx = (k.bbox.x1 + k.bbox.x2) / 2
        const kcy = (k.bbox.y1 + k.bbox.y2) / 2
        const dx = dcx - kcx
        const dy = dcy - kcy
        if (Math.sqrt(dx * dx + dy * dy) < 50) { suppressed = true; break }
      }
    }
    if (!suppressed) kept.push(d)
  }
  return kept
}
