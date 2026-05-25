import { describe, it, expect } from 'vitest'
import { detectionsToGeoJson, detectionsToCsv } from '@/storage/export'
import type { DetectionRecord, SessionRecord } from '@/storage/db'

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 1,
    startedAt: 1700000000000,
    endedAt: 1700003600000,
    keepCrops: false,
    ...overrides,
  }
}

function makeDet(overrides: Partial<DetectionRecord> = {}): DetectionRecord {
  return {
    id: 1,
    sessionId: 1,
    plate: 'ABC123',
    confidence: 0.95,
    charConfidences: [0.98, 0.92, 0.87, 0.91, 0.95, 0.96],
    bbox: { x1: 100, y1: 200, x2: 250, y2: 270 },
    detectorConfidence: 0.85,
    latitude: 37.7749,
    longitude: -122.4194,
    heading: 45,
    speedKph: null,
    altitudeM: null,
    region: 'United States',
    regionConfidence: 0.99,
    timestamp: 1700000100000,
    ...overrides,
  }
}

describe('detectionsToGeoJson', () => {
  it('produces valid FeatureCollection', () => {
    const session = makeSession()
    const dets = [makeDet()]
    const fc = detectionsToGeoJson(session, dets)

    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features.length).toBe(1)
    expect(fc.features[0]!.type).toBe('Feature')
    expect(fc.features[0]!.geometry.type).toBe('Point')
  })

  it('maps coordinates in GeoJSON order [lon, lat]', () => {
    const dets = [makeDet({ latitude: 51.5, longitude: -0.1 })]
    const fc = detectionsToGeoJson(makeSession(), dets)

    const coords = fc.features[0]!.geometry.coordinates as [number, number]
    expect(coords[0]).toBe(-0.1)
    expect(coords[1]).toBe(51.5)
  })

  it('handles null coordinates (empty array)', () => {
    const dets = [makeDet({ latitude: null, longitude: null })]
    const fc = detectionsToGeoJson(makeSession(), dets)

    const coords = fc.features[0]!.geometry.coordinates
    expect(coords).toEqual([])
  })

  it('includes session metadata in properties', () => {
    const dets = [makeDet()]
    const fc = detectionsToGeoJson(makeSession(), dets)
    const props = fc.features[0]!.properties

    expect(props.plate).toBe('ABC123')
    expect(props.confidence).toBe(0.95)
    expect(typeof props.timestamp).toBe('string')
    expect(props.sessionId).toBe(1)
  })

  it('handles empty detections', () => {
    const fc = detectionsToGeoJson(makeSession(), [])
    expect(fc.features.length).toBe(0)
  })
})

describe('detectionsToCsv', () => {
  it('produces header row', () => {
    const csv = detectionsToCsv([])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('plate')
    expect(lines[0]).toContain('confidence')
    expect(lines[0]).toContain('timestamp')
  })

  it('serializes single detection', () => {
    const csv = detectionsToCsv([makeDet()])
    const lines = csv.split('\n')
    expect(lines.length).toBe(2)
    expect(lines[1]).toContain('ABC123')
    expect(lines[1]).toContain('0.95')
  })

  it('escapes commas in plate text', () => {
    const csv = detectionsToCsv([makeDet({ plate: 'AB,CD' })])
    const lines = csv.split('\n')
    expect(lines[1]).toContain('"AB,CD"')
  })

  it('escapes double quotes in plate text', () => {
    const csv = detectionsToCsv([makeDet({ plate: 'AB"CD' })])
    const lines = csv.split('\n')
    expect(lines[1]).toContain('"AB""CD"')
  })

  it('handles multiple detections', () => {
    const csv = detectionsToCsv([makeDet(), makeDet({ plate: 'XYZ', timestamp: 1700000200000 })])
    const lines = csv.split('\n')
    expect(lines.length).toBe(3)
  })

  it('handles null heading and region', () => {
    const csv = detectionsToCsv([makeDet({ heading: null, region: null, regionConfidence: null })])
    const lines = csv.split('\n')
    expect(lines[1]).toContain(',,')
  })
})
