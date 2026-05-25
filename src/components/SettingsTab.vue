<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePrefs, DEFAULT_PREFS } from '@/composables/usePrefs'
import type { FilterPreset } from '@/pipeline/presets'
import {
  STAGE1_MODELS, STAGE2_MODELS, OCR_CONFIG_URLS,
  type ModelEntry,
} from '@/setup/modelCatalog'

const emit = defineEmits<{
  /** Emitted after a model selection has been persisted so AppShell can
   *  dispose + re-init the ALPR worker with the new model URLs. */
  'models-changed': []
}>()

const props = defineProps<{
  /** When true, model selection is disabled (inference is active). */
  disabled?: boolean
}>()

const { prefs, save, applyPreset, load } = usePrefs()

const targetFps = ref(DEFAULT_PREFS.targetFps)
const minDetectorConf = ref(DEFAULT_PREFS.minDetectorConfidence)
const minOcrConf = ref(DEFAULT_PREFS.minOcrConfidence)
const minCharConf = ref(DEFAULT_PREFS.minCharConfidence)
const minBboxArea = ref(DEFAULT_PREFS.minBboxAreaPx)
const consensusK = ref(DEFAULT_PREFS.consensusK)
const consensusN = ref(DEFAULT_PREFS.consensusN)
const stabilizerWindow = ref(DEFAULT_PREFS.stabilizerWindowMs)
const fuzzyDistance = ref(DEFAULT_PREFS.fuzzyDistance)
const timeWindow = ref(DEFAULT_PREFS.timeWindowMs)
const geoRadius = ref(DEFAULT_PREFS.geoRadiusM)
const speedAware = ref(DEFAULT_PREFS.speedAwareRadius)
const filterPreset = ref<FilterPreset>(DEFAULT_PREFS.filterPreset)
const advancedOpen = ref(false)

function syncFromPrefs(): void {
  targetFps.value = prefs.value.targetFps
  minDetectorConf.value = prefs.value.minDetectorConfidence
  minOcrConf.value = prefs.value.minOcrConfidence
  minCharConf.value = prefs.value.minCharConfidence
  minBboxArea.value = prefs.value.minBboxAreaPx
  consensusK.value = prefs.value.consensusK
  consensusN.value = prefs.value.consensusN
  stabilizerWindow.value = prefs.value.stabilizerWindowMs
  fuzzyDistance.value = prefs.value.fuzzyDistance
  timeWindow.value = prefs.value.timeWindowMs
  geoRadius.value = prefs.value.geoRadiusM
  speedAware.value = prefs.value.speedAwareRadius
  filterPreset.value = prefs.value.filterPreset
}

onMounted(async () => {
  await load()
  syncFromPrefs()
})

function saveFps(): void { save({ targetFps: targetFps.value }) }
function saveMinDetectorConf(): void { save({ minDetectorConfidence: minDetectorConf.value }) }
function saveMinOcrConf(): void { save({ minOcrConfidence: minOcrConf.value }) }
function saveMinCharConf(): void { save({ minCharConfidence: minCharConf.value }) }
function saveBboxArea(): void { save({ minBboxAreaPx: minBboxArea.value }) }
function saveConsensusK(): void { save({ consensusK: consensusK.value }) }
function saveConsensusN(): void { save({ consensusN: consensusN.value }) }
function saveStabilizerWindow(): void { save({ stabilizerWindowMs: stabilizerWindow.value }) }
function saveFuzzy(): void { save({ fuzzyDistance: fuzzyDistance.value }) }
function saveTimeWindow(): void { save({ timeWindowMs: timeWindow.value }) }
function saveGeoRadius(): void { save({ geoRadiusM: geoRadius.value }) }
function saveSpeedAware(): void { save({ speedAwareRadius: speedAware.value }) }

async function selectPreset(p: FilterPreset): Promise<void> {
  filterPreset.value = p
  await applyPreset(p)
  syncFromPrefs()
}

const stage1Key = computed(() => STAGE1_MODELS.find(m => m.path === prefs.value.detectorUrl)?.key ?? null)
const stage2Key = computed(() => STAGE2_MODELS.find(m => m.path === prefs.value.ocrUrl)?.key ?? null)

async function selectStage1(model: ModelEntry): Promise<void> {
  if (props.disabled || model.path === prefs.value.detectorUrl) return
  await save({ detectorUrl: model.path })
  emit('models-changed')
}
async function selectStage2(model: ModelEntry): Promise<void> {
  if (props.disabled || model.path === prefs.value.ocrUrl) return
  await save({
    ocrUrl: model.path,
    ocrConfigUrl: OCR_CONFIG_URLS[model.key] ?? prefs.value.ocrConfigUrl,
  })
  emit('models-changed')
}

const presets: { id: FilterPreset; label: string; desc: string }[] = [
  { id: 'conservative', label: 'Conservative', desc: 'few false logs, may miss low-quality reads' },
  { id: 'balanced',     label: 'Balanced',     desc: 'recommended default' },
  { id: 'permissive',   label: 'Permissive',   desc: 'log more; risk of duplicates' },
  { id: 'logAll',       label: 'Log All',      desc: 'no filtering at all (raw study mode)' },
]
</script>

<template>
  <div class="settings-tab">
    <h2>Settings</h2>

    <div v-if="disabled" class="setting-warn">
      Stop inference before changing models.
    </div>

    <div class="setting-group">
      <div class="setting-label">Detector</div>
      <div class="model-list">
        <div
          v-for="m in STAGE1_MODELS"
          :key="m.key"
          class="model-card"
          :class="{ selected: stage1Key === m.key }"
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
    </div>

    <div class="setting-group">
      <div class="setting-label">OCR</div>
      <div class="model-list">
        <div
          v-for="m in STAGE2_MODELS"
          :key="m.key"
          class="model-card"
          :class="{ selected: stage2Key === m.key }"
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
    </div>

    <div class="setting-group">
      <div class="setting-label">Inference</div>
      <div class="setting-row">
        <span>Target FPS</span>
        <input
          type="range"
          min="1" max="15" step="1"
          v-model.number="targetFps"
          @change="saveFps"
        />
        <span class="setting-val">{{ targetFps }}</span>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label">Filtering Preset</div>
      <div class="preset-row">
        <button
          v-for="p in presets"
          :key="p.id"
          class="preset-btn"
          :class="{ active: filterPreset === p.id }"
          @click="selectPreset(p.id)"
          :title="p.desc"
        >{{ p.label }}</button>
      </div>
      <div class="preset-desc">{{ presets.find(p => p.id === filterPreset)?.desc }}</div>

      <div class="setting-row toggle" @click="advancedOpen = !advancedOpen">
        <span>Advanced thresholds</span>
        <span class="setting-toggle" :class="{ on: advancedOpen }">{{ advancedOpen ? 'HIDE' : 'SHOW' }}</span>
      </div>
    </div>

    <div v-if="advancedOpen" class="setting-group">
      <div class="setting-label">Confidence Thresholds</div>
      <div class="setting-row">
        <span>Detector min</span>
        <input type="range" min="0" max="100" step="5"
          :value="Math.round(minDetectorConf * 100)"
          @input="minDetectorConf = Number(($event.target as HTMLInputElement).value) / 100; saveMinDetectorConf()" />
        <span class="setting-val">{{ Math.round(minDetectorConf * 100) }}%</span>
      </div>
      <div class="setting-row">
        <span>OCR min</span>
        <input type="range" min="0" max="100" step="5"
          :value="Math.round(minOcrConf * 100)"
          @input="minOcrConf = Number(($event.target as HTMLInputElement).value) / 100; saveMinOcrConf()" />
        <span class="setting-val">{{ Math.round(minOcrConf * 100) }}%</span>
      </div>
      <div class="setting-row">
        <span>Weakest-char min</span>
        <input type="range" min="0" max="100" step="5"
          :value="Math.round(minCharConf * 100)"
          @input="minCharConf = Number(($event.target as HTMLInputElement).value) / 100; saveMinCharConf()" />
        <span class="setting-val">{{ Math.round(minCharConf * 100) }}%</span>
      </div>
      <div class="setting-row">
        <span>Min bbox area (px²)</span>
        <input type="range" min="0" max="5000" step="100"
          v-model.number="minBboxArea" @change="saveBboxArea" />
        <span class="setting-val">{{ minBboxArea }}</span>
      </div>
    </div>

    <div v-if="advancedOpen" class="setting-group">
      <div class="setting-label">Stabilizer (K-of-N)</div>
      <div class="setting-row">
        <span>K (frames to confirm)</span>
        <input type="range" min="1" max="10" step="1"
          v-model.number="consensusK" @change="saveConsensusK" />
        <span class="setting-val">{{ consensusK }}</span>
      </div>
      <div class="setting-row">
        <span>N (window frames)</span>
        <input type="range" min="1" max="10" step="1"
          v-model.number="consensusN" @change="saveConsensusN" />
        <span class="setting-val">{{ consensusN }}</span>
      </div>
      <div class="setting-row">
        <span>Window (ms)</span>
        <input type="range" min="200" max="5000" step="100"
          v-model.number="stabilizerWindow" @change="saveStabilizerWindow" />
        <span class="setting-val">{{ stabilizerWindow }}</span>
      </div>
      <div class="setting-row">
        <span>Fuzzy plate distance</span>
        <input type="range" min="0" max="3" step="1"
          v-model.number="fuzzyDistance" @change="saveFuzzy" />
        <span class="setting-val">{{ fuzzyDistance }}</span>
      </div>
    </div>

    <div v-if="advancedOpen" class="setting-group">
      <div class="setting-label">Dedup</div>
      <div class="setting-row">
        <span>Time window (s)</span>
        <input type="range" min="0" max="300" step="5"
          :value="Math.round(timeWindow / 1000)"
          @input="timeWindow = Number(($event.target as HTMLInputElement).value) * 1000; saveTimeWindow()" />
        <span class="setting-val">{{ Math.round(timeWindow / 1000) }}s</span>
      </div>
      <div class="setting-row">
        <span>Geo radius (m)</span>
        <input type="range" min="0" max="500" step="10"
          v-model.number="geoRadius" @change="saveGeoRadius" />
        <span class="setting-val">{{ geoRadius }}m</span>
      </div>
      <div class="setting-row toggle" @click="speedAware = !speedAware; saveSpeedAware()">
        <span>Speed-aware radius</span>
        <span class="setting-toggle" :class="{ on: speedAware }">{{ speedAware ? 'ON' : 'OFF' }}</span>
      </div>
    </div>

  </div>
</template>

<style scoped>
.settings-tab {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow-y: auto;
  background: #111;
  padding: 16px;
  padding-top: max(16px, env(safe-area-inset-top, 0px));
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  box-sizing: border-box;
}

.setting-warn {
  color: #faa;
  font-size: 12px;
  padding: 0 0 12px;
  opacity: 0.8;
}

.settings-tab h2 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #fff;
  font-weight: 600;
}

.setting-group {
  margin-bottom: 20px;
}

.setting-label {
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #1a1a1a;
  font-size: 13px;
  color: #ccc;
  cursor: default;
  gap: 8px;
}

.setting-row.toggle {
  cursor: pointer;
}

.setting-row input[type="range"] {
  flex: 1;
  max-width: 120px;
  accent-color: #24ff0c;
  height: 4px;
}

.setting-val {
  color: #666;
  font-size: 12px;
  min-width: 50px;
  text-align: right;
}

.setting-toggle {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 3px;
  background: #222;
  color: #555;
}

.setting-toggle.on {
  background: #24ff0c22;
  color: #24ff0c;
}

.preset-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 8px;
}

.preset-btn {
  background: #1a1a1a;
  border: 1px solid #333;
  color: #999;
  padding: 8px 10px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 12px;
  cursor: pointer;
}

.preset-btn.active {
  background: rgba(36,255,12,0.1);
  border-color: rgba(36,255,12,0.45);
  color: #24ff0c;
}

.preset-btn:active { opacity: 0.7; }

.preset-desc {
  font-size: 11px;
  color: #666;
  padding: 4px 2px 8px;
}

/* Model picker cards (mirrors the Setup wizard step 2). */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  background: rgba(36,255,12,0.06);
}

.model-card:active { background: #222; }

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
</style>
