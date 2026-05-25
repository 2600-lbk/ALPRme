import { ref, readonly } from 'vue'
import { openDb } from '@/storage/db'

const dbReady = ref(false)
const dbLoading = ref(false)
const dbError = ref<string | null>(null)
let initPromise: Promise<void> | null = null

export function useDb() {
  async function init(): Promise<void> {
    if (dbReady.value) return
    if (initPromise) return initPromise

    dbLoading.value = true
    dbError.value = null

    initPromise = (async () => {
      try {
        await openDb()
        dbReady.value = true
      } catch (e) {
        dbError.value = e instanceof Error ? e.message : String(e)
        initPromise = null
      } finally {
        dbLoading.value = false
      }
    })()

    return initPromise
  }

  async function retry(): Promise<void> {
    initPromise = null
    dbError.value = null
    await init()
  }

  return {
    ready: readonly(dbReady),
    loading: readonly(dbLoading),
    error: readonly(dbError),
    init,
    retry,
  }
}
