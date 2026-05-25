import { describe, it, expect } from 'vitest'
import { runPrefilter, type PrefilterParams } from '@/pipeline/prefilter'
import type { Detection } from '@/storage/dedup'

function makeDet(overrides: Partial<Detection> = {}): Detection {
  return {
    plate: 'ABC123',
    confidence: 0.95,
    charConfidences: [0.9, 0.92, 0.87, 0.91, 0.95, 0.96],
    bbox: { x1: 0, y1: 0, x2: 50, y2: 30 }, // area 1500
    detectorConfidence: 0.85,
    latitude: null, longitude: null,
    heading: null, speedKph: null, altitudeM: null,
    region: null, regionConfidence: null,
    timestamp: 1000,
    ...overrides,
  }
}

const baseParams: PrefilterParams = {
  minDetectorConfidence: 0.4,
  minOcrConfidence: 0.5,
  minCharConfidence: 0.3,
  minBboxAreaPx: 500,
  minPlateLen: 4,
  maxPlateLen: 10,
}

describe('runPrefilter', () => {
  it('passes a healthy detection', () => {
    const r = runPrefilter(makeDet(), baseParams)
    expect(r.verdict).toBe('pass')
    expect(r.entry.stage).toBe('prefilter')
  })

  it('suppresses on low detector confidence', () => {
    const r = runPrefilter(makeDet({ detectorConfidence: 0.2 }), baseParams)
    expect(r.verdict).toBe('suppress')
    expect(r.entry.reason).toContain('detector confidence')
  })

  it('suppresses on low OCR confidence', () => {
    const r = runPrefilter(makeDet({ confidence: 0.2 }), baseParams)
    expect(r.verdict).toBe('suppress')
    expect(r.entry.reason).toContain('OCR confidence')
  })

  it('suppresses on weak char', () => {
    const r = runPrefilter(makeDet({ charConfidences: [0.9, 0.1, 0.9] }), baseParams)
    expect(r.verdict).toBe('suppress')
    expect(r.entry.reason).toContain('char confidence')
  })

  it('suppresses on tiny bbox', () => {
    const r = runPrefilter(makeDet({ bbox: { x1: 0, y1: 0, x2: 10, y2: 10 } }), baseParams)
    expect(r.verdict).toBe('suppress')
    expect(r.entry.reason).toContain('bbox area')
  })

  it('suppresses on short plate', () => {
    const r = runPrefilter(makeDet({ plate: 'AB' }), baseParams)
    expect(r.verdict).toBe('suppress')
    expect(r.entry.reason).toContain('short')
  })

  it('suppresses on long plate', () => {
    const r = runPrefilter(makeDet({ plate: 'ABCDEFGHIJKLMN' }), baseParams)
    expect(r.verdict).toBe('suppress')
    expect(r.entry.reason).toContain('long')
  })

  it('passes with empty charConfidences (skips weakest check)', () => {
    const r = runPrefilter(makeDet({ charConfidences: [] }), baseParams)
    expect(r.verdict).toBe('pass')
  })
})
