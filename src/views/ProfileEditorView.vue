<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCaptureProfile } from '@/composables/useCaptureProfile'
import { useCamera } from '@/composables/useCamera'
import { useAlpr } from '@/composables/useAlpr'
import {
  buildDefaultProfile,
  defaultsFromCapabilities,
  suggestResolution,
  resizeGrid,
  type CaptureProfile,
  type CaptureMode,
  type ResolutionRequest,
  type TileGrid,
} from '@/capture/profile'
import CameraControls from '@/components/CameraControls.vue'
import GridEditor from '@/components/GridEditor.vue'

defineOptions({ name: 'ProfileEditorView' })

const route = useRoute()
const router = useRouter()
const captureProfile = useCaptureProfile()
const {
  videoRef, capabilities, settings: cameraSettings,
  start: startCamera, stop: stopCamera, applyProfile: applyCameraProfile,
} = useCamera()
const { detectorInputSize } = useAlpr()

// Working copy of the profile being edited.
const draft = ref<CaptureProfile>(buildDefaultProfile('New profile') as CaptureProfile)
const ready = ref(false)
const isNew = ref(false)
const saveError = ref<string | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const sourceSize = computed(() => cameraSettings.value
  ? { w: cameraSettings.value.width, h: cameraSettings.value.height }
  : { w: 0, h: 0 })
const modelInputSize = computed(() => detectorInputSize.value ?? { w: 384, h: 384 })

// Overlay transform — matches CaptureTab's contain math.
const viewW = ref(0)
const viewH = ref(0)
const combinedScale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
let resizeObserver: ResizeObserver | null = null

function updateTransform(): void {
  const video = videoRef.value
  const el = containerRef.value
  if (!video || !el) return
  const cw = el.clientWidth
  const ch = el.clientHeight
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh || !cw || !ch) return
  viewW.value = cw
  viewH.value = ch
  const displayScale = Math.min(cw / vw, ch / vh)
  offsetX.value = (cw - vw * displayScale) / 2
  offsetY.value = (ch - vh * displayScale) / 2
  combinedScale.value = displayScale
}

const RESOLUTION_PRESETS: Array<{ label: string; value: ResolutionRequest }> = [
  { label: 'Max',   value: 'max' },
  { label: '4K',    value: { width: 3840, height: 2160 } },
  { label: '1080p', value: { width: 1920, height: 1080 } },
  { label: '720p',  value: { width: 1280, height: 720 } },
  { label: '480p',  value: { width: 640,  height: 480 } },
]

function resolutionLabel(r: ResolutionRequest): string {
  if (r === 'max') return 'Max'
  if (r.width === 3840) return '4K'
  if (r.width === 1920) return '1080p'
  if (r.width === 1280) return '720p'
  if (r.width === 640) return '480p'
  return `${r.width}×${r.height}`
}

onMounted(async () => {
  await captureProfile.load()
  const idParam = route.params.id
  isNew.value = idParam === 'new'

  if (isNew.value) {
    // Start with a minimal default; capability-derived camera fields are
    // merged in after the stream is up.
    draft.value = buildDefaultProfile('New profile') as CaptureProfile
  } else {
    const id = Number(idParam)
    const found = captureProfile.findById(id) as CaptureProfile | null
    if (!found) {
      router.replace('/capture')
      return
    }
    // Deep-copy the grid so cell toggles don't mutate the persisted record
    // until Save is clicked.
    draft.value = {
      ...found,
      grid: { ...found.grid, enabled: [...found.grid.enabled] },
    }
  }

  await startCamera(draft.value)

  if (isNew.value) {
    // Hardware-aware initial settings — zoom at min, continuous focus, etc.,
    // depending on what the device advertises.
    const caps = capabilities.value
    const derived = defaultsFromCapabilities(caps)
    draft.value = { ...draft.value, ...derived, updatedAt: Date.now() } as CaptureProfile
    // Apply immediately so the live preview reflects the derived values.
    await applyCameraProfile(draft.value)
  }

  ready.value = true

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(updateTransform)
    resizeObserver.observe(containerRef.value)
  }
  videoRef.value?.addEventListener('loadedmetadata', updateTransform)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  videoRef.value?.removeEventListener('loadedmetadata', updateTransform)
  stopCamera()
})

// ─── Mutators ───────────────────────────────────────────────────────────────

async function onPatch(partial: Partial<CaptureProfile>): Promise<void> {
  draft.value = { ...draft.value, ...partial, updatedAt: Date.now() }
  await applyCameraProfile(draft.value)
}

function onGridUpdate(grid: TileGrid): void {
  draft.value = { ...draft.value, grid, updatedAt: Date.now() }
}

function setCols(cols: number): void {
  const next = resizeGrid(draft.value.grid, cols, draft.value.grid.rows)
  draft.value = { ...draft.value, grid: next, updatedAt: Date.now() }
}
function setRows(rows: number): void {
  const next = resizeGrid(draft.value.grid, draft.value.grid.cols, rows)
  draft.value = { ...draft.value, grid: next, updatedAt: Date.now() }
}

async function setCaptureMode(mode: CaptureMode): Promise<void> {
  // Switching mode auto-snaps the resolution to the mode-appropriate default.
  // The user can override afterwards.
  const resolution = suggestResolution(mode, modelInputSize.value)
  draft.value = { ...draft.value, captureMode: mode, resolution, updatedAt: Date.now() }
  await applyCameraProfile(draft.value)
}

async function selectResolution(r: ResolutionRequest): Promise<void> {
  draft.value = { ...draft.value, resolution: r, updatedAt: Date.now() }
  await applyCameraProfile(draft.value)
}

async function snapResolutionToDefault(): Promise<void> {
  await selectResolution(suggestResolution(draft.value.captureMode, modelInputSize.value))
}

// ─── Save / cancel / delete ─────────────────────────────────────────────────

async function save(): Promise<void> {
  saveError.value = null
  try {
    const id = await captureProfile.save(draft.value)
    await captureProfile.setActive(id)
    router.push('/capture')
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}

async function deleteProfile(): Promise<void> {
  if (draft.value.id == null) {
    router.push('/capture')
    return
  }
  await captureProfile.remove(draft.value.id)
  router.push('/capture')
}

function cancel(): void {
  router.push('/capture')
}

// Bind resolution dropdown to a string key.
const resolutionKey = computed({
  get: () => resolutionLabel(draft.value.resolution),
  set: (label: string) => {
    const preset = RESOLUTION_PRESETS.find(p => p.label === label)
    if (preset) selectResolution(preset.value)
  },
})

// Re-update transform when the camera renegotiates (resolution change etc.).
watch(sourceSize, () => updateTransform())
</script>

<template>
  <div class="pe-root">
    <div class="pe-head">
      <button class="pe-btn" @click="cancel">&larr; Cancel</button>
      <input v-model="draft.name" class="pe-name" placeholder="Profile name" />
      <button class="pe-btn primary" @click="save">Save</button>
    </div>

    <div v-if="saveError" class="pe-error">{{ saveError }}</div>

    <div ref="containerRef" class="pe-stage">
      <video ref="videoRef" autoplay playsinline muted class="pe-video" />
      <GridEditor
        v-if="ready && sourceSize.w > 0 && draft.captureMode === 'tiled'"
        :grid="draft.grid"
        :view-w="viewW"
        :view-h="viewH"
        :combined-scale="combinedScale"
        :offset-x="offsetX"
        :offset-y="offsetY"
        :source-w="sourceSize.w"
        :source-h="sourceSize.h"
        @update="onGridUpdate"
      />
    </div>

    <div class="pe-side">
      <!-- Capture configuration -->
      <div class="pe-section">
        <div class="pe-section-label">Capture</div>

        <div class="pe-row">
          <span>Mode</span>
          <div class="pe-segmented">
            <button
              class="pe-seg"
              :class="{ active: draft.captureMode === 'tiled' }"
              @click="setCaptureMode('tiled')"
            >Tiled</button>
            <button
              class="pe-seg"
              :class="{ active: draft.captureMode === 'whole-frame' }"
              @click="setCaptureMode('whole-frame')"
            >Whole frame</button>
          </div>
        </div>

        <div class="pe-row">
          <span>Resolution</span>
          <select v-model="resolutionKey" class="pe-select">
            <option v-for="p in RESOLUTION_PRESETS" :key="p.label" :value="p.label">
              {{ p.label }}
            </option>
          </select>
          <button class="pe-btn-small" @click="snapResolutionToDefault" title="Snap to the mode default">↺</button>
        </div>

        <div class="pe-row" :class="{ disabled: draft.captureMode === 'whole-frame' }">
          <span>Grid cols</span>
          <input
            type="range" min="1" max="6" step="1"
            :value="draft.grid.cols"
            :disabled="draft.captureMode === 'whole-frame'"
            @input="setCols(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="pe-val">{{ draft.grid.cols }}</span>
        </div>
        <div class="pe-row" :class="{ disabled: draft.captureMode === 'whole-frame' }">
          <span>Grid rows</span>
          <input
            type="range" min="1" max="6" step="1"
            :value="draft.grid.rows"
            :disabled="draft.captureMode === 'whole-frame'"
            @input="setRows(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="pe-val">{{ draft.grid.rows }}</span>
        </div>

        <div class="pe-row" :class="{ disabled: draft.captureMode === 'whole-frame' }">
          <span>Tile overlap</span>
          <input
            type="range" min="0" max="0.49" step="0.05"
            :value="draft.tileOverlap"
            :disabled="draft.captureMode === 'whole-frame'"
            @input="onPatch({ tileOverlap: Number(($event.target as HTMLInputElement).value) })"
          />
          <span class="pe-val">{{ (draft.tileOverlap * 100).toFixed(0) }}%</span>
        </div>
        <div class="pe-row" :class="{ disabled: draft.captureMode === 'whole-frame' }">
          <span>Max tiles/frame</span>
          <input
            type="range" min="1" max="12" step="1"
            :value="draft.maxTilesPerFrame"
            :disabled="draft.captureMode === 'whole-frame'"
            @input="onPatch({ maxTilesPerFrame: Number(($event.target as HTMLInputElement).value) })"
          />
          <span class="pe-val">{{ draft.maxTilesPerFrame }}</span>
        </div>
      </div>

      <!-- Live camera controls -->
      <CameraControls
        :open="true"
        inline
        :capabilities="capabilities"
        :profile="draft"
        :camera-settings="cameraSettings"
        @close="() => {}"
        @update="onPatch"
      />

      <button
        v-if="!isNew && draft.id != null"
        class="pe-btn danger"
        @click="deleteProfile"
      >Delete profile</button>
    </div>
  </div>
</template>

<style scoped>
.pe-root {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-rows: 48px 1fr;
  grid-template-columns: 1fr 340px;
  grid-template-areas:
    "head head"
    "stage side";
  background: #111;
  color: #ccc;
  font-family: system-ui, monospace;
}

@media (max-width: 720px) {
  .pe-root {
    grid-template-columns: 1fr;
    grid-template-rows: 48px minmax(40vh, 1fr) auto;
    grid-template-areas:
      "head"
      "stage"
      "side";
  }
}

.pe-head {
  grid-area: head;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
}

.pe-name {
  flex: 1;
  background: #222;
  color: #fff;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 6px 10px;
  font-family: inherit;
  font-size: 14px;
}

.pe-btn {
  background: #222;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.pe-btn:active { background: #2a2a2a; }
.pe-btn.primary {
  border-color: #24ff0c66;
  color: #24ff0c;
  background: #24ff0c11;
}
.pe-btn.primary:active { background: #24ff0c22; }
.pe-btn.danger { color: #f66; border-color: #633; margin: 14px; }
.pe-btn.danger:active { background: #300; }

.pe-error {
  padding: 8px 14px;
  background: #300;
  color: #f66;
  border-bottom: 1px solid #633;
  font-size: 13px;
}

.pe-btn-small {
  background: #222;
  border: 1px solid #444;
  color: #aaa;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.pe-btn-small:active { background: #2a2a2a; }

.pe-stage {
  grid-area: stage;
  position: relative;
  background: #000;
  overflow: hidden;
}

.pe-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.pe-side {
  grid-area: side;
  background: #1a1a1a;
  border-left: 1px solid #333;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.pe-section {
  padding: 14px;
  border-bottom: 1px solid #222;
}

.pe-section-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 8px;
}

.pe-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
  color: #ccc;
}

.pe-row > span:first-child { width: 100px; color: #aaa; }

.pe-row.disabled { opacity: 0.4; }
.pe-row.disabled input,
.pe-row.disabled .pe-segmented .pe-seg { cursor: not-allowed; }

.pe-row input[type="range"] { flex: 1; accent-color: #24ff0c; min-width: 0; }
.pe-row .pe-val { min-width: 40px; text-align: right; color: #888; font-size: 11px; }

.pe-select {
  flex: 1;
  background: #222;
  color: #ddd;
  border: 1px solid #333;
  padding: 4px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
}

.pe-segmented {
  flex: 1;
  display: flex;
  gap: 0;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
}
.pe-seg {
  flex: 1;
  background: #1a1a1a;
  color: #aaa;
  border: none;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.pe-seg + .pe-seg { border-left: 1px solid #333; }
.pe-seg.active {
  background: rgba(36,255,12,0.10);
  color: #24ff0c;
}
</style>
