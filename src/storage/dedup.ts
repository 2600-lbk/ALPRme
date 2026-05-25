import { emit, hold, type DecisionEntry } from '@/pipeline/trace'

export interface BBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Detection {
  plate: string
  confidence: number
  charConfidences: number[]
  bbox: BBox
  detectorConfidence: number
  latitude: number | null
  longitude: number | null
  heading: number | null
  speedKph: number | null
  altitudeM: number | null
  region: string | null
  regionConfidence: number | null
  timestamp: number
}

export interface DedupParams {
  timeWindowMs: number
  geoRadiusM: number
  minDetectorConfidence: number
  minOcrConfidence: number
  retriggerWindowMs: number
  retriggerRadiusM: number
  /** When true, expand effective geo radius by the distance the camera could travel
   *  within timeWindowMs at current speed. Prevents highway sightings from being
   *  spuriously merged across long distances. */
  speedAwareRadius: boolean
}

export const DEFAULT_DEDUP_PARAMS: DedupParams = {
  timeWindowMs: 60_000,
  geoRadiusM: 50,
  minDetectorConfidence: 0,
  minOcrConfidence: 0,
  retriggerWindowMs: 300_000,
  retriggerRadiusM: 500,
  speedAwareRadius: true,
}

export interface PlateRecord {
  plate: string
  firstSeen: number
  lastSeen: number
  bestConfidence: number
  bestLocation: { lat: number; lon: number } | null
  lastLocation: { lat: number; lon: number } | null
  storeCount: number
  /** DB row id of the most recently emitted record for this plate-burst. Lets the
   *  caller UPDATE rather than INSERT when a better-confidence reading lands. */
  lastEmittedId: number | null
}

export interface DedupState {
  plates: Map<string, PlateRecord>
}

export type DedupAction = 'store' | 'update' | 'skip'

export interface DedupResult {
  state: DedupState
  action: DedupAction
  reason: string
  entry: DecisionEntry
  /** When action==='update', the id of the prior DB row to update in place. */
  updateTargetId: number | null
}

export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s\-\.]/g, '')
}

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const aVal = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLon * sinDLon
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal))
}

export function effectiveGeoRadius(params: DedupParams, speedKph: number | null): number {
  if (!params.speedAwareRadius) return params.geoRadiusM
  if (speedKph == null || speedKph <= 0) return params.geoRadiusM
  // Distance traveled (meters) within the dedup time window at this speed.
  const traveled = (speedKph * 1000 / 3600) * (params.timeWindowMs / 1000)
  return Math.max(params.geoRadiusM, traveled)
}

/**
 * Sighting-level dedup. Decides whether a detection is:
 *   - a brand-new sighting        → action: 'store'
 *   - a stronger reading of one
 *     we already stored in this
 *     burst                       → action: 'update' (with updateTargetId)
 *   - a redundant copy within
 *     the time/geo window         → action: 'skip'
 *
 * Speed-aware geo radius expands when the device is moving so that a 50m radius at
 * highway speed doesn't try to fold separate sightings together.
 */
export function mergeDetection(
  state: DedupState,
  detection: Detection,
  params: DedupParams = DEFAULT_DEDUP_PARAMS,
): DedupResult {
  const { plates } = state
  const key = normalizePlate(detection.plate)

  if (detection.detectorConfidence < params.minDetectorConfidence) {
    return {
      state,
      action: 'skip',
      reason: 'detector confidence below threshold',
      entry: hold('dedup', 'detector confidence below dedup floor', detection.detectorConfidence, params.minDetectorConfidence),
      updateTargetId: null,
    }
  }
  if (detection.confidence < params.minOcrConfidence) {
    return {
      state,
      action: 'skip',
      reason: 'OCR confidence below threshold',
      entry: hold('dedup', 'OCR confidence below dedup floor', detection.confidence, params.minOcrConfidence),
      updateTargetId: null,
    }
  }

  const loc = (detection.latitude != null && detection.longitude != null)
    ? { lat: detection.latitude, lon: detection.longitude }
    : null

  const radius = effectiveGeoRadius(params, detection.speedKph)
  const existing = plates.get(key)

  if (!existing) {
    const record: PlateRecord = {
      plate: key,
      firstSeen: detection.timestamp,
      lastSeen: detection.timestamp,
      bestConfidence: detection.confidence,
      bestLocation: loc,
      lastLocation: loc,
      storeCount: 1,
      lastEmittedId: null,
    }
    const newPlates = new Map(plates)
    newPlates.set(key, record)
    return {
      state: { plates: newPlates },
      action: 'store',
      reason: 'new plate',
      entry: emit('dedup', 'new plate'),
      updateTargetId: null,
    }
  }

  const timeDelta = detection.timestamp - existing.lastSeen
  const sameSighting =
    loc && existing.lastLocation
      ? haversineMeters(loc, existing.lastLocation) <= radius && timeDelta <= params.timeWindowMs
      : timeDelta <= params.timeWindowMs

  if (!sameSighting) {
    const updated: PlateRecord = {
      ...existing,
      lastSeen: detection.timestamp,
      lastLocation: loc,
      storeCount: existing.storeCount + 1,
      lastEmittedId: null,
    }
    if (detection.confidence > existing.bestConfidence) {
      updated.bestConfidence = detection.confidence
      updated.bestLocation = loc
    }
    const newPlates = new Map(plates)
    newPlates.set(key, updated)
    return {
      state: { plates: newPlates },
      action: 'store',
      reason: 'new sighting',
      entry: emit('dedup', 'new sighting (outside time/geo window)'),
      updateTargetId: null,
    }
  }

  if (detection.confidence > existing.bestConfidence) {
    const updated: PlateRecord = {
      ...existing,
      lastSeen: detection.timestamp,
      lastLocation: loc,
      bestConfidence: detection.confidence,
      bestLocation: loc,
    }
    const newPlates = new Map(plates)
    newPlates.set(key, updated)
    return {
      state: { plates: newPlates },
      action: existing.lastEmittedId != null ? 'update' : 'store',
      reason: 'better confidence',
      entry: emit('dedup', 'better-confidence update'),
      updateTargetId: existing.lastEmittedId,
    }
  }

  const timeSinceFirst = detection.timestamp - existing.firstSeen
  if (timeSinceFirst >= params.retriggerWindowMs) {
    const updated: PlateRecord = {
      ...existing,
      firstSeen: detection.timestamp,
      lastSeen: detection.timestamp,
      lastLocation: loc,
      bestConfidence: detection.confidence,
      bestLocation: loc,
      storeCount: existing.storeCount + 1,
      lastEmittedId: null,
    }
    const newPlates = new Map(plates)
    newPlates.set(key, updated)
    return {
      state: { plates: newPlates },
      action: 'store',
      reason: 'retrigger',
      entry: emit('dedup', 'retrigger after extended absence'),
      updateTargetId: null,
    }
  }

  const updated: PlateRecord = { ...existing, lastSeen: detection.timestamp, lastLocation: loc }
  const newPlates = new Map(plates)
  newPlates.set(key, updated)
  return {
    state: { plates: newPlates },
    action: 'skip',
    reason: 'same sighting, no better confidence',
    entry: hold('dedup', 'same sighting, no better confidence'),
    updateTargetId: null,
  }
}
