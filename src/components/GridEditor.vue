<script setup lang="ts">
import { computed } from 'vue'
import type { TileGrid } from '@/capture/profile'

/**
 * Tap-to-toggle cell editor overlaid on the live preview. Renders the
 * profile's grid as N×M rectangles using the host's display transform; tapping
 * any cell flips its enabled state.
 *
 * No drag-create or resize — grid dimensions and shape are configured in the
 * Profile Editor view; this component only flips per-cell enabled bits.
 */
const props = defineProps<{
  grid: TileGrid
  viewW: number
  viewH: number
  /** sourcePx → screenPx multiplier (matches CaptureTab math). */
  combinedScale: number
  offsetX: number
  offsetY: number
  sourceW: number
  sourceH: number
}>()

const emit = defineEmits<{
  update: [grid: TileGrid]
}>()

interface CellRect {
  index: number
  row: number
  col: number
  enabled: boolean
  style: Record<string, string>
}

const cells = computed<CellRect[]>(() => {
  const out: CellRect[] = []
  const cellSrcW = props.sourceW / props.grid.cols
  const cellSrcH = props.sourceH / props.grid.rows
  for (let r = 0; r < props.grid.rows; r++) {
    for (let c = 0; c < props.grid.cols; c++) {
      const idx = r * props.grid.cols + c
      const sx = c * cellSrcW * props.combinedScale + props.offsetX
      const sy = r * cellSrcH * props.combinedScale + props.offsetY
      const sw = cellSrcW * props.combinedScale
      const sh = cellSrcH * props.combinedScale
      out.push({
        index: idx,
        row: r,
        col: c,
        enabled: props.grid.enabled[idx] ?? false,
        style: {
          left: `${sx}px`,
          top: `${sy}px`,
          width: `${sw}px`,
          height: `${sh}px`,
        },
      })
    }
  }
  return out
})

function toggleCell(index: number): void {
  const enabled = [...props.grid.enabled]
  enabled[index] = !enabled[index]
  emit('update', { ...props.grid, enabled })
}

function enableAll(): void {
  emit('update', { ...props.grid, enabled: props.grid.enabled.map(() => true) })
}

function disableAll(): void {
  emit('update', { ...props.grid, enabled: props.grid.enabled.map(() => false) })
}

const totalCells = computed(() => props.grid.cols * props.grid.rows)
const enabledCount = computed(() => props.grid.enabled.filter(Boolean).length)
</script>

<template>
  <div class="ge-root" :style="{ width: `${viewW}px`, height: `${viewH}px` }">
    <div
      v-for="cell in cells"
      :key="cell.index"
      class="ge-cell"
      :class="{ enabled: cell.enabled, disabled: !cell.enabled }"
      :style="cell.style"
      @pointerdown.stop="toggleCell(cell.index)"
    >
      <span class="ge-tag">{{ cell.row + 1 }},{{ cell.col + 1 }}</span>
    </div>

    <div class="ge-chip">
      <span class="ge-chip-name">{{ grid.cols }}×{{ grid.rows }} · {{ enabledCount }}/{{ totalCells }} on</span>
      <button class="ge-chip-btn" @click="enableAll">Enable all</button>
      <button class="ge-chip-btn" @click="disableAll">Disable all</button>
    </div>
  </div>
</template>

<style scoped>
.ge-root {
  position: absolute;
  inset: 0;
  z-index: 4;
  touch-action: none;
  pointer-events: none;
}

.ge-cell {
  position: absolute;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: pointer;
}

.ge-cell.enabled {
  border: 2px dashed #24ff0c;
  background: rgba(36,255,12,0.06);
}

.ge-cell.disabled {
  border: 2px solid #ff4040;
  background: repeating-linear-gradient(
    45deg,
    rgba(255,64,64,0.10) 0,
    rgba(255,64,64,0.10) 6px,
    transparent 6px,
    transparent 12px
  );
}

.ge-tag {
  position: absolute;
  top: 4px;
  left: 6px;
  font-family: monospace;
  font-size: 10px;
  color: #fff;
  background: rgba(0,0,0,0.7);
  padding: 1px 5px;
  border-radius: 2px;
  pointer-events: none;
}

.ge-chip {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  align-items: center;
  background: rgba(0,0,0,0.88);
  border: 1px solid #444;
  border-radius: 6px;
  padding: 6px 8px;
  font-family: monospace;
  font-size: 11px;
  color: #ccc;
  pointer-events: auto;
}

.ge-chip-name { font-weight: 700; color: #fff; }

.ge-chip-btn {
  background: #1a1a1a;
  border: 1px solid #444;
  color: #ccc;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
}
.ge-chip-btn:active { background: #2a2a2a; }
</style>
