import { getDb, type DetectionRecord, type SessionMode } from './db'
import type { Detection } from './dedup'
import { Pipeline, type PipelineParams, type PipelineResult } from '@/pipeline'
import { FILTER_PRESETS, DEFAULT_PRESET } from '@/pipeline/presets'

export interface SessionRecorderOptions {
  params?: Partial<PipelineParams>
  mode?: SessionMode
  onStore?: (det: DetectionRecord) => void
}

export interface StartOptions {
  keepCrops?: boolean
  mode?: SessionMode
  /** Capture profile in effect; stored on the SessionRecord for later review. */
  captureProfileId?: number
}

export class SessionRecorder {
  private db = getDb()
  private sessionId: number | null = null
  private pipeline: Pipeline
  private mode: SessionMode
  private onStore: ((det: DetectionRecord) => void) | null

  constructor(options: SessionRecorderOptions = {}) {
    const merged: PipelineParams = { ...FILTER_PRESETS[DEFAULT_PRESET], ...options.params }
    this.pipeline = new Pipeline(merged)
    this.mode = options.mode ?? 'normal'
    this.onStore = options.onStore ?? null
  }

  get isActive(): boolean {
    return this.sessionId !== null
  }

  get currentSessionId(): number | null {
    return this.sessionId
  }

  setParams(params: PipelineParams): void {
    this.pipeline.setParams(params)
  }

  async start(opts: StartOptions | boolean = {}): Promise<number> {
    if (this.sessionId !== null) {
      await this.stop()
    }

    // Backward compat: original signature was `start(keepCrops: boolean)`.
    const options: StartOptions = typeof opts === 'boolean' ? { keepCrops: opts } : opts
    const keepCrops = options.keepCrops ?? false
    if (options.mode) this.mode = options.mode

    const id = await this.db.sessions.add({
      startedAt: Date.now(),
      endedAt: null,
      keepCrops,
      mode: this.mode,
      captureProfileId: options.captureProfileId,
    })

    this.sessionId = id as number
    this.pipeline.reset()
    return this.sessionId
  }

  /**
   * Stop the session. Drains pending stabilizer candidates first so plates that
   * were being held pending K-of-N consensus are still committed at their peak.
   */
  async stop(): Promise<void> {
    if (this.sessionId === null) return

    const pending = this.pipeline.flushPending()
    for (const result of pending) {
      await this.writeResult(result)
    }

    await this.db.sessions.update(this.sessionId, { endedAt: Date.now() })
    this.sessionId = null
  }

  async record(detection: Detection, crop?: Blob): Promise<DetectionRecord | null> {
    if (this.sessionId === null) return null
    const result = this.pipeline.process(detection)
    return this.writeResult(result, crop)
  }

  /** Persist a pipeline result. Honors session mode (normal vs diagnostic) and
   *  routes update verdicts to db.update, insert verdicts to db.add. Returns the
   *  stored record (with id) or null when the result was dropped without writing. */
  private async writeResult(result: PipelineResult, crop?: Blob): Promise<DetectionRecord | null> {
    if (this.sessionId === null) return null

    const isDiagnostic = this.mode === 'diagnostic'

    // Normal mode: drop suppressed detections entirely.
    if (result.verdict === 'suppress' && !isDiagnostic) return null

    const suppressed = result.verdict === 'suppress'
    const det = result.detection

    const record: DetectionRecord = {
      sessionId: this.sessionId,
      plate: det.plate,
      confidence: det.confidence,
      charConfidences: det.charConfidences,
      bbox: det.bbox,
      detectorConfidence: det.detectorConfidence,
      latitude: det.latitude,
      longitude: det.longitude,
      heading: det.heading,
      speedKph: det.speedKph,
      altitudeM: det.altitudeM,
      region: det.region,
      regionConfidence: det.regionConfidence,
      timestamp: det.timestamp,
      suppressed,
      decisionTrace: result.trace,
    }

    // UPDATE path: stronger reading of an already-stored sighting in this burst.
    if (result.verdict === 'update' && result.updateTargetId != null && !suppressed) {
      // Dexie's UpdateSpec expands array properties to dot-notation keys, so a plain
      // DetectionRecord doesn't match. Bypass the spec typing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.db.detections.update(result.updateTargetId, record as any)
      const stored = { ...record, id: result.updateTargetId }
      this.onStore?.(stored)
      return stored
    }

    const detId = await this.db.detections.add(record) as number

    // Only stamp dedup state with emitted ids for *non-suppressed* writes so a future
    // better-confidence reading targets a real sighting row, not a diagnostic record.
    if (!suppressed) {
      this.pipeline.noteEmittedId(det.plate, detId)
    }

    if (crop && this.sessionId) {
      const session = await this.db.sessions.get(this.sessionId)
      if (session?.keepCrops) {
        await this.db.crops.add({ detectionId: detId, blob: crop })
      }
    }

    const stored = { ...record, id: detId }
    this.onStore?.(stored)
    return stored
  }

  async deleteSession(): Promise<void> {
    if (this.sessionId === null) return

    const detections = await this.db.detections.where({ sessionId: this.sessionId }).toArray()
    for (const det of detections) {
      if (det.id != null) {
        await this.db.crops.where({ detectionId: det.id }).delete()
      }
    }

    await this.db.detections.where({ sessionId: this.sessionId }).delete()
    await this.db.sessions.delete(this.sessionId)
    this.sessionId = null
  }
}
