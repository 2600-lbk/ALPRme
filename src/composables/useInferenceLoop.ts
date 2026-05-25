import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { WorkerDetection } from '@/packages/alpr/worker-protocol'
import type { CaptureProfile } from '@/capture/profile'
import { CaptureController } from '@/capture/controller'
import { getAlprClient } from './useAlpr'

export interface UseInferenceLoopOptions {
  targetFps?: Ref<number> | number
  enabled?: Ref<boolean>
  /** Active capture profile. Required — drives the camera + tiling pipeline. */
  profile: Ref<CaptureProfile | null>
  onDetection?: (detections: WorkerDetection[]) => void
}

export interface UseInferenceLoopReturn {
  detections: Ref<WorkerDetection[]>
  achievedFps: Ref<number>
  /** Tiles dispatched per second (separate metric from FPS — each tick may
   *  dispatch N tiles via batch). Useful for tuning grid + maxTilesPerFrame. */
  tilesPerSecond: Ref<number>
  frameCount: Ref<number>
  status: Ref<'idle' | 'running' | 'busy' | 'error'>
  error: Ref<string | null>
  /** Source-frame size used by the last capture tick (for overlay math). */
  sourceSize: Ref<{ w: number; h: number }>
}

/**
 * Drives the per-frame inference loop via `requestVideoFrameCallback`.
 *
 * For each tick that's due (relative to `targetFps`): delegate to a
 * `CaptureController`, which captures a native-resolution snapshot, slices it
 * into tiles per the active profile's detection windows, dispatches all tiles
 * to the worker in one batch, and reprojects the resulting bboxes back to
 * source-frame coordinates with cross-tile NMS applied.
 *
 * Detections emitted upstream are in source-frame pixel space, so the overlay
 * only needs a single display-fit transform.
 */
export function useInferenceLoop(
  videoRef: Ref<HTMLVideoElement | null>,
  options: UseInferenceLoopOptions,
): UseInferenceLoopReturn {
  const detections = ref<WorkerDetection[]>([])
  const achievedFps = ref(0)
  const tilesPerSecond = ref(0)
  const frameCount = ref(0)
  const status = ref<'idle' | 'running' | 'busy' | 'error'>('idle')
  const error = ref<string | null>(null)
  const sourceSize = ref<{ w: number; h: number }>({ w: 0, h: 0 })

  const targetFps = typeof options.targetFps === 'number'
    ? options.targetFps
    : (options.targetFps?.value ?? 4)
  const enabled = options.enabled ?? ref(true)
  const onDetection = options.onDetection

  let lastFrameTime = 0
  let fpsAccumulator = 0
  let tilesAccumulator = 0
  let fpsInterval: ReturnType<typeof setInterval> | null = null
  let cancelNext: (() => void) | null = null
  let running = false
  let controller: CaptureController | null = null
  let busyRetryCount = 0

  function getTargetFps(): number {
    if (typeof options.targetFps === 'number') return options.targetFps
    return options.targetFps?.value ?? targetFps
  }

  function ensureController(): CaptureController | null {
    const video = videoRef.value
    if (!video) return null
    const client = getAlprClient()
    if (!client) return null
    if (!options.profile.value) return null

    if (!controller) {
      controller = new CaptureController({
        video,
        client,
        profile: options.profile.value,
      })
    } else {
      controller.setProfile(options.profile.value)
    }
    return controller
  }

  async function processFrame(now: number, _meta: VideoFrameCallbackMetadata): Promise<void> {
    if (!enabled.value || !running) return

    const fps = getTargetFps()
    const elapsed = now - lastFrameTime
    const minInterval = 1000 / fps
    if (elapsed < minInterval && lastFrameTime > 0) {
      scheduleNext()
      return
    }
    lastFrameTime = now

    const c = ensureController()
    if (!c) {
      status.value = 'running'
      scheduleNext()
      return
    }

    status.value = 'busy'
    try {
      const { detections: dets, tileCount } = await c.capture()
      detections.value = dets
      sourceSize.value = c.sourceSize
      frameCount.value++
      fpsAccumulator++
      tilesAccumulator += tileCount
      busyRetryCount = 0
      status.value = 'running'
      onDetection?.(dets)
    } catch (e) {
      if (String(e).includes('BUSY')) {
        // Worker is still processing the last batch — retry on the next video
        // frame without advancing lastFrameTime so we try again immediately.
        status.value = 'busy'
        busyRetryCount++
        lastFrameTime = 0
      } else {
        error.value = String(e)
        status.value = 'error'
      }
    }

    scheduleNext()
  }

  function scheduleNext(): void {
    if (!running || !videoRef.value) return
    cancelNext = videoRef.value.requestVideoFrameCallback(processFrame) as unknown as (() => void)
  }

  function startFpsCounter(): void {
    fpsInterval = setInterval(() => {
      achievedFps.value = fpsAccumulator
      tilesPerSecond.value = tilesAccumulator
      fpsAccumulator = 0
      tilesAccumulator = 0
    }, 1000)
  }

  function stop(): void {
    running = false
    if (cancelNext) { cancelNext(); cancelNext = null }
    if (fpsInterval) { clearInterval(fpsInterval); fpsInterval = null }
    controller = null
    status.value = 'idle'
    detections.value = []
    achievedFps.value = 0
    tilesPerSecond.value = 0
  }

  watch(videoRef, (newVideo, oldVideo) => {
    if (oldVideo) stop()
    if (newVideo && enabled.value) {
      running = true
      lastFrameTime = 0
      status.value = 'running'
      startFpsCounter()
      scheduleNext()
    }
  })

  watch(enabled, (on) => {
    if (on && videoRef.value) {
      if (running) return
      running = true
      lastFrameTime = 0
      status.value = 'running'
      startFpsCounter()
      scheduleNext()
    } else if (!on) {
      stop()
    }
  })

  // Hot-swap profile without restarting the loop.
  watch(options.profile, () => {
    if (controller && options.profile.value) {
      controller.setProfile(options.profile.value)
    } else if (!controller) {
      // Recreate next tick.
    }
  }, { deep: true })

  onUnmounted(() => stop())

  return { detections, achievedFps, tilesPerSecond, frameCount, status, error, sourceSize }
}
