<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { openDb, type SessionRecord } from '@/storage/db'
import { withTimeout } from '@/storage/utils'
import { useDb } from '@/composables/useDb'

const LOAD_TIMEOUT_MS = 10000

const props = defineProps<{
  sessionActive: boolean
  /** Passed from AppShell so we can refresh when the tab becomes visible */
  isVisible: boolean
}>()

const emit = defineEmits<{
  'switch-to-live': []
  'go-to-session': [id: number]
}>()

const sessions = ref<Array<SessionRecord & { detectionCount: number }>>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

async function loadSessions(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    await withTimeout((async () => {
      const db = await openDb()
      const [all, allDetections] = await Promise.all([
        db.sessions.orderBy('startedAt').reverse().toArray(),
        db.detections.toArray(),
      ])
      const countMap = new Map<number, number>()
      for (const d of allDetections) {
        countMap.set(d.sessionId, (countMap.get(d.sessionId) ?? 0) + 1)
      }
      sessions.value = all.map((s) => ({
        ...s,
        detectionCount: countMap.get(s.id!) ?? 0,
      }))
    })(), LOAD_TIMEOUT_MS, 'Loading sessions timed out')
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function retry(): void { loadSessions() }

function onSessionClick(s: SessionRecord): void {
  if (!s.endedAt) {
    emit('switch-to-live')
  } else if (s.id != null) {
    emit('go-to-session', s.id)
  }
}

async function deleteSession(id: number): Promise<void> {
  const db = await openDb()
  const dets = await db.detections.where({ sessionId: id }).toArray()
  for (const det of dets) {
    if (det.id != null) await db.crops.where({ detectionId: det.id }).delete()
  }
  await db.detections.where({ sessionId: id }).delete()
  await db.sessions.delete(id)
  sessions.value = sessions.value.filter((s) => s.id !== id)
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function formatDuration(startedAt: number, endedAt: number | null): string {
  const end = endedAt ?? Date.now()
  const ms = end - startedAt
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return `${hrs}h ${rem}m`
}

onMounted(() => {
  const db = useDb()
  if (db.ready.value) {
    loadSessions()
  } else {
    db.init().then(() => { loadSessions() })
  }
})

// Re-load when this tab becomes visible (v-show keeps the component mounted)
watch(() => props.isVisible, (visible) => {
  if (visible) loadSessions()
})
</script>

<template>
  <div class="sessions-tab">
    <div v-if="loading" class="sessions-empty">Loading&hellip;</div>

    <div v-else-if="loadError" class="sessions-empty">
      Failed to load: {{ loadError }}
      <p><button class="link-btn" @click="retry">Retry</button></p>
    </div>

    <div v-else-if="sessions.length === 0" class="sessions-empty">
      No sessions recorded yet.
    </div>

    <div v-else class="session-list">
      <div
        v-for="s in sessions"
        :key="s.id"
        class="session-card"
        @click="onSessionClick(s)"
      >
        <div class="session-info">
          <span class="session-time">{{ formatTime(s.startedAt) }}</span>
          <span class="session-duration">{{ formatDuration(s.startedAt, s.endedAt) }}</span>
        </div>
        <div class="session-meta">
          <span class="session-count">{{ s.detectionCount }}</span>
          <span v-if="!s.endedAt" class="session-live">ACTIVE</span>
        </div>
        <button
          class="delete-btn"
          @click.stop="deleteSession(s.id!)"
        >&#x2715;</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sessions-tab {
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

.sessions-empty {
  text-align: center;
  color: #555;
  padding-top: 60px;
}

.sessions-empty p { margin-top: 12px; }

.link-btn {
  background: none;
  border: 1px solid #444;
  color: #4a4;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.link-btn:active { color: #fff; border-color: #666; }

.session-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.session-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
}

.session-card:active { background: #222; }

.session-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-time { font-size: 14px; color: #ddd; }
.session-duration { font-size: 11px; color: #555; }

.session-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.session-count { font-size: 12px; color: #777; }
.session-live { font-size: 9px; color: #f44; font-weight: 600; }

.delete-btn {
  background: none;
  border: none;
  color: #444;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  margin-left: 6px;
}

.delete-btn:active { color: #f44; }
</style>
