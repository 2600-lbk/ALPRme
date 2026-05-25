<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePrefs } from '@/composables/usePrefs'
import { useCaptureProfile } from '@/composables/useCaptureProfile'
import {
  STAGE1_MODELS, STAGE2_MODELS, OCR_CONFIG_URLS,
  DEFAULT_STAGE1_KEY, DEFAULT_STAGE2_KEY,
  type ModelEntry,
} from '@/setup/modelCatalog'

const router = useRouter()
const step = ref(1)
const { prefs, save, load } = usePrefs()
const captureProfile = useCaptureProfile()

onMounted(async () => {
  await load()
  if (prefs.value.detectorUrl && prefs.value.ocrUrl) {
    router.replace('/capture')
  }
})

const defaultStage1 = STAGE1_MODELS.find((m) => m.key === DEFAULT_STAGE1_KEY) ?? STAGE1_MODELS[0]!
const defaultStage2 = STAGE2_MODELS.find((m) => m.key === DEFAULT_STAGE2_KEY) ?? STAGE2_MODELS[0]!
const selectedStage1 = ref(defaultStage1)
const selectedStage2 = ref(defaultStage2)

const steps = ['Permissions', 'Models', 'Capture']

const permCamera = ref(false)
const permOrientation = ref(false)
const permDenied = ref<string | null>(null)

async function requestPermissions(): Promise<void> {
  permDenied.value = null

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
    stream.getTracks().forEach((t) => t.stop())
    permCamera.value = true
  } catch {
    permDenied.value = 'Camera permission denied. The app needs camera access to detect plates.'
    return
  }

  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      const perm = await (DeviceOrientationEvent as any).requestPermission()
      if (perm === 'granted') {
        permOrientation.value = true
      } else {
        permDenied.value = 'Motion & Orientation permission denied. Heading data will be unavailable.'
      }
    } else {
      permOrientation.value = true
    }
  } catch {
    permDenied.value = 'Orientation permission not available on this browser.'
  }
}

function selectStage1(model: ModelEntry): void {
  selectedStage1.value = model
}

function selectStage2(model: ModelEntry): void {
  selectedStage2.value = model
}

const modelSizeTotalMB = computed(() =>
  selectedStage1.value.sizeMB + selectedStage2.value.sizeMB,
)

async function commitModels(): Promise<void> {
  await save({
    detectorUrl: selectedStage1.value.path,
    ocrUrl: selectedStage2.value.path,
    ocrConfigUrl: OCR_CONFIG_URLS[selectedStage2.value.key] ?? '',
  })
  // Ensure the captureProfiles table is seeded with a default before step 3
  // lets the user choose Quick start vs Configure.
  await captureProfile.load()
  step.value = 3
}

async function quickStart(): Promise<void> {
  router.push('/capture')
}

async function configureCapture(): Promise<void> {
  // Land in the profile editor pre-loaded with the auto-seeded default profile.
  await captureProfile.load()
  const id = captureProfile.activeId.value
  router.push(id != null ? `/profiles/${id}` : '/profiles/new')
}
</script>

<template>
  <div class="setup-view">
    <div class="setup-header">
      <h1>ALPRme</h1>
      <div class="step-indicator">
        <span
          v-for="(label, i) in steps"
          :key="label"
          class="step-dot"
          :class="{ active: step === i + 1, done: step > i + 1 }"
        >
          {{ step > i + 1 ? '&#x2713;' : i + 1 }}
        </span>
      </div>
    </div>

    <!-- Step 1: Permissions -->
    <div v-if="step === 1" class="setup-step">
      <h2>Permissions</h2>
      <p class="step-desc">
        ALPRme needs camera access to detect plates and orientation access for
        heading data. All processing is local — nothing leaves your device.
      </p>

      <div class="perm-list">
        <div class="perm-item" :class="{ granted: permCamera }">
          <span class="perm-icon">{{ permCamera ? '&#x2713;' : '&#x1F4F7;' }}</span>
          <span class="perm-label">Camera</span>
          <span class="perm-status">{{ permCamera ? 'Granted' : 'Required' }}</span>
        </div>
        <div class="perm-item" :class="{ granted: permOrientation }">
          <span class="perm-icon">{{ permOrientation ? '&#x2713;' : '&#x1F9ED;' }}</span>
          <span class="perm-label">Orientation</span>
          <span class="perm-status">{{ permOrientation ? 'Granted' : 'Required' }}</span>
        </div>
      </div>

      <p v-if="permDenied" class="perm-denied">{{ permDenied }}</p>

      <div class="step-actions">
        <button
          v-if="!permCamera || !permOrientation"
          class="setup-btn primary"
          @click="requestPermissions"
        >
          Enable Permissions
        </button>
        <button
          v-else
          class="setup-btn primary"
          @click="step = 2"
        >
          Continue
        </button>
      </div>
    </div>

    <!-- Step 2: Model Selection -->
    <div v-if="step === 2" class="setup-step">
      <h2>Detector Size</h2>
      <p class="step-desc">Smaller is faster, larger is more accurate at a distance.</p>

      <div class="model-list">
        <div
          v-for="m in STAGE1_MODELS"
          :key="m.key"
          class="model-card"
          :class="{ selected: selectedStage1.key === m.key }"
          @click="selectStage1(m)"
        >
          <div class="model-name">{{ m.name }}</div>
          <div class="model-desc">{{ m.description }}</div>
          <div class="model-meta">
            <span>{{ m.inputSize }}</span>
            <span>{{ m.sizeMB }} MB</span>
          </div>
        </div>
      </div>

      <h2>OCR Size</h2>
      <p class="step-desc">Smaller is faster. Both handle North American plates.</p>

      <div class="model-list">
        <div
          v-for="m in STAGE2_MODELS"
          :key="m.key"
          class="model-card"
          :class="{ selected: selectedStage2.key === m.key }"
          @click="selectStage2(m)"
        >
          <div class="model-name">{{ m.name }}</div>
          <div class="model-desc">{{ m.description }}</div>
          <div class="model-meta">
            <span>{{ m.inputSize }}</span>
            <span>{{ m.sizeMB }} MB</span>
          </div>
        </div>
      </div>

      <p class="size-summary">
        Total model size: {{ modelSizeTotalMB.toFixed(1) }} MB
      </p>

      <div class="step-actions">
        <button class="setup-btn" @click="step = 1">Back</button>
        <button class="setup-btn primary" @click="commitModels">
          Continue
        </button>
      </div>
    </div>

    <!-- Step 3: Capture profile -->
    <div v-if="step === 3" class="setup-step">
      <h2>Capture profile</h2>
      <p class="step-desc">
        Capture profiles bundle the camera resolution, zoom, focus, exposure, torch,
        and the detection windows (regions of the frame the detector scans). A
        default full-frame profile is ready to go; you can tune one to match a
        specific scene (front gate, highway dash, parking lot) and switch between
        profiles from the Capture tab.
      </p>

      <div class="profile-cta">
        <button class="setup-btn primary" @click="quickStart">
          Quick start
        </button>
        <p class="profile-cta-desc">Use the default full-frame profile. You can edit it later.</p>
      </div>

      <div class="profile-cta">
        <button class="setup-btn" @click="configureCapture">
          Configure now
        </button>
        <p class="profile-cta-desc">Open the profile editor: tune camera controls and draw detection windows over the live preview.</p>
      </div>

      <div class="step-actions">
        <button class="setup-btn" @click="step = 2">Back</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-view {
  min-height: 100vh;
  min-height: 100dvh;
  background: #111;
  color: #ccc;
  font-family: system-ui, monospace;
  padding: 24px 16px;
  padding-top: max(24px, env(safe-area-inset-top, 0px));
  padding-bottom: max(24px, env(safe-area-inset-bottom, 0px));
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.setup-header {
  text-align: center;
  margin-bottom: 24px;
  flex-shrink: 0;
}

.setup-header h1 {
  margin: 0 0 12px;
  font-size: 24px;
  color: #fff;
  font-weight: 600;
}

.step-indicator {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #444;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}

.step-dot.active {
  border-color: #24ff0c;
  color: #24ff0c;
}

.step-dot.done {
  border-color: #24ff0c;
  background: #24ff0c22;
  color: #24ff0c;
}

.setup-step {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.setup-step h2 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #fff;
}

.setup-step h2:not(:first-child) {
  margin-top: 20px;
}

.step-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: #666;
  line-height: 1.5;
}

.perm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.perm-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 12px 14px;
}

.perm-item.granted {
  border-color: #24ff0c44;
}

.perm-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.perm-label {
  flex: 1;
  font-size: 14px;
  color: #ddd;
}

.perm-status {
  font-size: 11px;
  color: #666;
}

.perm-item.granted .perm-status {
  color: #4a4;
}

.perm-denied {
  color: #f44;
  font-size: 12px;
  margin: 0 0 12px;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.model-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.1s;
}

.model-card.selected {
  border-color: #24ff0c;
}

.model-card:active {
  background: #222;
}

.model-name {
  font-size: 14px;
  color: #ddd;
  font-weight: 600;
  margin-bottom: 3px;
}

.model-desc {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
  line-height: 1.4;
}

.model-meta {
  display: flex;
  gap: 10px;
  font-size: 10px;
  color: #555;
}

.size-summary {
  font-size: 12px;
  color: #555;
  margin: 8px 0 0;
  text-align: center;
}

.step-actions {
  display: flex;
  gap: 10px;
  padding-top: 16px;
  flex-shrink: 0;
  margin-top: auto;
}

.setup-btn {
  flex: 1;
  background: #222;
  border: 1px solid #444;
  color: #aaa;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  text-align: center;
}

.setup-btn:active {
  color: #fff;
  border-color: #666;
}

.setup-btn.primary {
  border-color: #24ff0c66;
  color: #24ff0c;
  background: #24ff0c11;
}

.setup-btn.primary:active {
  background: #24ff0c22;
}

.profile-cta {
  margin: 10px 0 20px;
}

.profile-cta .setup-btn {
  width: 100%;
}

.profile-cta-desc {
  margin: 8px 0 0;
  font-size: 12px;
  color: #777;
  line-height: 1.5;
}
</style>
