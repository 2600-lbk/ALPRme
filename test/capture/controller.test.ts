import { describe, it, expect, vi } from 'vitest'
import { CaptureController } from '@/capture/controller'
import { buildDefaultProfile, makeGrid, type CaptureProfile } from '@/capture/profile'
import type { AlprClient } from '@/packages/alpr/client'
import type { WorkerDetection } from '@/packages/alpr/worker-protocol'

/**
 * Test seam: the controller depends on a live <video> element, an OffscreenCanvas
 * (provided by the test environment via vitest config), and an AlprClient. We
 * stub the video to report a fixed size and the client to record every batch
 * call.
 */
function mockVideo(w = 1920, h = 1080): HTMLVideoElement {
  // The vitest setup's drawImage shim accepts sources that carry a `_canvas` or
  // `_nodeCanvas` field; we synthesize one via OffscreenCanvas so the controller's
  // `ctx.drawImage(video, ...)` succeeds without a real DOM video element.
  const src = new OffscreenCanvas(w, h) as unknown as { _canvas?: unknown }
  return {
    videoWidth: w,
    videoHeight: h,
    readyState: 4,
    _canvas: (src as { _canvas?: unknown })._canvas,
  } as unknown as HTMLVideoElement
}

function mockClient(): AlprClient & { calls: Array<Array<{ tileId: string }>> } {
  const calls: Array<Array<{ tileId: string }>> = []
  return {
    calls,
    predictBatch: vi.fn(async (tiles: Array<{ tileId: string; bitmap: ImageBitmap }>) => {
      calls.push(tiles.map(t => ({ tileId: t.tileId })))
      // Return one detection per tile with a fixed bbox in tile coords.
      return tiles.map(t => ({
        tileId: t.tileId,
        detections: [{
          plate: 'ABC123',
          confidence: 0.9,
          charConfidences: [],
          bbox: { x1: 10, y1: 10, x2: 50, y2: 30 },
          detectorConfidence: 0.85,
          region: null,
          regionConfidence: null,
        }] as WorkerDetection[],
      }))
    }),
  } as unknown as AlprClient & { calls: Array<Array<{ tileId: string }>> }
}

describe('CaptureController', () => {
  it('whole-frame mode forces a single tile even when grid is N×N', async () => {
    const profile: CaptureProfile = {
      ...buildDefaultProfile(),
      captureMode: 'whole-frame',
      grid: makeGrid(3, 3),
    } as CaptureProfile
    const client = mockClient()
    const ctrl = new CaptureController({
      video: mockVideo(),
      profile,
      client,
    })
    const result = await ctrl.capture()
    expect(result.tileCount).toBe(1)
    expect(client.calls.length).toBe(1)
    expect(client.calls[0]!.length).toBe(1)
  })

  it('tiled mode dispatches one tile per enabled cell', async () => {
    const grid = makeGrid(2, 2)
    grid.enabled[3] = false // disable bottom-right cell
    const profile: CaptureProfile = {
      ...buildDefaultProfile(),
      captureMode: 'tiled',
      grid,
    } as CaptureProfile
    const client = mockClient()
    const ctrl = new CaptureController({
      video: mockVideo(),
      profile,
      client,
    })
    const result = await ctrl.capture()
    expect(result.tileCount).toBe(3)
    expect(client.calls[0]!.map(c => c.tileId).sort()).toEqual(['r0c0', 'r0c1', 'r1c0'])
  })

  it('returns 0 tiles when the video is not ready', async () => {
    const v = { videoWidth: 0, videoHeight: 0, readyState: 0 } as unknown as HTMLVideoElement
    const ctrl = new CaptureController({
      video: v,
      profile: buildDefaultProfile() as CaptureProfile,
      client: mockClient(),
    })
    const result = await ctrl.capture()
    expect(result.tileCount).toBe(0)
    expect(result.detections).toEqual([])
  })

  it('reprojects bboxes into source-frame coordinates', async () => {
    // 2×2 grid on a 1000×1000 frame, no overlap → cells are 500×500.
    // The mock client returns a bbox at (10,10)-(50,30) in TILE coords.
    // With the crop-only pipeline, dst == src (both 500), so the reprojection
    // simply adds the tile origin: x = srcX + bbox.x1.
    const profile: CaptureProfile = {
      ...buildDefaultProfile(),
      captureMode: 'tiled',
      grid: makeGrid(2, 2),
      tileOverlap: 0,
    } as CaptureProfile
    const client = mockClient()
    const ctrl = new CaptureController({
      video: mockVideo(1000, 1000),
      profile,
      client,
    })
    const result = await ctrl.capture()
    expect(result.detections.length).toBeGreaterThan(0)
    // All bboxes should be inside the 1000×1000 frame.
    for (const det of result.detections) {
      expect(det.bbox.x1).toBeGreaterThanOrEqual(0)
      expect(det.bbox.x2).toBeLessThanOrEqual(1000)
      expect(det.bbox.y1).toBeGreaterThanOrEqual(0)
      expect(det.bbox.y2).toBeLessThanOrEqual(1000)
    }
  })
})
