import { describe, it, expect } from 'vitest'
import { Pipeline, type PipelineParams } from '@/pipeline'
import { FILTER_PRESETS } from '@/pipeline/presets'
import type { Detection } from '@/storage/dedup'

function makeDet(overrides: Partial<Detection> = {}): Detection {
  return {
    plate: 'ABC123',
    confidence: 0.85,
    charConfidences: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
    bbox: { x1: 100, y1: 100, x2: 200, y2: 150 },
    detectorConfidence: 0.7,
    latitude: 37.77,
    longitude: -122.42,
    heading: null,
    speedKph: 0,
    altitudeM: null,
    region: null, regionConfidence: null,
    timestamp: 1000,
    ...overrides,
  }
}

function runStream(p: Pipeline, dets: Detection[]) {
  return dets.map(d => p.process(d))
}

describe('Pipeline scenarios', () => {
  it('stationary camera: same plate every 250ms for 30 frames → one emit', () => {
    const p = new Pipeline(FILTER_PRESETS.balanced)
    const dets: Detection[] = []
    for (let i = 0; i < 30; i++) {
      dets.push(makeDet({
        timestamp: 1000 + i * 250,
        confidence: 0.85 + (i === 5 ? 0.1 : 0), // peak at frame 5
        bbox: { x1: 100 + i % 3, y1: 100, x2: 200 + i % 3, y2: 150 }, // jitter
      }))
    }
    const results = runStream(p, dets)
    const emits = results.filter(r => r.verdict === 'emit' || r.verdict === 'update')
    // First burst should emit exactly once (stabilizer + dedup); a stronger reading
    // at frame 5 may trigger one update.
    expect(emits.length).toBeGreaterThanOrEqual(1)
    expect(emits.length).toBeLessThanOrEqual(2)
  })

  it('city driving: A appears 5x then B appears 4x → two emits', () => {
    const p = new Pipeline(FILTER_PRESETS.balanced)
    const dets: Detection[] = []
    for (let i = 0; i < 5; i++) {
      dets.push(makeDet({
        plate: 'AAA111', timestamp: 1000 + i * 250, speedKph: 30,
        latitude: 37.77 + i * 0.0001, longitude: -122.42,
      }))
    }
    for (let i = 0; i < 4; i++) {
      dets.push(makeDet({
        plate: 'BBB222', timestamp: 2500 + i * 250, speedKph: 30,
        latitude: 37.77 + (i + 5) * 0.0001, longitude: -122.42,
      }))
    }
    const results = runStream(p, dets)
    const emits = results.filter(r => r.verdict === 'emit')
    const emittedPlates = new Set(emits.map(r => r.detection.plate))
    expect(emittedPlates.has('AAA111')).toBe(true)
    expect(emittedPlates.has('BBB222')).toBe(true)
  })

  it('city driving: 1-frame OCR blip below consensus K is suppressed', () => {
    const p = new Pipeline(FILTER_PRESETS.balanced) // K=2
    const r = p.process(makeDet({ plate: 'XYZ999', timestamp: 1000, speedKph: 30 }))
    expect(r.verdict).toBe('suppress') // held
  })

  it('highway: same plate twice in 2s, then again 8s later 200m away → two emits', () => {
    // Use balanced preset but loosen K=1 so a single sighting can emit immediately.
    const params: PipelineParams = { ...FILTER_PRESETS.balanced, consensusK: 1, consensusN: 1, stabilizerWindowMs: 500 }
    const p = new Pipeline(params)

    // Burst 1 at lat 37.77 / 100 kph
    const r1 = p.process(makeDet({ plate: 'HWY100', timestamp: 1000, speedKph: 100, latitude: 37.77, longitude: -122.42 }))
    const r2 = p.process(makeDet({ plate: 'HWY100', timestamp: 1500, speedKph: 100, latitude: 37.77, longitude: -122.4198 }))
    // Burst 2: 8s later, 200m further at 100kph. With speed-aware radius (~1.6km at
    // 60s window) this would *merge* into the same sighting; but with a *short* time
    // window the second burst is treated as new.
    const tightParams: PipelineParams = { ...params, timeWindowMs: 5000 }
    const p2 = new Pipeline(tightParams)
    p2.process(makeDet({ plate: 'HWY100', timestamp: 1000, speedKph: 100, latitude: 37.77, longitude: -122.42 }))
    p2.process(makeDet({ plate: 'HWY100', timestamp: 1500, speedKph: 100, latitude: 37.77, longitude: -122.4198 }))
    const r3 = p2.process(makeDet({ plate: 'HWY100', timestamp: 10000, speedKph: 100, latitude: 37.77, longitude: -122.4180 }))

    expect(r1.verdict).toBe('emit')
    // r2 is held by dedup (same sighting)
    expect(r2.verdict).toBe('suppress')
    expect(r3.verdict).toBe('emit') // new sighting outside time window
  })

  it('diagnostic-style: logAll preset emits every detection with traces', () => {
    const p = new Pipeline(FILTER_PRESETS.logAll)
    const dets: Detection[] = []
    for (let i = 0; i < 6; i++) {
      dets.push(makeDet({ plate: 'LOG' + i, timestamp: 1000 + i * 100 }))
    }
    const results = runStream(p, dets)
    expect(results.every(r => r.verdict === 'emit')).toBe(true)
    expect(results.every(r => r.trace.length >= 4)).toBe(true)
  })

  it('every result carries a non-empty trace', () => {
    const p = new Pipeline(FILTER_PRESETS.balanced)
    const r = p.process(makeDet({ confidence: 0.1 })) // suppressed at prefilter
    expect(r.trace.length).toBeGreaterThan(0)
    expect(r.trace[0]!.stage).toBe('prefilter')
    expect(r.trace[0]!.verdict).toBe('suppress')
  })

  it('better-confidence reading produces an update with a target id', () => {
    const params: PipelineParams = { ...FILTER_PRESETS.balanced, consensusK: 1, consensusN: 1 }
    const p = new Pipeline(params)

    const r1 = p.process(makeDet({ confidence: 0.6, timestamp: 1000 }))
    expect(r1.verdict).toBe('emit')
    p.noteEmittedId(r1.detection.plate, 999)

    const r2 = p.process(makeDet({ confidence: 0.95, timestamp: 1500 }))
    expect(r2.verdict).toBe('update')
    expect(r2.updateTargetId).toBe(999)
  })

  it('flushPending commits candidates that were held below K-of-N', () => {
    // K=3, but only 2 frames seen — stabilizer would normally never emit.
    const params: PipelineParams = { ...FILTER_PRESETS.balanced, consensusK: 3, consensusN: 4 }
    const p = new Pipeline(params)

    const r1 = p.process(makeDet({ plate: 'PEND01', timestamp: 1000, confidence: 0.7 }))
    const r2 = p.process(makeDet({ plate: 'PEND01', timestamp: 1100, confidence: 0.85 }))
    expect(r1.verdict).toBe('suppress') // held
    expect(r2.verdict).toBe('suppress') // still held (only 2 of 3)

    const flushed = p.flushPending()
    expect(flushed.length).toBe(1)
    expect(flushed[0]!.verdict).toBe('emit')
    expect(flushed[0]!.detection.plate).toBe('PEND01')
    // Peak confidence wins.
    expect(flushed[0]!.detection.confidence).toBe(0.85)
    // Trace records the flush.
    expect(flushed[0]!.trace.some(e => e.reason.includes('flushed'))).toBe(true)
  })

  it('flushPending returns empty when no candidates are pending', () => {
    const params: PipelineParams = { ...FILTER_PRESETS.balanced, consensusK: 1, consensusN: 1 }
    const p = new Pipeline(params)
    p.process(makeDet({ timestamp: 1000 })) // emits immediately
    expect(p.flushPending().length).toBe(0)
  })
})
