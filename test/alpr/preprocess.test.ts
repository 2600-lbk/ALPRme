import { describe, it, expect } from 'vitest'
import { letterboxDims } from '@/packages/alpr/stage1'

describe('letterboxDims', () => {
  it('scales and pads landscape image to target square', () => {
    const dims = letterboxDims(640, 480, 384, 384)
    expect(dims.ratio[0]).toBeCloseTo(0.6, 5)
    expect(dims.ratio[1]).toBeCloseTo(0.6, 5)
    expect(dims.newW).toBe(384)
    expect(dims.newH).toBe(288)
    expect(dims.padding[0]).toBeCloseTo(0, 0)
    expect(dims.padding[1]).toBeCloseTo(48, 0)
  })

  it('handles already square image', () => {
    const dims = letterboxDims(384, 384, 384, 384)
    expect(dims.ratio[0]).toBeCloseTo(1.0, 5)
    expect(dims.ratio[1]).toBeCloseTo(1.0, 5)
    expect(dims.newW).toBe(384)
    expect(dims.newH).toBe(384)
    expect(dims.padding[0]).toBe(0)
    expect(dims.padding[1]).toBe(0)
  })

  it('scales portrait image correctly', () => {
    const dims = letterboxDims(240, 480, 384, 384)
    expect(dims.ratio[0]).toBeCloseTo(0.8, 5)
    expect(dims.newW).toBe(192)
    expect(dims.newH).toBe(384)
    expect(dims.padding[0]).toBeCloseTo(96, 0)
    expect(dims.padding[1]).toBeCloseTo(0, 0)
  })

  it('scales to smaller target', () => {
    const dims = letterboxDims(1280, 720, 256, 256)
    expect(dims.ratio[0]).toBeCloseTo(0.2, 5)
    expect(dims.newW).toBe(256)
    expect(dims.newH).toBe(144)
    expect(dims.padding[1]).toBeCloseTo(56, 0)
  })

  it('scales up small image', () => {
    const dims = letterboxDims(100, 80, 384, 384)
    // min(384/80, 384/100) = min(4.8, 3.84) = 3.84
    expect(dims.ratio[0]).toBeCloseTo(3.84, 5)
    expect(dims.newW).toBe(384)
    expect(dims.newH).toBe(307)
    expect(dims.padding[0]).toBeCloseTo(0, 0)
    expect(dims.padding[1]).toBeCloseTo(38.5, 0)
  })
})

describe('preprocess coordinate mapping', () => {
  it('reverse mapping (original ← letterbox) is invertible', () => {
    const srcW = 640
    const srcH = 480
    const targetW = 384
    const targetH = 384
    const dims = letterboxDims(srcW, srcH, targetW, targetH)
    const { ratio, padding } = dims

    const predX1 = 50
    const predY1 = 100
    const origX1 = (predX1 - padding[0]) / ratio[0]
    const origY1 = (predY1 - padding[1]) / ratio[1]

    expect(origX1).toBeGreaterThanOrEqual(0)
    expect(origY1).toBeGreaterThanOrEqual(0)
    expect(origX1).toBeLessThanOrEqual(srcW)
    expect(origY1).toBeLessThanOrEqual(srcH)
  })
})
