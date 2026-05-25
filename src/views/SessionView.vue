<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { openDb, type DetectionRecord, type SessionRecord } from '@/storage/db'
import { detectionsToGeoJson, detectionsToCsv } from '@/storage/export'
import { withTimeout } from '@/storage/utils'
import { useDb } from '@/composables/useDb'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const LOAD_TIMEOUT_MS = 10000

const route = useRoute()
const router = useRouter()
const session = ref<SessionRecord | null>(null)
const detections = ref<DetectionRecord[]>([])
const selectedIds = ref<Set<number>>(new Set())
const loading = ref(true)
const loadError = ref<string | null>(null)
const mapContainer = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
const showPolyline = ref(false)
const showSuppressed = ref(false)
const traceFor = ref<DetectionRecord | null>(null)

const isDiagnostic = computed(() => session.value?.mode === 'diagnostic')
const visibleDetections = computed(() => {
  if (showSuppressed.value) return detections.value
  return detections.value.filter(d => !d.suppressed)
})

async function loadSessionData(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    await withTimeout((async () => {
      const db = await openDb()
      const id = Number(route.params.id)
      const s = await db.sessions.get(id)
      if (!s) {
        router.replace('/capture')
        return
      }

      session.value = s
      detections.value = await db.detections.where({ sessionId: id }).sortBy('timestamp')
      loading.value = false

      await nextTick()
      if (mapContainer.value) initMap()
    })(), LOAD_TIMEOUT_MS, 'Loading session data timed out')
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

function retry(): void {
  loadSessionData()
}

onMounted(() => {
  const db = useDb()
  if (db.ready.value) {
    loadSessionData()
  } else {
    db.init().then(() => {
      loadSessionData()
    })
  }
})

function initMap(): void {
  if (!mapContainer.value) return
  map = L.map(mapContainer.value, { zoomControl: true }).setView([0, 0], 2)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OSM',
    maxZoom: 18,
  }).addTo(map)

  markerLayer = L.layerGroup().addTo(map)
  updateMarkers()
  fitBounds()
}

function updateMarkers(): void {
  if (!markerLayer) return
  markerLayer.clearLayers()

  const withCoords = visibleDetections.value.filter((d) => d.latitude != null && d.longitude != null)

  if (showPolyline.value && withCoords.length >= 2) {
    const polyline = L.polyline(
      withCoords.map((d) => [d.latitude!, d.longitude!] as [number, number]),
      { color: '#24ff0c', weight: 2, opacity: 0.6 },
    )
    markerLayer.addLayer(polyline)
  }

  for (const det of withCoords) {
    const marker = L.circleMarker([det.latitude!, det.longitude!], {
      radius: selectedIds.value.has(det.id!) ? 7 : 5,
      fillColor: selectedIds.value.has(det.id!) ? '#ff6600' : '#24ff0c',
      color: '#000',
      weight: 1,
      fillOpacity: 0.9,
    })

    marker.bindPopup(`<b>${det.plate}</b><br/>${new Date(det.timestamp).toLocaleTimeString()}`)

    marker.on('click', () => {
      toggleSelect(det.id!)
      scrollToRow(det.id!)
    })

    markerLayer!.addLayer(marker)
  }
}

function fitBounds(): void {
  if (!map) return
  const withCoords = detections.value.filter((d) => d.latitude != null && d.longitude != null)
  if (withCoords.length === 0) return
  const bounds = L.latLngBounds(withCoords.map((d) => [d.latitude!, d.longitude!] as [number, number]))
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] })
}

function toggleSelect(id: number): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
  updateMarkers()
}

function scrollToRow(id: number): void {
  const el = document.getElementById(`det-${id}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function onRowClick(det: DetectionRecord): void {
  toggleSelect(det.id!)
}

async function deleteSelected(): Promise<void> {
  if (selectedIds.value.size === 0) return
  const db = await openDb()
  for (const id of selectedIds.value) {
    await db.crops.where({ detectionId: id }).delete()
    await db.detections.delete(id)
  }
  detections.value = detections.value.filter((d) => !selectedIds.value.has(d.id!))
  selectedIds.value = new Set()
  updateMarkers()
}

function exportGeoJson(): void {
  if (!session.value) return
  const fc = detectionsToGeoJson(session.value, detections.value)
  download(`session-${session.value.id}-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json')
}

function exportCsv(): void {
  const csv = detectionsToCsv(detections.value)
  download(`session-${session.value?.id}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv')
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

watch(showPolyline, () => updateMarkers())
watch(showSuppressed, () => updateMarkers())

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function openTrace(det: DetectionRecord, ev: MouseEvent): void {
  ev.stopPropagation()
  traceFor.value = det
}

function closeTrace(): void {
  traceFor.value = null
}
</script>

<template>
  <div class="session-view">
    <div class="session-header">
      <button class="back-btn" @click="router.back()">&#x2190; Back</button>
      <div v-if="session" class="session-title">
        <span class="session-date">{{ new Date(session.startedAt).toLocaleString() }}</span>
        <span class="session-stats">{{ detections.length }} detection{{ detections.length !== 1 ? 's' : '' }}</span>
      </div>
      <div class="export-actions">
        <button class="export-btn" @click="exportGeoJson">GeoJSON</button>
        <button class="export-btn" @click="exportCsv">CSV</button>
        <button
          v-if="selectedIds.size > 0"
          class="export-btn danger"
          @click="deleteSelected"
        >
          Delete ({{ selectedIds.size }})
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-text">
      Loading&hellip;
      <p>
        <button class="back-btn" @click="router.back()">Go Back</button>
      </p>
    </div>

    <div v-else-if="loadError" class="empty-text">
      Failed to load: {{ loadError }}
      <p>
        <button class="export-btn" @click="retry">Retry</button>
      </p>
      <p>
        <button class="back-btn" @click="router.back()">Go Back</button>
      </p>
    </div>

    <template v-else>
      <div class="map-controls">
        <label class="polyline-toggle">
          <input type="checkbox" v-model="showPolyline" />
          Show path
        </label>
        <label v-if="isDiagnostic" class="polyline-toggle">
          <input type="checkbox" v-model="showSuppressed" />
          Show suppressed
        </label>
        <span v-if="isDiagnostic" class="diag-tag">DIAGNOSTIC SESSION</span>
      </div>

      <div ref="mapContainer" class="map-container" />

      <div v-if="detections.length === 0" class="empty-text">
        No detections in this session.
      </div>

      <div v-else class="detection-table-wrap">
        <table class="detection-table">
          <thead>
            <tr>
              <th>Plate</th>
              <th>Conf</th>
              <th>Det</th>
              <th>Time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="det in visibleDetections"
              :key="det.id"
              :id="`det-${det.id}`"
              :class="{ selected: selectedIds.has(det.id!), suppressed: det.suppressed }"
              @click="onRowClick(det)"
            >
              <td class="col-plate">
                <span v-if="det.suppressed" class="strike" :title="'Suppressed by pipeline'">{{ det.plate }}</span>
                <span v-else>{{ det.plate }}</span>
              </td>
              <td class="col-conf">{{ (det.confidence * 100).toFixed(0) }}%</td>
              <td class="col-det">{{ (det.detectorConfidence * 100).toFixed(0) }}%</td>
              <td class="col-time">{{ formatTime(det.timestamp) }}</td>
              <td class="col-trace">
                <button
                  v-if="det.decisionTrace && det.decisionTrace.length > 0"
                  class="trace-btn"
                  @click="openTrace(det, $event)"
                  title="Show decision trace"
                >ⓘ</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Decision trace popover -->
    <div v-if="traceFor" class="trace-overlay" @click="closeTrace">
      <div class="trace-box" @click.stop>
        <div class="trace-head">
          <strong>{{ traceFor.plate }}</strong>
          <span class="trace-time">{{ formatTime(traceFor.timestamp) }}</span>
          <button class="trace-close" @click="closeTrace">✕</button>
        </div>
        <div class="trace-meta">
          OCR {{ (traceFor.confidence * 100).toFixed(0) }}%
          · Det {{ (traceFor.detectorConfidence * 100).toFixed(0) }}%
          <span v-if="traceFor.suppressed" class="trace-suppressed">SUPPRESSED</span>
        </div>
        <div v-if="traceFor.decisionTrace && traceFor.decisionTrace.length" class="trace-list">
          <div
            v-for="(entry, i) in traceFor.decisionTrace"
            :key="i"
            class="trace-entry"
            :class="entry.verdict"
          >
            <span class="trace-stage">{{ entry.stage }}</span>
            <span class="trace-verdict">{{ entry.verdict }}</span>
            <span class="trace-reason">{{ entry.reason }}</span>
            <span v-if="entry.value != null" class="trace-num">
              {{ entry.value.toFixed(2) }}{{ entry.threshold != null ? ` / ${entry.threshold.toFixed(2)}` : '' }}
            </span>
          </div>
        </div>
        <div v-else class="trace-empty">No trace recorded (pre-pipeline detection).</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-view {
  min-height: 100vh;
  min-height: 100dvh;
  background: #111;
  color: #ccc;
  font-family: system-ui, monospace;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.session-header {
  padding: 12px 16px;
  padding-top: max(12px, env(safe-area-inset-top, 0px));
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.session-title {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-date {
  font-size: 14px;
  color: #ddd;
}

.session-stats {
  font-size: 12px;
  color: #666;
}

.export-actions {
  display: flex;
  gap: 6px;
}

.export-btn {
  background: #222;
  border: 1px solid #444;
  color: #aaa;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}

.export-btn:active { color: #fff; }
.export-btn.danger { color: #f66; border-color: #633; }
.export-btn.danger:active { background: #300; }

.back-btn {
  background: none;
  border: 1px solid #444;
  color: #888;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.back-btn:active { color: #fff; border-color: #666; }

.map-controls {
  padding: 8px 16px;
  background: #1a1a1a;
  border-bottom: 1px solid #222;
  display: flex;
  gap: 16px;
}

.polyline-toggle {
  font-size: 12px;
  color: #888;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.polyline-toggle input {
  accent-color: #24ff0c;
}

.map-container {
  height: min(220px, 30vh);
  background: #222;
  border-bottom: 1px solid #333;
}

.loading-text, .empty-text {
  text-align: center;
  color: #666;
  padding: 40px 16px;
}

.loading-text p, .empty-text p {
  margin-top: 12px;
}

.detection-table-wrap {
  flex: 1;
  overflow-y: auto;
}

.detection-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.detection-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}

.detection-table th {
  background: #1a1a1a;
  color: #666;
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #333;
}

.detection-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #1a1a1a;
  cursor: pointer;
}

.detection-table tr:active { background: #222; }
.detection-table tr.selected { background: rgba(255, 102, 0, 0.12); }

.col-plate { color: #ddd; font-weight: 600; }
.col-conf { color: #4a4; }
.col-det { color: #888; }
.col-time { color: #666; font-size: 12px; }
.col-trace { width: 26px; text-align: right; padding-right: 8px; }

.detection-table tr.suppressed { opacity: 0.55; }
.strike { text-decoration: line-through; color: #888; }

.trace-btn {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 13px;
  padding: 0 4px;
}
.trace-btn:hover { color: #24ff0c; }

.diag-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #ffaa55;
  border: 1px solid rgba(255,170,80,0.6);
  background: rgba(255,170,80,0.15);
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: auto;
  align-self: center;
}

.trace-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  /* Above Leaflet's top pane (z-index 700). */
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.trace-box {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 8px;
  max-width: 500px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
}

.trace-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid #333;
}

.trace-head strong { color: #fff; font-size: 14px; letter-spacing: 1px; }
.trace-time { color: #888; font-size: 11px; }

.trace-close {
  margin-left: auto;
  background: none;
  border: none;
  color: #888;
  font-size: 14px;
  cursor: pointer;
}
.trace-close:hover { color: #fff; }

.trace-meta {
  padding: 8px 14px;
  color: #aaa;
  border-bottom: 1px solid #2a2a2a;
}

.trace-suppressed {
  margin-left: 8px;
  color: #ff6655;
  font-weight: 700;
  letter-spacing: 1px;
}

.trace-list {
  padding: 8px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trace-entry {
  display: grid;
  grid-template-columns: 70px 70px 1fr auto;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.trace-entry.pass     { background: rgba(36,255,12,0.06); color: #aaa; }
.trace-entry.emit     { background: rgba(36,255,12,0.12); color: #cfc; }
.trace-entry.hold     { background: rgba(255,170,80,0.08); color: #ddc; }
.trace-entry.suppress { background: rgba(255,80,80,0.10); color: #fcc; }

.trace-stage { font-weight: 700; }
.trace-verdict { text-transform: uppercase; opacity: 0.75; }
.trace-reason { opacity: 0.9; }
.trace-num { color: #888; }

.trace-empty {
  padding: 14px;
  color: #666;
  text-align: center;
}
</style>
