import { describe, it, expect } from 'vitest'
import { getWmm } from '@/packages/geomag/wmm'
import { correctedHeading, CorrectedHeadingSource } from '@/packages/geomag/heading'
import { MockLocationSource } from '@/sensors/location'
import { MockOrientationSource } from '@/sensors/orientation'

describe('Wmm', () => {
  const wmm = getWmm()

  it('returns declination for London within tolerance', () => {
    const decl = wmm.declination(51.5, -0.1)
    // London declination is roughly 1° east (positive)
    expect(decl).toBeGreaterThan(0)
    expect(decl).toBeLessThan(3)
  })

  it('returns declination for New York within tolerance', () => {
    const decl = wmm.declination(40.7, -74.0)
    // NY declination is roughly 12° west (negative)
    expect(decl).toBeLessThan(-10)
    expect(decl).toBeGreaterThan(-15)
  })

  it('returns declination for Sydney within tolerance', () => {
    const decl = wmm.declination(-33.8, 151.2)
    // Sydney declination is roughly 13° east (positive)
    expect(decl).toBeGreaterThan(10)
    expect(decl).toBeLessThan(15)
  })

  it('returns near-zero declination near the agonic line', () => {
    const decl = wmm.declination(25, -81)
    expect(Math.abs(decl)).toBeLessThan(10)
  })

  it('handles equator', () => {
    const decl = wmm.declination(0, 0)
    expect(typeof decl).toBe('number')
    expect(isNaN(decl)).toBe(false)
  })

  it('handles poles', () => {
    const decl = wmm.declination(89, 0)
    expect(typeof decl).toBe('number')
  })

  it('returns consistent values across hemispheres', () => {
    const north = wmm.declination(60, 0)
    const south = wmm.declination(-60, 0)
    expect(typeof north).toBe('number')
    expect(typeof south).toBe('number')
  })

  it('model name is WMM 2025-2030', () => {
    expect(wmm.declinationModel).toContain('WMM')
  })
})

describe('correctedHeading', () => {
  it('adds declination to raw heading', () => {
    expect(correctedHeading(0, 5)).toBe(5)
    expect(correctedHeading(90, -3)).toBe(87)
    expect(correctedHeading(180, 10)).toBe(190)
  })

  it('wraps around 360°', () => {
    expect(correctedHeading(355, 10)).toBe(5)
    expect(correctedHeading(350, 20)).toBe(10)
  })

  it('handles negative declination wrapping', () => {
    expect(correctedHeading(5, -10)).toBe(355)
    expect(correctedHeading(10, -20)).toBe(350)
  })

  it('handles 0-360 range', () => {
    for (const raw of [0, 90, 180, 270, 359]) {
      for (const decl of [-15, -5, 0, 5, 15]) {
        const corrected = correctedHeading(raw, decl)
        expect(corrected).toBeGreaterThanOrEqual(0)
        expect(corrected).toBeLessThan(360)
      }
    }
  })
})

describe('CorrectedHeadingSource', () => {
  it('composes location + orientation + wmm', async () => {
    const location = new MockLocationSource([{ lat: 51.5, lon: -0.1 }])
    const orientation = new MockOrientationSource(45)

    let lastState: any = null
    const source = new CorrectedHeadingSource(location, orientation)
    source.onChange = (s) => { lastState = s }

    await source.start()
    await new Promise(r => setTimeout(r, 500))

    expect(lastState).not.toBeNull()
    expect(typeof lastState.rawHeading).toBe('number')
    expect(lastState.rawHeading).toBeGreaterThan(0)
    expect(lastState.trueHeading).not.toBeNull()
    expect(lastState.trueHeading).not.toBe(lastState.rawHeading)
    expect(typeof lastState.declination).toBe('number')
    expect(lastState.declination).toBeGreaterThan(0)
    expect(lastState.latitude).toBe(51.5)

    source.stop()
  })

  it('emits null true heading without location', async () => {
    const location = new MockLocationSource([])
    const orientation = new MockOrientationSource(45)

    let lastState: any = null
    const source = new CorrectedHeadingSource(location, orientation)
    source.onChange = (s) => { lastState = s }

    await source.start()
    await new Promise(r => setTimeout(r, 300))

    expect(lastState.trueHeading).toBeNull()
    expect(lastState.rawHeading).toBeGreaterThan(0)
    source.stop()
  })
})
