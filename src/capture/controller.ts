import type { AlprClient } from '@/packages/alpr/client'
import type { WorkerDetection } from '@/packages/alpr/worker-protocol'
import { generateTiles, reprojectBbox, crossTileNMS, type Tile } from './tiling'
import type { CaptureProfile, TileGrid } from './profile'
import { singleCellGrid } from './profile'

export interface CaptureControllerOptions {
  video: HTMLVideoElement
  profile: CaptureProfile
  client: AlprClient
  /** IoU threshold for cross-tile NMS. Default 0.25. */
  nmsIou?: number
}

export interface CaptureResult {
  detections: WorkerDetection[]
  /** Number of tiles dispatched this tick (after grid + maxTiles filters). */
  tileCount: number
}

/**
 * Owns the per-tick pipeline:
 *   grab → tile → dispatch → reproject → NMS → emit (source-frame coords).
 *
 * Reuses a single OffscreenCanvas across ticks to avoid allocator churn. The
 * downstream detection list is always in the camera's native source-pixel
 * space, so the overlay only needs a single display-fit transform.
 */
export class CaptureController {
  private profile: CaptureProfile
  private readonly video: HTMLVideoElement
  private readonly client: AlprClient
  private readonly nmsIou: number

  private srcCanvas: OffscreenCanvas | null = null
  private srcCtx: OffscreenCanvasRenderingContext2D | null = null
  private _sourceSize: { w: number; h: number } = { w: 0, h: 0 }

  constructor(opts: CaptureControllerOptions) {
    this.video = opts.video
    this.client = opts.client
    this.profile = opts.profile
    this.nmsIou = opts.nmsIou ?? 0.25
  }

  setProfile(p: CaptureProfile): void {
    this.profile = p
  }

  get sourceSize(): { w: number; h: number } {
    return this._sourceSize
  }

  /** One inference tick. Returns detections in source-frame pixel coordinates
   *  alongside the number of tiles that were actually dispatched. */
  async capture(): Promise<CaptureResult> {
    const v = this.video
    const w = v.videoWidth
    const h = v.videoHeight
    if (!w || !h || v.readyState < 2) return { detections: [], tileCount: 0 }

    this._sourceSize = { w, h }

    if (!this.srcCanvas || this.srcCanvas.width !== w || this.srcCanvas.height !== h) {
      this.srcCanvas = new OffscreenCanvas(w, h)
      this.srcCtx = this.srcCanvas.getContext('2d', { willReadFrequently: true })
    }
    if (!this.srcCtx) return { detections: [], tileCount: 0 }

    this.srcCtx.drawImage(v, 0, 0, w, h)

    // Whole-frame mode always uses a 1×1 grid regardless of the profile's
    // configured grid (the editor dims that out so it can't surprise the user).
    const effectiveGrid: TileGrid = this.profile.captureMode === 'whole-frame'
      ? singleCellGrid()
      : this.profile.grid

    const tiles = generateTiles({
      srcW: w,
      srcH: h,
      grid: effectiveGrid,
      overlap: this.profile.tileOverlap,
      maxTiles: this.profile.maxTilesPerFrame,
    })
    if (tiles.length === 0) return { detections: [], tileCount: 0 }

    const tileBitmaps: Array<{ tileId: string; bitmap: ImageBitmap; tile: Tile }> = []
    for (const tile of tiles) {
      const bitmap = await this.cropAndResize(this.srcCanvas, tile)
      if (bitmap) tileBitmaps.push({ tileId: tile.id, bitmap, tile })
    }
    if (tileBitmaps.length === 0) return { detections: [], tileCount: 0 }

    const results = await this.client.predictBatch(
      tileBitmaps.map(t => ({ tileId: t.tileId, bitmap: t.bitmap })),
    )

    const byTileId = new Map<string, Tile>(tileBitmaps.map(t => [t.tileId, t.tile]))
    const allDets: WorkerDetection[] = []
    for (const r of results) {
      const tile = byTileId.get(r.tileId)
      if (!tile) continue
      for (const det of r.detections) {
        allDets.push({ ...det, bbox: reprojectBbox(det.bbox, tile) })
      }
    }

    return { detections: crossTileNMS(allDets, this.nmsIou), tileCount: tileBitmaps.length }
  }

  /** Crop the tile's source rect from the snapshot canvas at source resolution.
   *  The worker's preprocessor handles letterboxing to model input size,
   *  preserving aspect ratio. */
  private async cropAndResize(src: OffscreenCanvas, tile: Tile): Promise<ImageBitmap | null> {
    const sx = Math.max(0, Math.round(tile.srcX))
    const sy = Math.max(0, Math.round(tile.srcY))
    const sw = Math.min(src.width - sx, Math.round(tile.srcW))
    const sh = Math.min(src.height - sy, Math.round(tile.srcH))
    if (sw <= 0 || sh <= 0) return null

    const dst = new OffscreenCanvas(sw, sh)
    const ctx = dst.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    return dst.transferToImageBitmap()
  }
}
