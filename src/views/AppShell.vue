<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { useRouter } from 'vue-router'
import { useCamera } from '@/composables/useCamera'
import { useInferenceLoop } from '@/composables/useInferenceLoop'
import { useAlpr } from '@/composables/useAlpr'
import { usePrefs } from '@/composables/usePrefs'
import { useSensors } from '@/composables/useSensors'
import { useSession } from '@/composables/useSession'
import { useNetwork } from '@/composables/useNetwork'
import { useCaptureProfile } from '@/composables/useCaptureProfile'
import { buildDefaultProfile, type CaptureProfile, type TileGrid } from '@/capture/profile'
import type { WorkerDetection } from '@/packages/alpr/worker-protocol'
import type { SessionMode } from '@/storage/db'

import CaptureTab from '@/components/CaptureTab.vue'
import CaptureProfileMenu from '@/components/CaptureProfileMenu.vue'
import CameraControls from '@/components/CameraControls.vue'
import SessionsListTab from '@/components/SessionsListTab.vue'
import SettingsTab from '@/components/SettingsTab.vue'
import HelpTab from '@/components/HelpTab.vue'

defineOptions({ name: 'AppShell' })

const router = useRouter()

type TabId = 'capture' | 'sessions' | 'settings' | 'help'
const activeTab = ref<TabId>('capture')

const {
  videoRef, error: cameraError, capabilities, settings: cameraSettings,
  start: startCamera, stop: stopCamera, resume: resumeCamera,
  applyProfile: applyCameraProfile, enumerate,
} = useCamera()

const { backend, error: modelError, reinitializing, init: initModel, dispose: disposeModel } = useAlpr()
const {
  headingState, hasLocation, hasOrientation, needsPermission, permissionError,
  enableSensors, stop: stopSensors,
} = useSensors()
const session = useSession()
const { online } = useNetwork()
const captureProfile = useCaptureProfile()
const { prefs } = usePrefs()

const loopEnabled = ref(true)
const sourceSize = ref<{ w: number; h: number }>({ w: 0, h: 0 })

// Capture-tab chrome state
const editorOpen = ref(false)
const controlsOpen = ref(false)
const startMenuOpen = ref(false)

const profileFallback: CaptureProfile = { ...buildDefaultProfile('Default') } as CaptureProfile
const activeProfile = computed<CaptureProfile>(() => (captureProfile.active.value as CaptureProfile | null) ?? profileFallback)
const profilesView = computed<readonly CaptureProfile[]>(() => captureProfile.profiles.value as unknown as readonly CaptureProfile[])

function recordDetections(dets: WorkerDetection[]): void {
  if (!session.active.value) return
  for (const det of dets) {
    const loc = headingState.value.location
    session.record({
      plate: det.plate,
      confidence: det.confidence,
      charConfidences: det.charConfidences,
      bbox: det.bbox,
      detectorConfidence: det.detectorConfidence,
      latitude: headingState.value.latitude,
      longitude: headingState.value.longitude,
      heading: headingState.value.trueHeading,
      speedKph: loc?.speed != null ? Math.round(loc.speed * 3.6) : null,
      altitudeM: loc?.altitude != null ? Math.round(loc.altitude) : null,
      region: det.region,
      regionConfidence: det.regionConfidence,
      timestamp: Date.now(),
    })
  }
}

const targetFpsRef = computed(() => prefs.value.targetFps)

const {
  detections, achievedFps, tilesPerSecond, status: loopStatus,
  sourceSize: loopSourceSize,
} = useInferenceLoop(videoRef, {
  targetFps: targetFpsRef,
  enabled: loopEnabled,
  profile: activeProfile,
  onDetection: recordDetections,
})

const perfRatio = computed(() => {
  const target = targetFpsRef.value
  const achieved = achievedFps.value
  if (target <= 0 || achieved <= 0) return 0
  return Math.min(achieved / target, 1)
})

const perfColor = computed(() => {
  if (perfRatio.value >= 0.9) return '#24ff0c'
  if (perfRatio.value >= 0.5) return '#ffaa00'
  return '#f44'
})

watch(loopSourceSize, (s) => { sourceSize.value = s }, { immediate: true })

function switchTab(tab: TabId): void {
  activeTab.value = tab
}

function goToSession(id: number): void {
  router.push(`/sessions/${id}`)
}

function newProfile(): void {
  router.push('/profiles/new')
}
function editActiveProfile(): void {
  const id = captureProfile.activeId.value
  router.push(id != null ? `/profiles/${id}` : '/profiles/new')
}

async function onStartSession(mode: SessionMode): Promise<void> {
  startMenuOpen.value = false
  const profileId = captureProfile.activeId.value ?? undefined
  await session.start({ mode, captureProfileId: profileId })
}

function onGridUpdate(grid: TileGrid): void {
  const next: CaptureProfile = { ...activeProfile.value, grid, updatedAt: Date.now() }
  captureProfile.save(next)
}

function onCameraControlsPatch(partial: Partial<CaptureProfile>): void {
  const next: CaptureProfile = { ...activeProfile.value, ...partial, updatedAt: Date.now() }
  captureProfile.save(next)
  applyCameraProfile(next)
}

// When the active profile changes (user picked another from the menu, or it
// just finished loading from the DB), reconfigure the live camera + loop.
watch(activeProfile, async (p, prev) => {
  if (!p) return
  if (prev && p.id === prev.id && p.updatedAt === prev.updatedAt) return
  await applyCameraProfile(p)
}, { deep: true })

async function onModelsChanged(): Promise<void> {
  // Re-init the ALPR worker with the newly-selected models.
  await disposeModel()
  await initModel()
}

const statusText = computed(() => {
  const parts: string[] = []
  if (!online.value) {
    parts.push('OFFLINE')
  } else {
    if (loopStatus.value === 'running' || loopStatus.value === 'busy') {
      parts.push(`${achievedFps.value} FPS`)
      if (tilesPerSecond.value > achievedFps.value) {
        // Only show TPS when it differs meaningfully from FPS (i.e. the grid is
        // dispatching more than 1 tile per tick).
        parts.push(`${tilesPerSecond.value} TPS`)
      }
    }
    parts.push(backend.value ? backend.value.toUpperCase() : 'LOADING…')
  }
  if (cameraError.value) parts.push('CAM ERR')
  if (modelError.value) parts.push('MODEL ERR')
  return parts.join(' · ') || 'READY'
})

function fmtConf(c: number): string {
  return `${Math.round(c * 100)}%`
}

onMounted(async () => {
  await captureProfile.load()
  await initModel()
  await startCamera(activeProfile.value)
  await enumerate()
  await enableSensors()

  window.addEventListener('orientationchange', onOrientationChange)
  screen.orientation?.addEventListener?.('change', onOrientationChange)
})

onUnmounted(() => {
  window.removeEventListener('orientationchange', onOrientationChange)
  screen.orientation?.removeEventListener?.('change', onOrientationChange)
  session.stop()
  stopCamera()
  disposeModel()
  stopSensors()
})

async function onOrientationChange(): Promise<void> {
  await resumeCamera()
}

onActivated(async () => {
  await resumeCamera()
  loopEnabled.value = true
})
onDeactivated(() => { loopEnabled.value = false })
</script>

<template>
  <div class="app-shell">

    <!-- ── Status bar ──────────────────────────────────────────────────────── -->
    <div class="status-bar">
      <span class="status-left">ALPRme</span>
      <span class="status-mid">
        <template v-if="reinitializing">LOADING MODEL…</template>
        <template v-else>{{ statusText }}</template>
        <span
          v-if="!reinitializing && loopStatus === 'running' && achievedFps > 0"
          class="perf-dot"
          :style="{ background: perfColor }"
          :title="`${achievedFps}/${targetFpsRef} FPS`"
        />
      </span>
      <span class="status-right">
        <span v-if="session.active.value && session.mode.value === 'diagnostic'" class="diag-tag" title="Diagnostic session — logging all detections">DIAG</span>
        <span v-if="session.active.value" class="rec-dot" title="Recording active">●</span>
      </span>
    </div>

    <!-- ── Capture top strip (profile + edit + gear). Only on the Capture tab. -->
    <div v-if="activeTab === 'capture'" class="capture-top">
      <CaptureProfileMenu
        :profiles="profilesView"
        :active-id="activeProfile.id ?? null"
        @select="(id) => captureProfile.setActive(id)"
        @edit="editActiveProfile"
        @new="newProfile"
      />
      <button
        class="cap-tool-btn"
        :class="{ on: editorOpen }"
        title="Edit detection grid"
        @click="editorOpen = !editorOpen"
      >&#x2370;</button>
      <button
        class="cap-tool-btn"
        :class="{ on: controlsOpen }"
        title="Camera controls"
        @click="controlsOpen = !controlsOpen"
      >&#x2699;&#xFE0F;</button>
    </div>

    <!-- ── Camera area: video + overlays. Letterbox so the whole sensor shows. -->
    <div class="camera-area">
      <video
        ref="videoRef"
        autoplay
        playsinline
        muted
        class="camera-video"
      />

      <CaptureTab
        v-show="activeTab === 'capture'"
        :detections="detections"
        :heading-state="headingState"
        :has-location="hasLocation"
        :has-orientation="hasOrientation"
        :needs-permission="needsPermission"
        :permission-error="permissionError"
        :camera-error="cameraError"
        :model-error="modelError"
        :video-el="videoRef"
        :is-visible="activeTab === 'capture'"
        :source-size="sourceSize"
        :active-profile="activeProfile"
        :editor-open="editorOpen"
        @enable-sensors="enableSensors"
        @retry-camera="startCamera(activeProfile)"
        @retry-model="initModel()"
        @update-grid="onGridUpdate"
      />

      <SessionsListTab
        v-show="activeTab === 'sessions'"
        :session-active="session.active.value"
        :is-visible="activeTab === 'sessions'"
        @switch-to-live="switchTab('capture')"
        @go-to-session="goToSession"
      />

      <SettingsTab
        v-show="activeTab === 'settings'"
        :disabled="loopEnabled && loopStatus !== 'idle'"
        @models-changed="onModelsChanged"
      />

      <HelpTab
        v-show="activeTab === 'help'"
      />

      <!-- Re-initialization loading overlay -->
      <div v-if="reinitializing" class="init-overlay">
        <div class="init-spinner">Loading model…</div>
      </div>
    </div>

    <!-- ── Capture bottom strip (live plate log + record). Only on Capture. -->
    <div v-if="activeTab === 'capture'" class="capture-bottom">
      <div v-if="session.active.value && session.recent.value.length > 0" class="plates-list">
        <div
          v-for="p in session.recent.value"
          :key="`${p.plate}-${p.timestamp}`"
          class="plate-row"
        >
          <span class="plate-text">{{ p.plate }}</span>
          <span class="plate-conf">{{ fmtConf(p.confidence) }}</span>
        </div>
      </div>
      <div v-else-if="session.active.value" class="plates-idle">
        Watching for plates… · {{ session.count.value }} recorded
      </div>

      <div class="ctrl-row">
        <div class="rec-wrap">
          <button
            v-if="session.active.value"
            class="btn-record recording"
            @click="session.stop()"
          >
            ■ &nbsp;Stop
            <span v-if="session.mode.value === 'diagnostic'" class="diag-badge">DIAG</span>
            &nbsp;<span class="rec-count">{{ session.count.value }} plates</span>
          </button>
          <template v-else>
            <button class="btn-record" @click="onStartSession('normal')">
              ● &nbsp;Start Recording
            </button>
            <button
              class="btn-record-caret"
              :class="{ open: startMenuOpen }"
              @click="startMenuOpen = !startMenuOpen"
              title="More recording options"
            >▾</button>
            <div v-if="startMenuOpen" class="start-menu">
              <button class="start-menu-item" @click="onStartSession('diagnostic')">
                <strong>Start (Diagnostic)</strong>
                <span class="start-menu-desc">log all detections + decision traces</span>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Camera-controls drawer (teleported to body so its clicks aren't swallowed). -->
    <CameraControls
      :open="controlsOpen"
      :capabilities="capabilities"
      :profile="activeProfile"
      :camera-settings="cameraSettings"
      @close="controlsOpen = false"
      @update="onCameraControlsPatch"
    />

    <!-- ── Tab bar ─────────────────────────────────────────────────────────── -->
    <div class="tab-bar">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'capture' }"
        @click="switchTab('capture')"
      >
        <span class="tab-icon">&#x1F4F7;</span>
        <span class="tab-label">Capture</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'sessions' }"
        @click="switchTab('sessions')"
      >
        <span class="tab-icon">&#x1F4CB;</span>
        <span class="tab-label">Sessions</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'settings' }"
        @click="switchTab('settings')"
      >
        <span class="tab-icon">&#x2699;&#xFE0F;</span>
        <span class="tab-label">Settings</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'help' }"
        @click="switchTab('help')"
      >
        <span class="tab-icon">&#x2753;</span>
        <span class="tab-label">Help</span>
      </button>
    </div>

  </div>
</template>

<style scoped>
.app-shell {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #000;
  color: #ccc;
  font-family: system-ui, monospace;
  user-select: none;
}

/* ─── Status bar ──────────────────────────────────────────────────────────── */

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  padding-top: max(4px, env(safe-area-inset-top, 0px));
  padding-left: max(12px, env(safe-area-inset-left, 0px));
  padding-right: max(12px, env(safe-area-inset-right, 0px));
  background: rgba(0,0,0,0.95);
  min-height: 26px;
  z-index: 30;
  flex-shrink: 0;
}

.status-left {
  font-size: 11px;
  font-weight: 700;
  color: #24ff0c;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.status-mid {
  flex: 1;
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-right {
  flex-shrink: 0;
  min-width: 18px;
  text-align: right;
}

.rec-dot {
  color: #f44;
  font-size: 12px;
  animation: pulse 1.4s ease-in-out infinite;
}

.diag-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #ffaa55;
  border: 1px solid rgba(255,170,80,0.6);
  background: rgba(255,170,80,0.15);
  padding: 1px 4px;
  border-radius: 3px;
  margin-right: 6px;
  vertical-align: middle;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.perf-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-left: 5px;
  vertical-align: middle;
  flex-shrink: 0;
}

.init-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(0,0,0,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
}

.init-spinner {
  color: #ffaa55;
  font-family: monospace;
  font-size: 14px;
  animation: pulse 1s ease-in-out infinite;
}

/* ─── Capture top strip ──────────────────────────────────────────────────── */

.capture-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(0,0,0,0.92);
  border-bottom: 1px solid #1e1e1e;
  flex-shrink: 0;
  z-index: 25;
}

.cap-tool-btn {
  width: 32px;
  height: 32px;
  background: rgba(255,255,255,0.04);
  border: 1px solid #333;
  border-radius: 16px;
  color: #ccc;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cap-tool-btn:active { background: rgba(255,255,255,0.10); }
.cap-tool-btn.on {
  border-color: #24ff0c;
  color: #24ff0c;
  background: rgba(36,255,12,0.10);
}

/* ─── Camera area (letterboxed) ──────────────────────────────────────────── */

.camera-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #000;
}

.camera-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* contain = show the whole sensor area, letterbox the long side */
  object-fit: contain;
  background: #000;
  z-index: 0;
}

/* ─── Capture bottom strip ───────────────────────────────────────────────── */

.capture-bottom {
  flex-shrink: 0;
  background: rgba(0,0,0,0.95);
  border-top: 1px solid #1e1e1e;
  z-index: 25;
}

.plates-list {
  max-height: 136px;
  overflow-y: auto;
}

.plate-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.plate-row:first-child {
  background: rgba(36,255,12,0.06);
}

.plate-text {
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 1.5px;
}

.plate-conf {
  font-family: monospace;
  font-size: 12px;
  color: #24ff0c;
}

.plates-idle {
  padding: 6px 16px;
  font-family: monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.38);
  text-align: center;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.ctrl-row {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  padding-bottom: max(10px, env(safe-area-inset-bottom, 0px));
  align-items: stretch;
}

.rec-wrap {
  position: relative;
  display: flex;
  flex: 1;
  gap: 1px;
}

.btn-record {
  flex: 1;
  background: rgba(220,30,30,0.12);
  border: 1px solid rgba(220,60,60,0.4);
  color: #f66;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-family: monospace;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  min-height: 48px;
}

.btn-record.recording {
  background: rgba(220,30,30,0.22);
  border-color: #f44;
  color: #f99;
}

.btn-record:active { opacity: 0.7; }

.btn-record-caret {
  background: rgba(220,30,30,0.12);
  border: 1px solid rgba(220,60,60,0.4);
  border-left: none;
  color: #f66;
  padding: 0 14px;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  font-family: monospace;
  font-size: 14px;
  font-weight: 700;
}
.btn-record-caret.open { background: rgba(220,30,30,0.22); }

.rec-wrap .btn-record:not(.recording) {
  border-radius: 8px 0 0 8px;
}

.start-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: #1c1c1c;
  border: 1px solid #444;
  border-radius: 8px;
  min-width: 220px;
  z-index: 30;
  overflow: hidden;
}

.start-menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  background: none;
  border: none;
  color: #ccc;
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
  font-family: monospace;
  font-size: 13px;
  gap: 2px;
}
.start-menu-item:active { background: #2a2a2a; }
.start-menu-item strong { color: #ffaa55; font-weight: 700; }

.start-menu-desc { font-size: 10px; color: #777; }

.rec-count { font-size: 12px; font-weight: 400; opacity: 0.7; }

.diag-badge {
  display: inline-block;
  background: rgba(255,170,80,0.18);
  border: 1px solid rgba(255,170,80,0.6);
  color: #ffaa55;
  font-size: 9px;
  letter-spacing: 1px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
  vertical-align: middle;
}

/* ─── Tab bar ─────────────────────────────────────────────────────────────── */

.tab-bar {
  display: flex;
  background: rgba(0,0,0,0.95);
  border-top: 1px solid #1e1e1e;
  padding: 4px 0;
  padding-bottom: max(4px, env(safe-area-inset-bottom, 0px));
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  flex-shrink: 0;
  z-index: 30;
}

.tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: none;
  border: none;
  color: #555;
  padding: 6px 4px;
  cursor: pointer;
  font-family: inherit;
  transition: color 0.15s;
}

.tab-btn.active { color: #24ff0c; }
.tab-btn:active { color: #aaa; }

.tab-icon { font-size: 18px; line-height: 1; }
.tab-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
