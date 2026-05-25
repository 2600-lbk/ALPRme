import { describe, it, expect } from 'vitest'
import { Stabilizer, type StabilizerParams } from '@/pipeline/stabilizer'
import type { Detection } from '@/storage/dedup'

function makeDet(overrides: Partial<Detection> = {}): Detection {
  return {
    plate: 'ABC123',
    confidence: 0.8,
    charConfidences: [],
    bbox: { x1: 0, y1: 0, x2: 50, y2: 30 },
    detectorConfidence: 0.85,
    latitude: null, longitude: null,
    heading: null, speedKph: null, altitudeM: null,
    region: null, regionConfidence: null,
    timestamp: 1000,
    ...overrides,
  }
}

const params: StabilizerParams = {
  stabilizerWindowMs: 1000,
  consensusK: 2,
  consensusN: 4,
  fuzzyDistance: 1,
}

describe('Stabilizer', () => {
  it('holds first frame, emits on second (K=2)', () => {
    const s = new Stabilizer(params)
    const r1 = s.process(makeDet({ timestamp: 1000, confidence: 0.7 }))
    expect(r1.verdict).toBe('hold')
    const r2 = s.process(makeDet({ timestamp: 1100, confidence: 0.9 }))
    expect(r2.verdict).toBe('emit')
    // Emitted detection should be the peak (the higher-confidence second frame).
    expect(r2.emittedDetection?.confidence).toBe(0.9)
  })

  it('emits earlier peak when later frame triggers consensus but is lower', () => {
    const s = new Stabilizer(params)
    s.process(makeDet({ timestamp: 1000, confidence: 0.95 })) // hold (peak)
    const r2 = s.process(makeDet({ timestamp: 1100, confidence: 0.6 })) // emit
    expect(r2.verdict).toBe('emit')
    expect(r2.emittedDetection?.confidence).toBe(0.95)
  })

  it('does not re-emit on subsequent same-conf frames', () => {
    const s = new Stabilizer(params)
    s.process(makeDet({ timestamp: 1000, confidence: 0.8 }))
    s.process(makeDet({ timestamp: 1100, confidence: 0.8 })) // emit
    const r3 = s.process(makeDet({ timestamp: 1200, confidence: 0.7 }))
    expect(r3.verdict).toBe('hold')
  })

  it('re-emits when a strictly better reading lands', () => {
    const s = new Stabilizer(params)
    s.process(makeDet({ timestamp: 1000, confidence: 0.7 }))
    s.process(makeDet({ timestamp: 1100, confidence: 0.7 })) // emit at 0.7 peak
    const r3 = s.process(makeDet({ timestamp: 1200, confidence: 0.99 }))
    expect(r3.verdict).toBe('emit')
    expect(r3.emittedDetection?.confidence).toBe(0.99)
  })

  it('drops candidates that fall out of the window', () => {
    const s = new Stabilizer({ ...params, consensusK: 3 })
    s.process(makeDet({ timestamp: 1000, confidence: 0.7 }))
    s.process(makeDet({ timestamp: 1100, confidence: 0.7 }))
    // Long gap: the first two frames expire.
    const r3 = s.process(makeDet({ timestamp: 5000, confidence: 0.7 }))
    expect(r3.verdict).toBe('hold')
    // Candidate has only the latest frame now.
    expect(s.inspect()[0]?.frames.length).toBe(1)
  })

  it('groups fuzzy plate variants into one candidate', () => {
    const s = new Stabilizer(params)
    s.process(makeDet({ plate: 'ABC123', timestamp: 1000, confidence: 0.7 }))
    const r2 = s.process(makeDet({ plate: 'A8C123', timestamp: 1100, confidence: 0.85 }))
    expect(r2.verdict).toBe('emit')
    // Single candidate, not two.
    expect(s.inspect().length).toBe(1)
  })

  it('does not group when distance exceeds fuzzyDistance', () => {
    const s = new Stabilizer(params)
    s.process(makeDet({ plate: 'ABC123', timestamp: 1000 }))
    s.process(makeDet({ plate: 'XYZ987', timestamp: 1100 }))
    expect(s.inspect().length).toBe(2)
  })

  it('reset clears state', () => {
    const s = new Stabilizer(params)
    s.process(makeDet({ timestamp: 1000 }))
    s.reset()
    expect(s.inspect().length).toBe(0)
  })
})
