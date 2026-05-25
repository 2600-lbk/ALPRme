import { ref, readonly } from 'vue'
import { SessionRecorder, type StartOptions } from '@/storage/session'
import type { Detection } from '@/storage/dedup'
import type { DetectionRecord, SessionMode } from '@/storage/db'
import { usePrefs } from './usePrefs'

const RECENT_LIMIT = 8

export interface RecentPlate {
  plate: string
  confidence: number
  detectorConfidence: number
  timestamp: number
}

export function useSession() {
  const active = ref(false)
  const sessionId = ref<number | null>(null)
  const count = ref(0)
  const mode = ref<SessionMode>('normal')
  /** Plates the pipeline has actually committed (suppressed records excluded). */
  const recent = ref<RecentPlate[]>([])
  let recorder: SessionRecorder | null = null

  function pushRecent(det: DetectionRecord): void {
    const idx = recent.value.findIndex(p => p.plate === det.plate)
    if (idx !== -1) recent.value.splice(idx, 1)
    recent.value.unshift({
      plate: det.plate,
      confidence: det.confidence,
      detectorConfidence: det.detectorConfidence,
      timestamp: det.timestamp,
    })
    if (recent.value.length > RECENT_LIMIT) recent.value.length = RECENT_LIMIT
  }

  async function start(opts: StartOptions = {}): Promise<void> {
    const { asPipelineParams } = usePrefs()
    recorder = new SessionRecorder({
      params: asPipelineParams(),
      mode: opts.mode,
      onStore: (det) => {
        // Only count + show emitted (non-suppressed) records. In diagnostic mode
        // suppressed detections are still written to DB but shouldn't pollute the
        // live UI counter or the "recent plates" list — those reflect kept
        // results, not raw OCR candidates.
        if (det.suppressed) return
        count.value++
        pushRecent(det)
      },
    })
    const id = await recorder.start(opts)
    sessionId.value = id
    mode.value = opts.mode ?? 'normal'
    active.value = true
    count.value = 0
    recent.value = []
  }

  async function stop(): Promise<void> {
    if (recorder) await recorder.stop()
    recorder = null
    active.value = false
    sessionId.value = null
    mode.value = 'normal'
  }

  async function record(detection: Detection, crop?: Blob): Promise<void> {
    if (!recorder) return
    await recorder.record(detection, crop).catch(() => {})
  }

  return {
    active: readonly(active),
    sessionId: readonly(sessionId),
    count: readonly(count),
    mode: readonly(mode),
    recent: readonly(recent),
    start,
    stop,
    record,
  }
}
