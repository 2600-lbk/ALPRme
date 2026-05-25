<script setup lang="ts">
import { ref } from 'vue'
import type { CaptureProfileRecord } from '@/storage/db'
import { enabledCellCount } from '@/capture/profile'

defineProps<{
  profiles: readonly CaptureProfileRecord[]
  activeId: number | null
}>()

const emit = defineEmits<{
  select: [id: number]
  /** Open the profile editor on the active profile. */
  edit: []
  /** Open the profile editor for a brand-new profile. */
  new: []
}>()

const open = ref(false)

function toggle(): void {
  open.value = !open.value
}

function pick(id: number): void {
  emit('select', id)
  open.value = false
}

function edit(): void {
  emit('edit')
  open.value = false
}

function newProfile(): void {
  emit('new')
  open.value = false
}

function activeName(profiles: readonly CaptureProfileRecord[], activeId: number | null): string {
  return profiles.find(p => p.id === activeId)?.name ?? 'No profile'
}

function summary(p: CaptureProfileRecord): string {
  if (p.captureMode === 'whole-frame') return 'whole-frame'
  const total = p.grid.cols * p.grid.rows
  const on = enabledCellCount(p.grid)
  return on === total
    ? `${p.grid.cols}×${p.grid.rows}`
    : `${p.grid.cols}×${p.grid.rows} · ${on}/${total} on`
}
</script>

<template>
  <div class="cpm-root">
    <button class="cpm-pill" @click="toggle">
      <span class="cpm-label">PROFILE</span>
      <span class="cpm-name">{{ activeName(profiles, activeId) }}</span>
      <span class="cpm-caret">▾</span>
    </button>

    <div v-if="open" class="cpm-menu" @click.self="open = false">
      <div class="cpm-list">
        <button
          v-for="p in profiles"
          :key="p.id"
          class="cpm-item"
          :class="{ active: p.id === activeId }"
          @click="pick(p.id!)"
        >
          <span class="cpm-item-name">{{ p.name }}</span>
          <span class="cpm-item-meta">{{ summary(p) }}</span>
        </button>
      </div>
      <div class="cpm-actions">
        <button class="cpm-action" @click="newProfile">+ New profile</button>
        <button class="cpm-action" @click="edit">Edit current profile</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cpm-root {
  position: relative;
}

.cpm-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0,0,0,0.7);
  border: 1px solid #333;
  border-radius: 14px;
  padding: 4px 10px;
  color: #ccc;
  font-family: monospace;
  font-size: 11px;
  cursor: pointer;
}
.cpm-pill:active { background: rgba(255,255,255,0.08); }
.cpm-label { color: #666; letter-spacing: 1px; }
.cpm-name { color: #24ff0c; font-weight: 700; }
.cpm-caret { color: #888; }

.cpm-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 220px;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 6px;
  z-index: 50;
  font-family: monospace;
  font-size: 12px;
  color: #ccc;
}

.cpm-list { display: flex; flex-direction: column; gap: 2px; }

.cpm-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: 1px solid transparent;
  color: inherit;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: inherit;
}
.cpm-item:hover { background: #222; }
.cpm-item.active { background: rgba(36,255,12,0.10); border-color: rgba(36,255,12,0.45); color: #24ff0c; }
.cpm-item-name { font-weight: 600; }
.cpm-item-meta { font-size: 10px; color: #666; }

.cpm-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  border-top: 1px solid #2a2a2a;
  padding-top: 6px;
}

.cpm-action {
  width: 100%;
  background: #222;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  text-align: left;
}
.cpm-action:active { background: #2a2a2a; }
</style>
