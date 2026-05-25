import { ref, type Ref } from 'vue'
import { usePrefs } from './usePrefs'

export interface UseAlprReturn {
  ready: Ref<boolean>
  backend: Ref<string>
  error: Ref<string | null>
  reinitializing: Ref<boolean>
  /** Detector input dimensions (w, h) in pixels. Null until init completes. */
  detectorInputSize: Ref<{ w: number; h: number } | null>
  init: () => Promise<void>
  dispose: () => Promise<void>
}

let singleton: import('@/packages/alpr/client').AlprClient | null = null
const sharedDetectorSize = ref<{ w: number; h: number } | null>(null)

export function useAlpr(): UseAlprReturn {
  const ready = ref(false)
  const backend = ref('')
  const error = ref<string | null>(null)
  const reinitializing = ref(false)

  async function init(): Promise<void> {
    if (singleton) {
      ready.value = true
      return
    }

    reinitializing.value = true
    error.value = null
    const { AlprClient } = await import('@/packages/alpr/client')
    const { prefs, load: loadPrefs } = usePrefs()
    await loadPrefs()

    try {
      const client = new AlprClient()
      const preferredBackends: Array<'webgpu' | 'webgl' | 'wasm'> = (() => {
        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
          return ['webgpu', 'wasm']
        }
        return ['wasm']
      })()
      const info = await client.init({
        detectorUrl: prefs.value.detectorUrl,
        ocrUrl: prefs.value.ocrUrl,
        ocrConfigUrl: prefs.value.ocrConfigUrl,
        backendPreference: preferredBackends,
      })

      singleton = client
      backend.value = info.backend
      // detectorInputShape = [batch, channels, height, width]
      const shape = info.detectorInputShape
      sharedDetectorSize.value = { w: shape[3], h: shape[2] }
      ready.value = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      reinitializing.value = false
    }
  }

  async function dispose(): Promise<void> {
    reinitializing.value = true
    try {
      if (singleton) {
        await singleton.dispose()
        singleton = null
      }
      sharedDetectorSize.value = null
      ready.value = false
    } finally {
      reinitializing.value = false
    }
  }

  return { ready, backend, error, reinitializing, detectorInputSize: sharedDetectorSize, init, dispose }
}

export function getAlprClient(): import('@/packages/alpr/client').AlprClient | null {
  return singleton
}
