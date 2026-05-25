import type { Detection } from '@/storage/dedup'
import { pass, suppress, type DecisionEntry } from './trace'

export interface PrefilterParams {
  minDetectorConfidence: number
  minOcrConfidence: number
  minCharConfidence: number
  minBboxAreaPx: number
  minPlateLen: number
  maxPlateLen: number
}

export interface PrefilterResult {
  verdict: 'pass' | 'suppress'
  entry: DecisionEntry
}

export function bboxArea(b: Detection['bbox']): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
}

export function runPrefilter(det: Detection, params: PrefilterParams): PrefilterResult {
  if (det.detectorConfidence < params.minDetectorConfidence) {
    return {
      verdict: 'suppress',
      entry: suppress('prefilter', 'detector confidence below floor', det.detectorConfidence, params.minDetectorConfidence),
    }
  }
  if (det.confidence < params.minOcrConfidence) {
    return {
      verdict: 'suppress',
      entry: suppress('prefilter', 'OCR confidence below floor', det.confidence, params.minOcrConfidence),
    }
  }
  if (det.charConfidences.length > 0) {
    const weakest = Math.min(...det.charConfidences)
    if (weakest < params.minCharConfidence) {
      return {
        verdict: 'suppress',
        entry: suppress('prefilter', 'weakest char confidence below floor', weakest, params.minCharConfidence),
      }
    }
  }
  const area = bboxArea(det.bbox)
  if (area < params.minBboxAreaPx) {
    return {
      verdict: 'suppress',
      entry: suppress('prefilter', 'bbox area below floor', area, params.minBboxAreaPx),
    }
  }
  const len = det.plate.length
  if (len < params.minPlateLen) {
    return {
      verdict: 'suppress',
      entry: suppress('prefilter', 'plate too short', len, params.minPlateLen),
    }
  }
  if (len > params.maxPlateLen) {
    return {
      verdict: 'suppress',
      entry: suppress('prefilter', 'plate too long', len, params.maxPlateLen),
    }
  }

  return { verdict: 'pass', entry: pass('prefilter', 'all checks passed') }
}
