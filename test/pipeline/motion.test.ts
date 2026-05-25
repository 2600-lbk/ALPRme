import { describe, it, expect } from 'vitest'
import { MotionTracker, type MotionParams } from '@/pipeline/motion'
import type { Detection } from '@/storage/dedup'

function makeDet(overrides: Partial<Detection> = {}): Detection {
  return {
    plate: 'ABC123',
    confidence: 0.8,
    charConfidences: [],
    bbox: { x1: 100, y1: 100, x2: 200, y2: 150 }, // center (150, 125)
    detectorConfidence: 0.85,
    latitude: null, longitude: null,
    heading: null,
    speedKph: 0,
    altitudeM: null,
    region: null, regionConfidence: null,
    timestamp: 1000,
    ...overrides,
  }
}

const params: MotionParams = {
  stationarySpeedThresholdKph: 5,
  bboxDriftMaxStationaryPx: 30,
  motionWindowMs: 3000,
  fuzzyDistance: 1,
}

describe('MotionTracker', () => {
  it('passes any first observation', () => {
    const m = new MotionTracker(params)
    const r = m.process(makeDet())
    expect(r.verdict).toBe('pass')
  })

  it('passes stationary observations with tight drift', () => {
    const m = new MotionTracker(params)
    m.process(makeDet({ timestamp: 1000 }))
    const r = m.process(makeDet({
      timestamp: 1200,
      bbox: { x1: 105, y1: 105, x2: 205, y2: 155 }, // center (155, 130), drift ~7px
    }))
    expect(r.verdict).toBe('pass')
  })

  it('suppresses stationary observations with large drift', () => {
    const m = new MotionTracker(params)
    m.process(makeDet({ timestamp: 1000 }))
    const r = m.process(makeDet({
      timestamp: 1200,
      bbox: { x1: 400, y1: 400, x2: 500, y2: 450 }, // center (450, 425), drift ~424px
    }))
    expect(r.verdict).toBe('suppress')
    expect(r.entry.reason).toContain('drift')
  })

  it('does not gate when device is moving', () => {
    const m = new MotionTracker(params)
    m.process(makeDet({ timestamp: 1000, speedKph: 30 }))
    const r = m.process(makeDet({
      timestamp: 1200, speedKph: 30,
      bbox: { x1: 400, y1: 400, x2: 500, y2: 450 },
    }))
    expect(r.verdict).toBe('pass')
  })

  it('does not gate when speed is unknown', () => {
    const m = new MotionTracker(params)
    m.process(makeDet({ timestamp: 1000, speedKph: null }))
    const r = m.process(makeDet({
      timestamp: 1200, speedKph: null,
      bbox: { x1: 400, y1: 400, x2: 500, y2: 450 },
    }))
    expect(r.verdict).toBe('pass')
  })

  it('expires old observations outside the motion window', () => {
    const m = new MotionTracker(params)
    m.process(makeDet({ timestamp: 1000 }))
    // 5 seconds later, old obs has expired — no prior to compare against.
    const r = m.process(makeDet({
      timestamp: 6000,
      bbox: { x1: 400, y1: 400, x2: 500, y2: 450 },
    }))
    expect(r.verdict).toBe('pass')
  })
})
