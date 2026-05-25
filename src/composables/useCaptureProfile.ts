import { ref, computed, readonly, toRaw } from 'vue'
import { openDb, getDb } from '@/storage/db'
import type { CaptureProfileRecord } from '@/storage/db'
import { buildDefaultProfile, singleCellGrid, type CaptureProfile } from '@/capture/profile'

/**
 * Strip Vue reactivity proxies from a profile so it can be structurally cloned
 * into IndexedDB. Reactive arrays/objects carry internal symbols that Dexie
 * (and the structured clone algorithm) cannot serialize.
 */
function plainProfile(p: CaptureProfile): CaptureProfile {
  const raw = toRaw(p) as unknown as Record<string, unknown>
  // Deep-strip: JSON round-trip guarantees no Vue internals survive.
  return JSON.parse(JSON.stringify(raw)) as CaptureProfile
}

/**
 * In-place migration for profiles persisted with the pre-grid schema (a
 * `windows: DetectionWindow[]` array). Information loss is acceptable: the
 * only profile in the wild from that era is the auto-seeded "Default" which
 * had a single full-frame window — equivalent to a 1×1 grid.
 */
function migrateRecord(raw: CaptureProfileRecord): { record: CaptureProfileRecord; changed: boolean } {
  const p = raw as unknown as Record<string, unknown>
  const hasGrid = p.grid != null
  const hasMode = typeof p.captureMode === 'string'
  if (hasGrid && hasMode && p.windows == null) {
    return { record: raw, changed: false }
  }
  const migrated: Record<string, unknown> = { ...p }
  if (!hasGrid) migrated.grid = singleCellGrid()
  if (!hasMode) migrated.captureMode = 'whole-frame'
  delete migrated.windows
  return { record: migrated as unknown as CaptureProfileRecord, changed: true }
}

const profiles = ref<CaptureProfileRecord[]>([])
const activeId = ref<number | null>(null)
const loaded = ref(false)
let loadPromise: Promise<void> | null = null

const ACTIVE_PREF_KEY = 'active_capture_profile_id'

export function useCaptureProfile() {
  const active = computed<CaptureProfileRecord | null>(() =>
    profiles.value.find(p => p.id === activeId.value) ?? null,
  )

  async function load(): Promise<void> {
    if (loaded.value) return
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
      try {
        await openDb()
        const db = getDb()
        const rawList = await db.captureProfiles.orderBy('updatedAt').reverse().toArray()

        // Upgrade any legacy profiles in-place (pre-grid schema) and persist
        // the upgraded shape so subsequent reads stabilize.
        const list: CaptureProfileRecord[] = []
        for (const raw of rawList) {
          const { record, changed } = migrateRecord(raw)
          if (changed && record.id != null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await db.captureProfiles.update(record.id, record as any)
          }
          list.push(record)
        }
        profiles.value = list

        const activeRec = await db.prefs.get(ACTIVE_PREF_KEY)
        const storedId = typeof activeRec?.value === 'number' ? activeRec.value : null

        if (list.length === 0) {
          // First run: seed a default profile and make it active.
          const defaultProf = buildDefaultProfile('Default')
          const id = await db.captureProfiles.add(defaultProf) as number
          profiles.value = [{ ...defaultProf, id }]
          activeId.value = id
          await db.prefs.put({ key: ACTIVE_PREF_KEY, value: id })
        } else if (storedId != null && list.some(p => p.id === storedId)) {
          activeId.value = storedId
        } else {
          // Stored active id no longer exists; fall back to the most-recent profile.
          activeId.value = list[0]!.id!
          await db.prefs.put({ key: ACTIVE_PREF_KEY, value: activeId.value })
        }
        loaded.value = true
      } catch (e) {
        // Reset so retries work — don't poison future load() calls.
        loaded.value = false
        loadPromise = null
        throw e
      }
    })()
    return loadPromise
  }

  async function save(p: CaptureProfile): Promise<number> {
    const plain = plainProfile(p)
    await openDb()
    const db = getDb()
    const now = Date.now()
    if (plain.id != null) {
      try {
        await db.captureProfiles.update(plain.id, { ...plain, updatedAt: now } as Partial<CaptureProfileRecord>)
      } catch (e: any) {
        const msg = e?.message ?? String(e)
        if (msg.includes('ConstraintError') || msg.includes('unique')) {
          throw new Error(`A profile named "${plain.name}" already exists. Please choose a different name.`)
        }
        throw e
      }
      const idx = profiles.value.findIndex(x => x.id === plain.id)
      if (idx >= 0) profiles.value[idx] = { ...plain, updatedAt: now }
      return plain.id
    }
    try {
      const id = await db.captureProfiles.add({ ...plain, createdAt: now, updatedAt: now }) as number
      profiles.value = [{ ...plain, id, createdAt: now, updatedAt: now }, ...profiles.value]
      return id
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (msg.includes('ConstraintError') || msg.includes('unique')) {
        const existing = profiles.value.find(x => x.name === plain.name)
        if (existing?.id != null) {
          await db.captureProfiles.update(existing.id, { ...plain, updatedAt: now } as Partial<CaptureProfileRecord>)
          const idx = profiles.value.findIndex(x => x.id === existing.id)
          if (idx >= 0) profiles.value[idx] = { ...plain, id: existing.id, updatedAt: now }
          return existing.id
        }
        throw new Error(`A profile named "${plain.name}" already exists. Please choose a different name.`)
      }
      throw e
    }
  }

  async function remove(id: number): Promise<void> {
    await openDb()
    const db = getDb()
    await db.captureProfiles.delete(id)
    profiles.value = profiles.value.filter(p => p.id !== id)
    if (activeId.value === id) {
      activeId.value = profiles.value[0]?.id ?? null
      if (activeId.value != null) {
        await db.prefs.put({ key: ACTIVE_PREF_KEY, value: activeId.value })
      }
    }
  }

  async function setActive(id: number): Promise<void> {
    if (!profiles.value.some(p => p.id === id)) throw new Error('Unknown capture profile id')
    activeId.value = id
    await openDb()
    const db = getDb()
    await db.prefs.put({ key: ACTIVE_PREF_KEY, value: id })
  }

  async function duplicate(id: number, newName: string): Promise<number> {
    const src = profiles.value.find(p => p.id === id)
    if (!src) throw new Error('Unknown capture profile id')
    const { id: _omit, ...rest } = src
    return save({ ...rest, name: newName } as CaptureProfile)
  }

  function findById(id: number): CaptureProfileRecord | null {
    return profiles.value.find(p => p.id === id) ?? null
  }

  return {
    profiles: readonly(profiles),
    activeId: readonly(activeId),
    active,
    loaded: readonly(loaded),
    load,
    save,
    remove,
    setActive,
    duplicate,
    findById,
  }
}
