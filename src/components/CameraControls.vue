<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureProfile } from '@/capture/profile'
import type { CameraCapabilities } from '@/capture/capabilities'

/**
 * Slide-out drawer for live camera controls. Renders only the controls the
 * current device's track.getCapabilities() advertises — so iOS Safari sees
 * zoom + torch, Android Chrome usually sees the full set.
 */
const props = defineProps<{
  open: boolean
  capabilities: CameraCapabilities
  profile: CaptureProfile
  cameraSettings: { width: number; height: number } | null
  /** When true, render the controls list inline (no backdrop, no close button). */
  inline?: boolean
}>()

const emit = defineEmits<{
  close: []
  /** Patch the in-memory profile and re-apply to the camera. */
  update: [partial: Partial<CaptureProfile>]
}>()

function set<K extends keyof CaptureProfile>(key: K, value: CaptureProfile[K]): void {
  emit('update', { [key]: value } as Partial<CaptureProfile>)
}

const hasAnyControl = computed(() =>
  props.capabilities.zoom != null
  || props.capabilities.torch
  || props.capabilities.focusModes.length > 0
  || props.capabilities.exposureModes.length > 0
  || props.capabilities.exposureCompensation != null
  || props.capabilities.whiteBalanceModes.length > 0,
)

function fmtNum(n: number | null | undefined, digits = 1): string {
  return n == null ? '—' : n.toFixed(digits)
}
</script>

<template>
  <!--
    Teleport the drawer to <body> so it escapes `.capture-tab`'s
    `pointer-events: none` inheritance. (When `inline`, render in place — the
    profile editor embeds this directly in its side panel.)
  -->
  <Teleport to="body" :disabled="inline">
  <div v-if="open" :class="['cc-backdrop', { inline }]" @click="inline ? null : emit('close')">
    <div class="cc-drawer" @click.stop>
      <div v-if="!inline" class="cc-head">
        <span class="cc-title">Camera Controls</span>
        <button class="cc-close" @click="emit('close')">✕</button>
      </div>

      <div class="cc-stats">
        <span v-if="cameraSettings">
          {{ cameraSettings.width }}×{{ cameraSettings.height }}
        </span>
        <span v-else>no stream</span>
      </div>

      <p v-if="!hasAnyControl" class="cc-empty">
        This camera/browser doesn't expose any tunable controls.
      </p>

      <!-- Zoom -->
      <div v-if="capabilities.zoom" class="cc-row">
        <label>Zoom</label>
        <input
          type="range"
          :min="capabilities.zoom.min"
          :max="capabilities.zoom.max"
          :step="capabilities.zoom.step"
          :value="profile.zoom ?? capabilities.zoom.min"
          @input="set('zoom', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="cc-val">{{ fmtNum(profile.zoom ?? capabilities.zoom.min, 1) }}×</span>
      </div>

      <!-- Torch -->
      <div v-if="capabilities.torch" class="cc-row toggle" @click="set('torch', !profile.torch)">
        <label>Torch</label>
        <span class="cc-toggle" :class="{ on: profile.torch }">{{ profile.torch ? 'ON' : 'OFF' }}</span>
      </div>

      <!-- Focus mode -->
      <div v-if="capabilities.focusModes.length > 0" class="cc-row">
        <label>Focus</label>
        <select
          :value="profile.focusMode ?? ''"
          @change="set('focusMode', (($event.target as HTMLSelectElement).value || null) as CaptureProfile['focusMode'])"
        >
          <option value="">(auto)</option>
          <option v-for="m in capabilities.focusModes" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>

      <!-- Focus distance -->
      <div v-if="capabilities.focusDistance && profile.focusMode === 'manual'" class="cc-row">
        <label>Distance</label>
        <input
          type="range"
          :min="capabilities.focusDistance.min"
          :max="capabilities.focusDistance.max"
          :step="capabilities.focusDistance.step"
          :value="profile.focusDistance ?? capabilities.focusDistance.min"
          @input="set('focusDistance', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="cc-val">{{ fmtNum(profile.focusDistance, 2) }}</span>
      </div>

      <!-- Exposure mode -->
      <div v-if="capabilities.exposureModes.length > 0" class="cc-row">
        <label>Exposure</label>
        <select
          :value="profile.exposureMode ?? ''"
          @change="set('exposureMode', (($event.target as HTMLSelectElement).value || null) as CaptureProfile['exposureMode'])"
        >
          <option value="">(auto)</option>
          <option v-for="m in capabilities.exposureModes" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>

      <!-- Exposure compensation -->
      <div v-if="capabilities.exposureCompensation" class="cc-row">
        <label>EV</label>
        <input
          type="range"
          :min="capabilities.exposureCompensation.min"
          :max="capabilities.exposureCompensation.max"
          :step="capabilities.exposureCompensation.step"
          :value="profile.exposureCompensation ?? 0"
          @input="set('exposureCompensation', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="cc-val">{{ fmtNum(profile.exposureCompensation, 1) }}</span>
      </div>

      <!-- White balance -->
      <div v-if="capabilities.whiteBalanceModes.length > 0" class="cc-row">
        <label>WB</label>
        <select
          :value="profile.whiteBalanceMode ?? ''"
          @change="set('whiteBalanceMode', (($event.target as HTMLSelectElement).value || null) as CaptureProfile['whiteBalanceMode'])"
        >
          <option value="">(auto)</option>
          <option v-for="m in capabilities.whiteBalanceModes" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.cc-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 20;
  display: flex;
  justify-content: flex-end;
}

.cc-backdrop.inline {
  position: static;
  background: none;
  z-index: auto;
}

.cc-drawer {
  width: min(360px, 100%);
  background: #1a1a1a;
  color: #ccc;
  font-family: monospace;
  border-left: 1px solid #333;
  padding: 14px;
  padding-top: max(14px, env(safe-area-inset-top, 0px));
  padding-bottom: max(14px, env(safe-area-inset-bottom, 0px));
  padding-right: max(14px, env(safe-area-inset-right, 0px));
  overflow-y: auto;
  box-sizing: border-box;
}

.cc-backdrop.inline .cc-drawer {
  width: 100%;
  border-left: none;
  padding-top: 14px;
}

.cc-head { display: flex; align-items: center; margin-bottom: 8px; }
.cc-title { font-weight: 700; color: #fff; font-size: 14px; flex: 1; }
.cc-close { background: none; border: none; color: #888; font-size: 14px; cursor: pointer; }
.cc-close:hover { color: #fff; }

.cc-stats { font-size: 11px; color: #666; margin-bottom: 14px; }
.cc-empty { color: #777; font-size: 12px; padding: 24px 0; text-align: center; }

.cc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #222;
  font-size: 12px;
}
.cc-row label { width: 70px; color: #aaa; }
.cc-row input[type="range"] { flex: 1; accent-color: #24ff0c; }
.cc-row select {
  flex: 1;
  background: #222;
  color: #ddd;
  border: 1px solid #333;
  padding: 4px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
}
.cc-val { min-width: 48px; text-align: right; color: #888; font-size: 11px; }

.cc-row.toggle { cursor: pointer; justify-content: space-between; }
.cc-toggle {
  font-size: 10px;
  padding: 2px 10px;
  border-radius: 3px;
  background: #222;
  color: #555;
}
.cc-toggle.on { background: #24ff0c22; color: #24ff0c; }
</style>
