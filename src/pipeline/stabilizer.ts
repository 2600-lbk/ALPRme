import type { Detection } from '@/storage/dedup'
import { normalizePlate } from '@/storage/dedup'
import { plateSimilar } from './fuzzy'
import { emit, hold, type DecisionEntry } from './trace'

export interface StabilizerParams {
  stabilizerWindowMs: number
  consensusK: number
  consensusN: number
  fuzzyDistance: number
}

export interface CandidateFrame {
  plate: string
  confidence: number
  bboxCenter: { x: number; y: number }
  timestamp: number
}

export interface Candidate {
  /** Canonical plate text — the one with highest confidence seen so far. */
  plate: string
  frames: CandidateFrame[]
  peakConfidence: number
  /** Once emitted, suppresses further emissions for this candidate within its window. */
  emittedAt: number | null
  /** Detection that produced the peak emit; surfaced to caller for DB write. */
  peakDetection: Detection | null
}

export interface StabilizerResult {
  verdict: 'emit' | 'hold'
  entry: DecisionEntry
  /** When verdict==='emit', this is the detection (peak confidence) to emit. */
  emittedDetection: Detection | null
}

/**
 * Multi-frame stabilizer. Buffers candidate plates (with fuzzy text matching) over a
 * rolling window and emits exactly one detection per "burst" — the one at peak confidence —
 * once a K-of-N consensus is reached. Same burst won't re-emit until it falls out of the
 * window or a stronger reading arrives.
 */
export class Stabilizer {
  private candidates: Candidate[] = []

  constructor(private params: StabilizerParams) {}

  setParams(params: StabilizerParams): void {
    this.params = params
  }

  reset(): void {
    this.candidates = []
  }

  /**
   * Emit the peak detection from every candidate that has at least one frame and
   * was not already emitted. Used on session stop so plates that were being held
   * pending consensus aren't silently lost. Clears state afterwards.
   */
  flush(): Detection[] {
    const out: Detection[] = []
    for (const cand of this.candidates) {
      if (cand.emittedAt === null && cand.peakDetection != null) {
        out.push(cand.peakDetection)
      }
    }
    this.candidates = []
    return out
  }

  /**
   * Process a single detection. Returns whether the stabilizer wants to emit *this*
   * detection (i.e., this is the first frame to push the burst over the consensus
   * threshold AND this frame happens to be the peak so far), holds it (still gathering),
   * or emits a different (peak) detection from earlier in the window.
   */
  process(det: Detection): StabilizerResult {
    this.expire(det.timestamp)

    const cand = this.findOrCreateCandidate(det)
    const frame: CandidateFrame = {
      plate: det.plate,
      confidence: det.confidence,
      bboxCenter: {
        x: (det.bbox.x1 + det.bbox.x2) / 2,
        y: (det.bbox.y1 + det.bbox.y2) / 2,
      },
      timestamp: det.timestamp,
    }
    cand.frames.push(frame)

    let isNewPeak = false
    if (det.confidence > cand.peakConfidence) {
      cand.peakConfidence = det.confidence
      cand.peakDetection = det
      cand.plate = det.plate
      isNewPeak = true
    }

    const count = cand.frames.length
    const K = this.params.consensusK
    const N = this.params.consensusN

    if (count < K) {
      return {
        verdict: 'hold',
        entry: hold('stabilizer', `consensus not yet met (${count}/${K})`, count, K),
        emittedDetection: null,
      }
    }

    // Already emitted in this burst — only re-emit if a strictly better reading lands.
    if (cand.emittedAt !== null) {
      if (isNewPeak) {
        cand.emittedAt = det.timestamp
        return {
          verdict: 'emit',
          entry: emit('stabilizer', 're-emit at higher peak confidence'),
          emittedDetection: det,
        }
      }
      return {
        verdict: 'hold',
        entry: hold('stabilizer', 'already emitted; not a new peak'),
        emittedDetection: null,
      }
    }

    // First-time consensus: emit the peak detection (which may be earlier in the burst).
    cand.emittedAt = det.timestamp
    const toEmit = cand.peakDetection ?? det
    return {
      verdict: 'emit',
      entry: emit('stabilizer', `consensus reached (${Math.min(count, N)}/${K})`),
      emittedDetection: toEmit,
    }
  }

  /** Drop frames + candidates whose oldest frame is outside the rolling window. */
  private expire(now: number): void {
    const cutoff = now - this.params.stabilizerWindowMs
    for (const cand of this.candidates) {
      cand.frames = cand.frames.filter(f => f.timestamp >= cutoff)
    }
    this.candidates = this.candidates.filter(c => c.frames.length > 0)
  }

  private findOrCreateCandidate(det: Detection): Candidate {
    const normalized = normalizePlate(det.plate)
    for (const cand of this.candidates) {
      if (plateSimilar(normalizePlate(cand.plate), normalized, this.params.fuzzyDistance)) {
        return cand
      }
    }
    const fresh: Candidate = {
      plate: det.plate,
      frames: [],
      peakConfidence: -Infinity,
      emittedAt: null,
      peakDetection: null,
    }
    this.candidates.push(fresh)
    return fresh
  }

  /** Test-only inspection. */
  inspect(): readonly Candidate[] {
    return this.candidates
  }
}
