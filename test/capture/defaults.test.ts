import { describe, it, expect } from 'vitest'
import {
  defaultsFromCapabilities,
  suggestResolution,
  makeGrid,
  resizeGrid,
  enabledCellCount,
  singleCellGrid,
  buildDefaultProfile,
} from '@/capture/profile'
import { EMPTY_CAPABILITIES, type CameraCapabilities } from '@/capture/capabilities'

describe('defaultsFromCapabilities', () => {
  it('returns null/false fallbacks when nothing is supported', () => {
    const d = defaultsFromCapabilities(EMPTY_CAPABILITIES)
    expect(d.zoom).toBeNull()
    expect(d.focusMode).toBeNull()
    expect(d.exposureMode).toBeNull()
    expect(d.exposureCompensation).toBeNull()
    expect(d.whiteBalanceMode).toBeNull()
    expect(d.torch).toBe(false)
  })

  it('picks zoom min when supported', () => {
    const caps: CameraCapabilities = {
      ...EMPTY_CAPABILITIES,
      zoom: { min: 1, max: 5, step: 0.1 },
    }
    const d = defaultsFromCapabilities(caps)
    expect(d.zoom).toBe(1)
  })

  it("prefers 'continuous' focus when listed", () => {
    const caps: CameraCapabilities = {
      ...EMPTY_CAPABILITIES,
      focusModes: ['manual', 'continuous', 'single-shot'],
    }
    expect(defaultsFromCapabilities(caps).focusMode).toBe('continuous')
  })

  it('falls back to the first available focus mode', () => {
    const caps: CameraCapabilities = {
      ...EMPTY_CAPABILITIES,
      focusModes: ['manual'],
    }
    expect(defaultsFromCapabilities(caps).focusMode).toBe('manual')
  })

  it('zeros exposure compensation when supported', () => {
    const caps: CameraCapabilities = {
      ...EMPTY_CAPABILITIES,
      exposureCompensation: { min: -3, max: 3, step: 0.33 },
    }
    expect(defaultsFromCapabilities(caps).exposureCompensation).toBe(0)
  })

  it("prefers 'auto' white balance when listed", () => {
    const caps: CameraCapabilities = {
      ...EMPTY_CAPABILITIES,
      whiteBalanceModes: ['manual', 'auto', 'sunny'],
    }
    expect(defaultsFromCapabilities(caps).whiteBalanceMode).toBe('auto')
  })
})

describe('suggestResolution', () => {
  it("returns 'max' for tiled mode", () => {
    expect(suggestResolution('tiled', { w: 384, h: 384 })).toBe('max')
  })

  it('returns 480p for whole-frame with a 384-px model', () => {
    const r = suggestResolution('whole-frame', { w: 384, h: 384 })
    expect(r).toEqual({ width: 640, height: 480 })
  })

  it('returns 720p for whole-frame with a 512-px model', () => {
    const r = suggestResolution('whole-frame', { w: 512, h: 512 })
    expect(r).toEqual({ width: 1280, height: 720 })
  })

  it('returns 1080p when the target falls between 720p and 1080p', () => {
    const r = suggestResolution('whole-frame', { w: 900, h: 900 }) // target 1350
    expect(r).toEqual({ width: 1920, height: 1080 })
  })

  it("falls through to 'max' for very large model inputs", () => {
    const r = suggestResolution('whole-frame', { w: 2000, h: 2000 })
    expect(r).toBe('max')
  })
})

describe('grid helpers', () => {
  it('singleCellGrid is 1×1 enabled', () => {
    const g = singleCellGrid()
    expect(g.cols).toBe(1)
    expect(g.rows).toBe(1)
    expect(g.enabled).toEqual([true])
  })

  it('makeGrid enables every cell', () => {
    const g = makeGrid(3, 2)
    expect(g.cols).toBe(3)
    expect(g.rows).toBe(2)
    expect(g.enabled).toEqual([true, true, true, true, true, true])
  })

  it('resizeGrid preserves overlap cells, defaults new ones to enabled', () => {
    const prev = makeGrid(2, 2)
    prev.enabled[0] = false   // disable top-left
    const next = resizeGrid(prev, 3, 3)
    expect(next.cols).toBe(3)
    expect(next.rows).toBe(3)
    // overlap region (top-left 2×2) carries forward
    expect(next.enabled[0]).toBe(false)
    expect(next.enabled[1]).toBe(true)
    expect(next.enabled[3]).toBe(true)
    // new cells default true
    expect(next.enabled[2]).toBe(true)  // top-right new col
    expect(next.enabled[6]).toBe(true)  // bottom-left new row
    expect(next.enabled[8]).toBe(true)  // bottom-right new corner
  })

  it('enabledCellCount counts non-disabled cells', () => {
    const g = makeGrid(2, 2)
    g.enabled[0] = false
    g.enabled[3] = false
    expect(enabledCellCount(g)).toBe(2)
  })
})

describe('buildDefaultProfile', () => {
  it('starts whole-frame with a 1×1 grid and 480p resolution', () => {
    const p = buildDefaultProfile()
    expect(p.captureMode).toBe('whole-frame')
    expect(p.grid).toEqual(singleCellGrid())
    expect(p.resolution).toEqual({ width: 640, height: 480 })
  })
})
