import { ref, readonly } from 'vue'
import { getDb } from '@/storage/db'
import { openDb } from '@/storage/db'
import { FILTER_PRESETS, DEFAULT_PRESET, type FilterPreset } from '@/pipeline/presets'
import type { PipelineParams } from '@/pipeline'

export interface AppPrefs extends PipelineParams {
  detectorUrl: string
  ocrUrl: string
  ocrConfigUrl: string
  targetFps: number
  filterPreset: FilterPreset
}

export const DEFAULT_PREFS: AppPrefs = {
  detectorUrl: '/models/yolo-v9-t-384.onnx',
  ocrUrl: '/models/cct_xs_v2_global.onnx',
  ocrConfigUrl: '/models/cct_v2_global_plate_config.json',
  targetFps: 4,
  filterPreset: DEFAULT_PRESET,
  ...FILTER_PRESETS[DEFAULT_PRESET],
}

const PREF_STORE_KEY = 'app_prefs'

const prefs = ref<AppPrefs>({ ...DEFAULT_PREFS })
const loaded = ref(false)
let loadPromise: Promise<void> | null = null

export function usePrefs() {
  async function load(): Promise<void> {
    if (loaded.value) return
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
      try {
        await openDb()
        const db = getDb()
        const stored = await db.prefs.get(PREF_STORE_KEY)
        if (stored?.value) {
          prefs.value = { ...DEFAULT_PREFS, ...(stored.value as Partial<AppPrefs>) }
        }
      } catch {
        // DB not available, use in-memory defaults
      } finally {
        loaded.value = true
      }
    })()

    return loadPromise
  }

  async function save(partial: Partial<AppPrefs>): Promise<void> {
    prefs.value = { ...prefs.value, ...partial }
    try {
      const db = getDb()
      if (db.isOpen()) {
        await db.prefs.put({ key: PREF_STORE_KEY, value: { ...prefs.value } })
      }
    } catch {
      // Save failed, prefs still in memory
    }
  }

  /** Apply a named preset, replacing every pipeline param with the preset's values. */
  async function applyPreset(preset: FilterPreset): Promise<void> {
    await save({ filterPreset: preset, ...FILTER_PRESETS[preset] })
  }

  function reset(): void {
    prefs.value = { ...DEFAULT_PREFS }
  }

  /** Project the AppPrefs into a PipelineParams (drops UI-only fields). */
  function asPipelineParams(): PipelineParams {
    const p = prefs.value
    return {
      minDetectorConfidence: p.minDetectorConfidence,
      minOcrConfidence: p.minOcrConfidence,
      minCharConfidence: p.minCharConfidence,
      minBboxAreaPx: p.minBboxAreaPx,
      minPlateLen: p.minPlateLen,
      maxPlateLen: p.maxPlateLen,
      stabilizerWindowMs: p.stabilizerWindowMs,
      consensusK: p.consensusK,
      consensusN: p.consensusN,
      fuzzyDistance: p.fuzzyDistance,
      stationarySpeedThresholdKph: p.stationarySpeedThresholdKph,
      bboxDriftMaxStationaryPx: p.bboxDriftMaxStationaryPx,
      motionWindowMs: p.motionWindowMs,
      timeWindowMs: p.timeWindowMs,
      geoRadiusM: p.geoRadiusM,
      retriggerWindowMs: p.retriggerWindowMs,
      retriggerRadiusM: p.retriggerRadiusM,
      speedAwareRadius: p.speedAwareRadius,
    }
  }

  return {
    prefs: readonly(prefs),
    loaded: readonly(loaded),
    load,
    save,
    applyPreset,
    reset,
    asPipelineParams,
  }
}
