<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { WorkerDetection } from '@/packages/alpr/worker-protocol'
import type { CorrectedHeadingState } from '@/packages/geomag/heading'
import type { CaptureProfile, TileGrid } from '@/capture/profile'

import GridEditor from './GridEditor.vue'

/**
 * In-preview transparent overlay above the <video>. Renders:
 *  - detection-bbox canvas
 *  - GridEditor (when editor mode is on)
 *  - HUD chips (heading, altitude+GPS bottom-left, speed bottom-right)
 *  - sensor-permission and camera/model error layers
 *
 * The top toolbar (profile / grid-edit / gear) and the bottom record strip
 * live in AppShell — this component does NOT render either.
 */
const props = defineProps<{
  detections: WorkerDetection[]
  headingState: CorrectedHeadingState
  hasLocation: boolean
  hasOrientation: boolean
  needsPermission: boolean
  permissionError: string | null
  cameraError: string | null
  modelError: string | null
  videoEl: HTMLVideoElement | null
  isVisible: boolean
  sourceSize: { w: number; h: number }
  activeProfile: CaptureProfile
  /** Controlled by AppShell's top-strip grid-edit toggle. */
  editorOpen: boolean
}>()

const emit = defineEmits<{
  'enable-sensors': []
  'retry-camera': []
  'retry-model': []
  /** Persist a grid change (cell toggle) back into the active profile. */
  'update-grid': [grid: TileGrid]
}>()

// ─── Overlay canvas ──────────────────────────────────────────────────────────

const overlayCanvas = ref<HTMLCanvasElement | null>(null)
const captureRef = ref<HTMLDivElement | null>(null)

let resizeObserver: ResizeObserver | null = null

// object-fit: contain transform — detections are already in source-frame pixel
// coords, so the only remaining math is the display fit (no inferenceScale).
const combinedScale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const viewW = ref(0)
const viewH = ref(0)

function updateCanvasSize(): void {
  const canvas = overlayCanvas.value
  const video = props.videoEl
  const el = captureRef.value
  if (!canvas || !video || !el) return

  const cw = el.clientWidth
  const ch = el.clientHeight
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return

  canvas.width = cw
  canvas.height = ch
  viewW.value = cw
  viewH.value = ch

  // object-fit: contain — pick the SMALLER ratio so the whole frame is
  // visible (letterbox bars on the long side).
  const displayScale = Math.min(cw / vw, ch / vh)
  offsetX.value = (cw - vw * displayScale) / 2
  offsetY.value = (ch - vh * displayScale) / 2
  combinedScale.value = displayScale
}

function drawOverlay(): void {
  const canvas = overlayCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!props.detections.length) return

  for (const det of props.detections) {
    const { x1, y1, x2, y2 } = det.bbox
    const sx1 = x1 * combinedScale.value + offsetX.value
    const sy1 = y1 * combinedScale.value + offsetY.value
    const sx2 = x2 * combinedScale.value + offsetX.value
    const sy2 = y2 * combinedScale.value + offsetY.value
    if (sx2 < 0 || sy2 < 0 || sx1 > canvas.width || sy1 > canvas.height) continue

    ctx.strokeStyle = '#24ff0c'
    ctx.lineWidth = 2
    ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1)

    const fs = Math.max(11, Math.min(15, canvas.width / 40))
    ctx.font = `700 ${fs}px monospace`
    const label = det.plate
    const tw = ctx.measureText(label).width
    const lx = Math.max(sx1, 0)
    const ly = Math.max(sy1 - fs - 8, 2)
    ctx.fillStyle = 'rgba(0,0,0,0.82)'
    ctx.fillRect(lx, ly, tw + 10, fs + 8)
    ctx.fillStyle = '#24ff0c'
    ctx.fillText(label, lx + 5, ly + fs + 3)
  }
}

watch(() => props.detections, () => nextTick(drawOverlay), { deep: true })

function onVideoMetadata(): void { updateCanvasSize() }

watch(() => props.videoEl, (el, old) => {
  if (old) old.removeEventListener('loadedmetadata', onVideoMetadata)
  if (el) {
    el.addEventListener('loadedmetadata', onVideoMetadata)
    updateCanvasSize()
  }
})

watch(() => props.isVisible, (vis) => {
  if (vis) nextTick(() => { updateCanvasSize(); drawOverlay() })
})

onMounted(() => {
  if (captureRef.value) {
    resizeObserver = new ResizeObserver(() => { updateCanvasSize(); drawOverlay() })
    resizeObserver.observe(captureRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  props.videoEl?.removeEventListener('loadedmetadata', onVideoMetadata)
})

// ─── Sensor / HUD values ─────────────────────────────────────────────────────

const headingDeg = computed(() => props.headingState.trueHeading)
const speedKmh = computed(() => {
  const s = props.headingState.location?.speed
  return s != null ? Math.round(s * 3.6) : null
})
const altitudeFt = computed(() => {
  const a = props.headingState.location?.altitude
  return a != null ? Math.round(a * 3.28084) : null
})
const headingCardinal = computed(() => {
  if (headingDeg.value == null) return ''
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(headingDeg.value / 45) % 8] ?? ''
})
const gpsLat = computed(() => props.headingState.location?.latitude ?? null)
const gpsLon = computed(() => props.headingState.location?.longitude ?? null)
const gpsAcc = computed(() => props.headingState.location?.accuracy ?? null)
const gpsText = computed(() => {
  if (gpsLat.value == null || gpsLon.value == null) return null
  return `${gpsLat.value.toFixed(4)}, ${gpsLon.value.toFixed(4)}`
})
</script>

<template>
  <div ref="captureRef" class="capture-tab">

    <!-- Detection-bbox overlay -->
    <canvas ref="overlayCanvas" class="overlay-canvas" />

    <!-- Grid editor — only when AppShell has flipped the editor toggle -->
    <GridEditor
      v-if="editorOpen && sourceSize.w > 0"
      :grid="activeProfile.grid"
      :view-w="viewW"
      :view-h="viewH"
      :combined-scale="combinedScale"
      :offset-x="offsetX"
      :offset-y="offsetY"
      :source-w="sourceSize.w"
      :source-h="sourceSize.h"
      @update="(g) => emit('update-grid', g)"
    />

    <!-- ── HUD corners ──────────────────────────────────────────────────────── -->

    <div v-if="hasOrientation" class="hud hud-tl">
      <span class="hud-main">{{ headingDeg?.toFixed(0) ?? '---' }}°</span>
      <span class="hud-sub">{{ headingCardinal }}</span>
    </div>

    <!-- Altitude moved to bottom-left, stacked above GPS coords -->
    <div v-if="hasLocation && (gpsText || altitudeFt != null)" class="hud hud-bl">
      <div v-if="altitudeFt != null" class="hud-row">
        <span class="hud-main">{{ altitudeFt }}<span class="hud-unit">ft</span></span>
        <span class="hud-sub">ALT</span>
      </div>
      <span v-if="gpsText" class="hud-coords">{{ gpsText }}</span>
      <span v-if="gpsAcc != null" class="hud-sub">±{{ gpsAcc.toFixed(0) }}m</span>
    </div>

    <div v-if="hasLocation && speedKmh != null" class="hud hud-br">
      <span class="hud-main">{{ speedKmh }}<span class="hud-unit">km/h</span></span>
      <span class="hud-sub">SPD</span>
    </div>

    <!-- ── Sensor permission request ──────────────────────────────────────── -->

    <div v-if="needsPermission && !hasOrientation" class="prompt-layer">
      <div class="prompt-box">
        <p class="prompt-msg">Enable motion &amp; orientation sensors for compass heading</p>
        <button class="prompt-btn" @click="emit('enable-sensors')">Enable Sensors</button>
        <p v-if="permissionError" class="prompt-err">{{ permissionError }}</p>
      </div>
    </div>

    <!-- ── Camera / model error ────────────────────────────────────────────── -->

    <div v-if="cameraError || modelError" class="err-layer">
      <div class="err-box">
        <p v-if="cameraError">📷 {{ cameraError }}</p>
        <p v-if="modelError">🤖 {{ modelError }}</p>
        <button @click="cameraError ? emit('retry-camera') : emit('retry-model')">Retry</button>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Transparent overlay above the video, below the strips. */
.capture-tab {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  background: transparent;
  pointer-events: none;
}

.prompt-layer,
.err-layer {
  pointer-events: all;
}

/* ─── Overlay canvas ─────────────────────────────────────────────────────── */

.overlay-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}

/* ─── HUD ─────────────────────────────────────────────────────────────────── */

.hud {
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  gap: 2px;
}

.hud-tl {
  top: 10px;
  left: max(12px, env(safe-area-inset-left, 0px));
  align-items: flex-start;
}

.hud-bl {
  bottom: 10px;
  left: max(12px, env(safe-area-inset-left, 0px));
  align-items: flex-start;
}

.hud-br {
  bottom: 10px;
  right: max(12px, env(safe-area-inset-right, 0px));
  align-items: flex-end;
}

.hud-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.hud-main {
  font-family: monospace;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 5px rgba(0,0,0,0.95);
  line-height: 1;
}

.hud-unit {
  font-size: 11px;
  opacity: 0.55;
  margin-left: 2px;
}

.hud-sub {
  font-family: monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}

.hud-coords {
  font-family: monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.75);
  text-shadow: 0 1px 3px rgba(0,0,0,0.95);
}

/* ─── Prompts ─────────────────────────────────────────────────────────────── */

.prompt-layer {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.prompt-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 0 24px;
}

.prompt-msg {
  color: #ffbb77;
  font-size: 14px;
  margin: 0;
  max-width: 240px;
  line-height: 1.5;
}

.prompt-err {
  color: #f66;
  font-size: 12px;
  margin: 0;
  max-width: 220px;
}

.prompt-btn {
  background: rgba(255,102,0,0.18);
  border: 1px solid #ff6600;
  color: #ffaa55;
  padding: 12px 24px;
  border-radius: 10px;
  font-family: monospace;
  font-size: 14px;
  cursor: pointer;
}
.prompt-btn:active { background: rgba(255,102,0,0.35); }

/* ─── Errors ──────────────────────────────────────────────────────────────── */

.err-layer {
  position: absolute;
  inset: 0;
  z-index: 9;
  background: rgba(0,0,0,0.88);
  display: flex;
  align-items: center;
  justify-content: center;
}

.err-box {
  text-align: center;
  color: #f77;
  font-size: 14px;
  max-width: 80%;
}

.err-box p { margin: 0 0 12px; word-break: break-word; }

.err-box button {
  background: #2a2a2a;
  color: #ccc;
  border: 1px solid #555;
  padding: 10px 24px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.err-box button:active { background: #333; }
</style>
