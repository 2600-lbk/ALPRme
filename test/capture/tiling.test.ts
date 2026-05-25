import { describe, it, expect } from 'vitest'
import { generateTiles, reprojectBbox, crossTileNMS, type Tile } from '@/capture/tiling'
import { singleCellGrid, makeGrid } from '@/capture/profile'
import type { WorkerDetection } from '@/packages/alpr/worker-protocol'

describe('generateTiles (grid model)', () => {
  it('emits a single full-frame tile for a 1×1 grid', () => {
    const tiles = generateTiles({
      srcW: 1920, srcH: 1080,
      grid: singleCellGrid(),
      overlap: 0,
    })
    expect(tiles.length).toBe(1)
    expect(tiles[0]!.srcX).toBe(0)
    expect(tiles[0]!.srcY).toBe(0)
    expect(tiles[0]!.srcW).toBe(1920)
    expect(tiles[0]!.srcH).toBe(1080)
    // dst matches crop dimensions (no resize in cropAndResize — the worker
    // preprocessor handles letterboxing to model input size).
    expect(tiles[0]!.dstW).toBe(1920)
    expect(tiles[0]!.dstH).toBe(1080)
    expect(tiles[0]!.row).toBe(0)
    expect(tiles[0]!.col).toBe(0)
  })

  it('emits 4 tiles for a 2×2 grid covering the full frame (no overlap)', () => {
    const tiles = generateTiles({
      srcW: 1000, srcH: 1000,
      grid: makeGrid(2, 2),
      overlap: 0,
    })
    expect(tiles.length).toBe(4)
    const seen = new Set(tiles.map(t => `${t.row},${t.col}`))
    expect(seen).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']))
    for (const t of tiles) {
      expect(t.srcW).toBe(500)
      expect(t.srcH).toBe(500)
      expect(t.dstW).toBe(500)
      expect(t.dstH).toBe(500)
    }
  })

  it('expands each cell by overlap*cell on each side', () => {
    const tiles = generateTiles({
      srcW: 1000, srcH: 1000,
      grid: makeGrid(2, 2),
      overlap: 0.2,    // pad = 500*0.2/2 = 50 px on each side
    })
    expect(tiles.length).toBe(4)
    // Top-left cell normally [0,0]→[500,500]; with 50px pad on the inside edges
    // and clamped to (0,0) on the outside, it becomes [0,0]→[550,550].
    const tl = tiles.find(t => t.row === 0 && t.col === 0)!
    expect(tl.srcX).toBe(0)
    expect(tl.srcY).toBe(0)
    expect(tl.srcW).toBe(550)
    expect(tl.srcH).toBe(550)
    expect(tl.dstW).toBe(550)
    expect(tl.dstH).toBe(550)
    // Bottom-right gets clamped on the outside edges too: [450,450]→[1000,1000].
    const br = tiles.find(t => t.row === 1 && t.col === 1)!
    expect(br.srcX).toBe(450)
    expect(br.srcY).toBe(450)
    expect(br.srcW).toBe(550)
    expect(br.srcH).toBe(550)
    expect(br.dstW).toBe(550)
    expect(br.dstH).toBe(550)
  })

  it('skips disabled cells', () => {
    const grid = makeGrid(2, 2)
    grid.enabled[0] = false  // disable top-left
    const tiles = generateTiles({
      srcW: 1000, srcH: 1000,
      grid,
      overlap: 0,
    })
    expect(tiles.length).toBe(3)
    expect(tiles.find(t => t.row === 0 && t.col === 0)).toBeUndefined()
  })

  it('returns an empty list when every cell is disabled', () => {
    const grid = makeGrid(2, 2)
    grid.enabled.fill(false)
    const tiles = generateTiles({
      srcW: 1000, srcH: 1000,
      grid,
      overlap: 0,
    })
    expect(tiles.length).toBe(0)
  })

  it('produces a 3×3 grid (9 tiles)', () => {
    const tiles = generateTiles({
      srcW: 900, srcH: 900,
      grid: makeGrid(3, 3),
      overlap: 0.1,
    })
    expect(tiles.length).toBe(9)
    for (const t of tiles) {
      expect(t.dstW).toBe(t.srcW)
      expect(t.dstH).toBe(t.srcH)
    }
  })

  it('honors non-square grids (e.g. 4×2 for wide aspect)', () => {
    const tiles = generateTiles({
      srcW: 1600, srcH: 800,
      grid: makeGrid(4, 2),
      overlap: 0,
    })
    expect(tiles.length).toBe(8)
    // cells are 400×400 in source-pixel space.
    for (const t of tiles) {
      expect(t.srcW).toBe(400)
      expect(t.srcH).toBe(400)
      expect(t.dstW).toBe(400)
      expect(t.dstH).toBe(400)
    }
  })

  it('honors maxTiles cap by centre-proximity priority', () => {
    // 3×3 produces 9 tiles; the centre tile is closest to the frame centre.
    const tiles = generateTiles({
      srcW: 900, srcH: 900,
      grid: makeGrid(3, 3),
      overlap: 0,
      maxTiles: 4,
    })
    expect(tiles.length).toBe(4)
    // The dead-centre tile must survive.
    expect(tiles.some(t => t.row === 1 && t.col === 1)).toBe(true)
  })
})

describe('reprojectBbox', () => {
  it('identity for a full-frame 1:1 tile', () => {
    const tile: Tile = {
      id: 'a', srcX: 0, srcY: 0, srcW: 1000, srcH: 1000,
      dstW: 1000, dstH: 1000, row: 0, col: 0,
    }
    const r = reprojectBbox({ x1: 100, y1: 200, x2: 300, y2: 400 }, tile)
    expect(r).toEqual({ x1: 100, y1: 200, x2: 300, y2: 400 })
  })

  it('off-centre tile: bbox origin lands at tile origin in source coords', () => {
    // With dstW == srcW (the new crop-only pipeline), the scale factor is 1.0
    // and bboxes in crop space simply add the tile origin offset.
    const tile: Tile = {
      id: 'a', srcX: 500, srcY: 250, srcW: 500, srcH: 500,
      dstW: 500, dstH: 500, row: 0, col: 1,
    }
    const r = reprojectBbox({ x1: 0, y1: 0, x2: 256, y2: 256 }, tile)
    expect(r.x1).toBe(500)
    expect(r.y1).toBe(250)
    expect(r.x2).toBe(756)
    expect(r.y2).toBe(506)
  })

  it('scales when dst differs from src (legacy / explicit override)', () => {
    // For a tile where dst != src (not produced by generateTiles, but
    // reprojectBbox supports it), the scale factor accounts for the resize.
    const tile: Tile = {
      id: 'a', srcX: 0, srcY: 0, srcW: 768, srcH: 384,
      dstW: 384, dstH: 384, row: 0, col: 0,
    }
    const r = reprojectBbox({ x1: 192, y1: 192, x2: 256, y2: 256 }, tile)
    expect(r.x1).toBe(192 * 2)
    expect(r.x2).toBe(256 * 2)
    expect(r.y1).toBe(192)
    expect(r.y2).toBe(256)
  })
})

describe('crossTileNMS', () => {
  function mkDet(bbox: { x1: number; y1: number; x2: number; y2: number }, conf = 0.9): WorkerDetection {
    return {
      plate: 'ABC123',
      confidence: conf,
      charConfidences: [],
      bbox,
      detectorConfidence: 0.9,
      region: null,
      regionConfidence: null,
    }
  }

  it('keeps the higher-confidence overlapping detection', () => {
    const dets = [
      mkDet({ x1: 0, y1: 0, x2: 100, y2: 100 }, 0.8),
      mkDet({ x1: 10, y1: 10, x2: 100, y2: 100 }, 0.95),
    ]
    const out = crossTileNMS(dets, 0.5)
    expect(out.length).toBe(1)
    expect(out[0]!.confidence).toBe(0.95)
  })

  it('keeps both when IoU is low', () => {
    const dets = [
      mkDet({ x1: 0, y1: 0, x2: 50, y2: 50 }),
      mkDet({ x1: 200, y1: 200, x2: 250, y2: 250 }),
    ]
    expect(crossTileNMS(dets, 0.5).length).toBe(2)
  })

  it('returns empty for empty input', () => {
    expect(crossTileNMS([], 0.5)).toEqual([])
  })
})
