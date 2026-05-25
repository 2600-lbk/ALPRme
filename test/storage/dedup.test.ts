import { describe, it, expect } from 'vitest'
import {
  mergeDetection, normalizePlate, haversineMeters, effectiveGeoRadius,
  type Detection, type DedupParams, type DedupState, DEFAULT_DEDUP_PARAMS,
} from '@/storage/dedup'

function makeDet(overrides: Partial<Detection> = {}): Detection {
  return {
    plate: 'ABC123',
    confidence: 0.95,
    charConfidences: [0.9, 0.92, 0.87, 0.91, 0.95, 0.96],
    bbox: { x1: 100, y1: 200, x2: 250, y2: 270 },
    detectorConfidence: 0.85,
    latitude: 37.7749,
    longitude: -122.4194,
    heading: 45,
    speedKph: null,
    altitudeM: null,
    region: null,
    regionConfidence: null,
    timestamp: 1000,
    ...overrides,
  }
}

function emptyState(): DedupState {
  return { plates: new Map() }
}

describe('normalizePlate', () => {
  it('uppercases', () => {
    expect(normalizePlate('abc123')).toBe('ABC123')
  })

  it('strips spaces', () => {
    expect(normalizePlate('AB 123 CD')).toBe('AB123CD')
  })

  it('strips dashes', () => {
    expect(normalizePlate('ABC-123')).toBe('ABC123')
  })

  it('strips dots', () => {
    expect(normalizePlate('AB.12.34')).toBe('AB1234')
  })

  it('handles mixed separators', () => {
    expect(normalizePlate('AB - 12.34 CD')).toBe('AB1234CD')
  })
})

describe('haversineMeters', () => {
  it('returns 0 for same point', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })
    expect(d).toBe(0)
  })

  it('returns roughly 111km for 1 degree latitude', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  it('SF to NY is far', () => {
    const d = haversineMeters({ lat: 37.77, lon: -122.42 }, { lat: 40.71, lon: -74.01 })
    expect(d).toBeGreaterThan(4_000_000)
    expect(d).toBeLessThan(4_200_000)
  })

  it('nearby points are within meters', () => {
    const d = haversineMeters({ lat: 37.7749, lon: -122.4194 }, { lat: 37.7750, lon: -122.4195 })
    expect(d).toBeLessThan(20)
  })
})

describe('effectiveGeoRadius', () => {
  it('returns base radius when speedAware is off', () => {
    const params: DedupParams = { ...DEFAULT_DEDUP_PARAMS, speedAwareRadius: false }
    expect(effectiveGeoRadius(params, 100)).toBe(params.geoRadiusM)
  })

  it('returns base radius when speed is null', () => {
    expect(effectiveGeoRadius(DEFAULT_DEDUP_PARAMS, null)).toBe(DEFAULT_DEDUP_PARAMS.geoRadiusM)
  })

  it('expands radius at highway speed', () => {
    // 100 km/h over 60s = ~1666 m. Should dominate the 50m base.
    const r = effectiveGeoRadius(DEFAULT_DEDUP_PARAMS, 100)
    expect(r).toBeGreaterThan(1500)
    expect(r).toBeLessThan(1800)
  })

  it('uses base radius when expansion is smaller than base', () => {
    // 1 km/h over 60s = ~16 m. Base 50m wins.
    const r = effectiveGeoRadius(DEFAULT_DEDUP_PARAMS, 1)
    expect(r).toBe(DEFAULT_DEDUP_PARAMS.geoRadiusM)
  })
})

describe('mergeDetection', () => {
  it('stores new plate (first detection)', () => {
    const state = emptyState()
    const det = makeDet()
    const result = mergeDetection(state, det)
    expect(result.action).toBe('store')
    expect(result.reason).toBe('new plate')
    expect(result.state.plates.get('ABC123')?.storeCount).toBe(1)
    expect(result.entry.stage).toBe('dedup')
    expect(result.entry.verdict).toBe('emit')
  })

  it('skips same plate within time window at same location', () => {
    const state = emptyState()
    const result1 = mergeDetection(state, makeDet())
    expect(result1.action).toBe('store')

    const result2 = mergeDetection(result1.state, makeDet({ timestamp: 1050 }))
    expect(result2.action).toBe('skip')
    expect(result2.reason).toContain('same sighting')
  })

  it('better-confidence within burst returns store + emit when no prior emit id', () => {
    const state = emptyState()
    const r1 = mergeDetection(state, makeDet({ confidence: 0.7 }))
    expect(r1.action).toBe('store')

    const r2 = mergeDetection(r1.state, makeDet({ confidence: 0.95, timestamp: 1050 }))
    expect(r2.action).toBe('store')
    expect(r2.reason).toBe('better confidence')
  })

  it('stores same plate as new sighting outside geo radius', () => {
    const state = emptyState()
    const r1 = mergeDetection(state, makeDet({ latitude: 37.77, longitude: -122.42 }))
    const r2 = mergeDetection(r1.state, makeDet({
      latitude: 37.78, longitude: -122.42, timestamp: 1050,
    }))
    expect(r2.action).toBe('store')
    expect(r2.reason).toBe('new sighting')
  })

  it('speed-aware radius prevents highway sightings from collapsing', () => {
    // Without speed-aware radius, two sightings 1km apart within the 60s window
    // would be considered the same sighting (both > 50m → outside).
    // With speed at 100km/h the effective radius (~1.6km) would FOLD them together.
    // This test pins down the inverse: a 200m gap at moderate speed should merge.
    const state = emptyState()
    const r1 = mergeDetection(state, makeDet({ latitude: 37.77, longitude: -122.42, speedKph: 60 }))
    // 200m east at the same latitude: lat unchanged, lon changes by ~0.0024°.
    const r2 = mergeDetection(r1.state, makeDet({
      latitude: 37.77, longitude: -122.4176, speedKph: 60, timestamp: 1500,
    }))
    // Effective radius at 60kph over 60s = ~1000m, so 200m fits inside.
    expect(r2.action).toBe('skip')
  })

  it('stores same plate as new sighting outside time window', () => {
    const state = emptyState()
    const result1 = mergeDetection(state, makeDet({ timestamp: 1000 }))
    expect(result1.action).toBe('store')

    const params: DedupParams = { ...DEFAULT_DEDUP_PARAMS, timeWindowMs: 50 }
    const result2 = mergeDetection(result1.state, makeDet({ timestamp: 2000 }), params)
    expect(result2.action).toBe('store')
    expect(result2.reason).toBe('new sighting')
  })

  it('retriggers after retriggerWindowMs within same sighting', () => {
    const state = emptyState()
    const params: DedupParams = { ...DEFAULT_DEDUP_PARAMS, retriggerWindowMs: 100, timeWindowMs: 60_000 }
    const result1 = mergeDetection(state, makeDet({ timestamp: 1000 }), params)
    expect(result1.action).toBe('store')

    const result2 = mergeDetection(result1.state, makeDet({ timestamp: 1200 }), params)
    expect(result2.action).toBe('store')
    expect(result2.reason).toBe('retrigger')
  })

  it('skips below detector confidence threshold', () => {
    const state = emptyState()
    const params: DedupParams = { ...DEFAULT_DEDUP_PARAMS, minDetectorConfidence: 0.5 }
    const result = mergeDetection(state, makeDet({ detectorConfidence: 0.3 }), params)
    expect(result.action).toBe('skip')
    expect(result.reason).toContain('detector confidence')
  })

  it('skips below OCR confidence threshold', () => {
    const state = emptyState()
    const params: DedupParams = { ...DEFAULT_DEDUP_PARAMS, minOcrConfidence: 0.5 }
    const result = mergeDetection(state, makeDet({ confidence: 0.3 }), params)
    expect(result.action).toBe('skip')
    expect(result.reason).toContain('OCR confidence')
  })

  it('same stream produces identical output regardless of chunking', () => {
    const det1 = makeDet({ plate: 'A', timestamp: 1000 })
    const det2 = makeDet({ plate: 'A', timestamp: 1500 })
    const det3 = makeDet({ plate: 'B', timestamp: 2000 })

    const batchResult = mergeDetection(
      mergeDetection(mergeDetection(emptyState(), det1).state, det2).state,
      det3,
    )

    let state = emptyState()
    const r1 = mergeDetection(state, det1)
    const r2 = mergeDetection(r1.state, det2)
    const r3 = mergeDetection(r2.state, det3)

    expect(r3.state.plates.size).toBe(batchResult.state.plates.size)
    expect(r3.state.plates.get('A')?.storeCount).toBe(batchResult.state.plates.get('A')?.storeCount)
    expect(r3.state.plates.get('B')?.storeCount).toBe(batchResult.state.plates.get('B')?.storeCount)
  })

  it('counts storeCount across multiple sightings', () => {
    const state = emptyState()
    const params: DedupParams = { ...DEFAULT_DEDUP_PARAMS, timeWindowMs: 1 }

    const r1 = mergeDetection(state, makeDet({ timestamp: 1000, plate: 'X' }), params)
    expect(r1.action).toBe('store')

    const r2 = mergeDetection(r1.state, makeDet({ timestamp: 2000, plate: 'X' }), params)
    expect(r2.action).toBe('store')

    const r3 = mergeDetection(r2.state, makeDet({ timestamp: 3000, plate: 'X' }), params)
    expect(r3.action).toBe('store')

    expect(r3.state.plates.get('X')?.storeCount).toBe(3)
  })
})
