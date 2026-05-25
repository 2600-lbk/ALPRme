import type { Detection } from '@/storage/dedup'
import { normalizePlate } from '@/storage/dedup'
import { plateSimilar } from './fuzzy'
import { pass, suppress, type DecisionEntry } from './trace'

export interface MotionParams {
  stationarySpeedThresholdKph: number
  bboxDriftMaxStationaryPx: number
  motionWindowMs: number
  fuzzyDistance: number
}

export interface MotionResult {
  verdict: 'pass' | 'suppress'
  entry: DecisionEntry
}

interface BboxObservation {
  plate: string
  cx: number
  cy: number
  timestamp: number
}

/**
 * Bbox/motion sanity check. Keeps a short rolling history of bbox centers per plate
 * (fuzzy-grouped). When the device is stationary (GPS speedKph below threshold), all
 * bbox centers should cluster tightly. Excess scatter likely means the OCR latched
 * onto two different objects with the same misread text — suppress.
 *
 * When the device is moving, we let drift slide (a real plate's bbox tracks across the
 * frame as the camera moves past).
 */
export class MotionTracker {
  private history: BboxObservation[] = []

  constructor(private params: MotionParams) {}

  setParams(params: MotionParams): void {
    this.params = params
  }

  reset(): void {
    this.history = []
  }

  process(det: Detection): MotionResult {
    this.expire(det.timestamp)

    const cx = (det.bbox.x1 + det.bbox.x2) / 2
    const cy = (det.bbox.y1 + det.bbox.y2) / 2
    const normalized = normalizePlate(det.plate)

    // Only enforce stationary drift bounds when we actually know speed AND the
    // device is below the stationary threshold. Unknown speed → pass.
    const speed = det.speedKph
    const stationary = speed != null && speed < this.params.stationarySpeedThresholdKph

    if (stationary) {
      const matchingPriors = this.history.filter(o =>
        plateSimilar(normalizePlate(o.plate), normalized, this.params.fuzzyDistance),
      )
      if (matchingPriors.length > 0) {
        let maxDrift = 0
        for (const o of matchingPriors) {
          const d = Math.hypot(o.cx - cx, o.cy - cy)
          if (d > maxDrift) maxDrift = d
        }
        if (maxDrift > this.params.bboxDriftMaxStationaryPx) {
          // Don't store this observation — likely a spurious read.
          return {
            verdict: 'suppress',
            entry: suppress('motion', 'stationary bbox drift exceeded', maxDrift, this.params.bboxDriftMaxStationaryPx),
          }
        }
      }
    }

    this.history.push({ plate: det.plate, cx, cy, timestamp: det.timestamp })
    return {
      verdict: 'pass',
      entry: pass('motion', stationary ? 'stationary drift within bound' : 'moving; drift not gated'),
    }
  }

  private expire(now: number): void {
    const cutoff = now - this.params.motionWindowMs
    this.history = this.history.filter(o => o.timestamp >= cutoff)
  }
}
