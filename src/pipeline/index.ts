import type { Detection, DedupState, DedupParams, DedupAction } from '@/storage/dedup'
import { mergeDetection } from '@/storage/dedup'
import { runPrefilter, type PrefilterParams } from './prefilter'
import { Stabilizer, type StabilizerParams } from './stabilizer'
import { MotionTracker, type MotionParams } from './motion'
import { emit as emitEntry, type DecisionTrace } from './trace'

export type { DecisionEntry, DecisionTrace, DecisionStage, DecisionVerdict } from './trace'

export interface PipelineParams
  extends PrefilterParams,
    StabilizerParams,
    MotionParams,
    DedupParams {}

export type PipelineVerdict = 'emit' | 'update' | 'suppress'

export interface PipelineResult {
  verdict: PipelineVerdict
  trace: DecisionTrace
  /** The detection to emit/update. May not be `input` — the stabilizer can emit
   *  an earlier peak-confidence frame from the burst. */
  detection: Detection
  /** When verdict==='update', the DB row id to update in place. */
  updateTargetId: number | null
  /** Mirrors dedup action for callers that need to distinguish store vs skip. */
  dedupAction: DedupAction | null
}

/**
 * Orchestrates the four-stage detection filtering pipeline:
 *   1. Pre-filter (stateless): cheap rejects on confidences, bbox area, plate length
 *   2. Stabilizer (stateful, per-session): K-of-N consensus, peak-confidence emit
 *   3. Motion sanity (stateful, per-session): stationary bbox drift bound
 *   4. Sighting deduper (stateful, per-session): time+geo dedup, better-conf updates
 *
 * Each stage appends to a per-detection decision trace. In diagnostic mode the trace
 * is persisted alongside the detection record so heuristics can be studied offline.
 */
export class Pipeline {
  private stabilizer: Stabilizer
  private motion: MotionTracker
  private dedupState: DedupState = { plates: new Map() }

  constructor(private params: PipelineParams) {
    this.stabilizer = new Stabilizer(params)
    this.motion = new MotionTracker(params)
  }

  setParams(params: PipelineParams): void {
    this.params = params
    this.stabilizer.setParams(params)
    this.motion.setParams(params)
  }

  reset(): void {
    this.stabilizer.reset()
    this.motion.reset()
    this.dedupState = { plates: new Map() }
  }

  /** Stamp a DB id onto the dedup state so a later better-confidence reading can
   *  target it for UPDATE rather than INSERT. Call after a successful DB write. */
  noteEmittedId(plate: string, id: number): void {
    // Inline to avoid a small extra import.
    const existing = this.dedupState.plates.get(plate.toUpperCase().replace(/[\s\-\.]/g, ''))
    if (!existing) return
    existing.lastEmittedId = id
  }

  /**
   * Drain pending stabilizer candidates and push them through the deduper. Used
   * on session stop so plates that were being held pending K-of-N consensus are
   * still committed (at peak confidence). Results carry a synthetic trace noting
   * the flush.
   */
  flushPending(): PipelineResult[] {
    const pending = this.stabilizer.flush()
    const out: PipelineResult[] = []
    for (const det of pending) {
      const trace: DecisionTrace = [emitEntry('stabilizer', 'flushed on session stop')]
      // Motion sanity isn't meaningful at flush time; skip it.
      const dedup = mergeDetection(this.dedupState, det, this.params)
      trace.push(dedup.entry)
      this.dedupState = dedup.state
      if (dedup.action === 'skip') {
        out.push({ verdict: 'suppress', trace, detection: det, updateTargetId: null, dedupAction: 'skip' })
      } else if (dedup.action === 'update') {
        out.push({ verdict: 'update', trace, detection: det, updateTargetId: dedup.updateTargetId, dedupAction: 'update' })
      } else {
        out.push({ verdict: 'emit', trace, detection: det, updateTargetId: null, dedupAction: 'store' })
      }
    }
    return out
  }

  process(input: Detection): PipelineResult {
    const trace: DecisionTrace = []

    // Stage 1: Pre-filter
    const pre = runPrefilter(input, this.params)
    trace.push(pre.entry)
    if (pre.verdict === 'suppress') {
      return { verdict: 'suppress', trace, detection: input, updateTargetId: null, dedupAction: null }
    }

    // Stage 2: Stabilizer
    const stab = this.stabilizer.process(input)
    trace.push(stab.entry)
    if (stab.verdict === 'hold') {
      return { verdict: 'suppress', trace, detection: input, updateTargetId: null, dedupAction: null }
    }
    // The detection moving downstream is the peak-confidence one chosen by the
    // stabilizer (may equal `input`, may be an earlier frame in the burst).
    const downstream = stab.emittedDetection ?? input

    // Stage 3: Motion sanity
    const mot = this.motion.process(downstream)
    trace.push(mot.entry)
    if (mot.verdict === 'suppress') {
      return { verdict: 'suppress', trace, detection: downstream, updateTargetId: null, dedupAction: null }
    }

    // Stage 4: Sighting deduper
    const dedup = mergeDetection(this.dedupState, downstream, this.params)
    trace.push(dedup.entry)
    this.dedupState = dedup.state

    if (dedup.action === 'skip') {
      return { verdict: 'suppress', trace, detection: downstream, updateTargetId: null, dedupAction: 'skip' }
    }
    if (dedup.action === 'update') {
      return { verdict: 'update', trace, detection: downstream, updateTargetId: dedup.updateTargetId, dedupAction: 'update' }
    }
    return { verdict: 'emit', trace, detection: downstream, updateTargetId: null, dedupAction: 'store' }
  }
}
