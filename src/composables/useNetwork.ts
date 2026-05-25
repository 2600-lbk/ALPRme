import { ref, readonly } from 'vue'

const online = ref(navigator.onLine)

function handleOnline() { online.value = true }
function handleOffline() { online.value = false }

if (typeof window !== 'undefined') {
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
}

export function useNetwork() {
  return { online: readonly(online) }
}
