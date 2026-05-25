import type { DetectionRecord, SessionRecord } from './db'

export interface GeoJsonFeature {
  type: 'Feature'
  geometry: {
    type: 'Point'
    coordinates: [number, number] | []
  }
  properties: Record<string, unknown>
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export function detectionsToGeoJson(
  session: SessionRecord,
  detections: DetectionRecord[],
): GeoJsonFeatureCollection {
  const features: GeoJsonFeature[] = []

  for (const det of detections) {
    const coords: [number, number] | [] =
      det.latitude != null && det.longitude != null
        ? [det.longitude, det.latitude]
        : []

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords,
      },
      properties: {
        plate: det.plate,
        confidence: det.confidence,
        confidence_per_char: det.charConfidences,
        detectorConfidence: det.detectorConfidence,
        bbox: det.bbox,
        heading: det.heading,
        speed_kmh: det.speedKph,
        altitude_m: det.altitudeM,
        timestamp: new Date(det.timestamp).toISOString(),
        region: det.region,
        regionConfidence: det.regionConfidence,
        suppressed: det.suppressed ?? false,
        decisionTrace: det.decisionTrace ?? [],
        sessionId: session.id,
        sessionStartedAt: new Date(session.startedAt).toISOString(),
        sessionMode: session.mode ?? 'normal',
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

function csvEscape(value: unknown): string {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function detectionsToCsv(detections: DetectionRecord[]): string {
  const header = [
    'plate', 'confidence', 'confidence_per_char', 'detectorConfidence',
    'bbox_x1', 'bbox_y1', 'bbox_x2', 'bbox_y2',
    'latitude', 'longitude', 'heading', 'speed_kmh', 'altitude_m',
    'region', 'regionConfidence', 'timestamp',
    'suppressed', 'decision_trace',
  ]

  const rows = detections.map(det => [
    csvEscape(det.plate),
    det.confidence,
    `"${(det.charConfidences || []).join(' ')}"`,
    det.detectorConfidence,
    det.bbox.x1, det.bbox.y1, det.bbox.x2, det.bbox.y2,
    det.latitude ?? '', det.longitude ?? '', det.heading ?? '',
    det.speedKph ?? '', det.altitudeM ?? '',
    det.region ?? '', det.regionConfidence ?? '',
    det.timestamp,
    det.suppressed ? '1' : '0',
    csvEscape(JSON.stringify(det.decisionTrace ?? [])),
  ].join(','))

  return [header.join(','), ...rows].join('\n')
}
