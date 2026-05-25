import Dexie, { type EntityTable } from 'dexie'
import type { DecisionTrace } from '@/pipeline/trace'
import type { CaptureProfile } from '@/capture/profile'

const DB_OPEN_TIMEOUT_MS = 15_000

export type SessionMode = 'normal' | 'diagnostic'

export interface SessionRecord {
  id?: number
  startedAt: number
  endedAt: number | null
  keepCrops: boolean
  /** v3+. Older rows default to 'normal' on read. */
  mode?: SessionMode
  /** v4+. Capture profile in effect for this session. */
  captureProfileId?: number
}

/** v4+. Stored capture profile (camera + window config). */
export type CaptureProfileRecord = CaptureProfile

export interface DetectionRecord {
  id?: number
  sessionId: number
  plate: string
  confidence: number
  charConfidences: number[]
  bbox: { x1: number; y1: number; x2: number; y2: number }
  detectorConfidence: number
  latitude: number | null
  longitude: number | null
  heading: number | null
  speedKph: number | null
  altitudeM: number | null
  region: string | null
  regionConfidence: number | null
  timestamp: number
  /** v3+. When true, the pipeline rejected this detection but it was stored anyway
   *  because the session is in diagnostic mode. */
  suppressed?: boolean
  /** v3+. Decision trace from the filtering pipeline. */
  decisionTrace?: DecisionTrace
}

export interface CropRecord {
  id?: number
  detectionId: number
  blob: Blob
}

export interface AssetRecord {
  id?: number
  key: string
  data: Blob
  lastModified: number
}

export class ALPRmeDB extends Dexie {
  sessions!: EntityTable<SessionRecord, 'id'>
  detections!: EntityTable<DetectionRecord, 'id'>
  crops!: EntityTable<CropRecord, 'id'>
  assets!: EntityTable<AssetRecord, 'id'>
  prefs!: EntityTable<{ key: string; value: unknown }, 'key'>
  captureProfiles!: EntityTable<CaptureProfileRecord, 'id'>

  constructor() {
    super('alprme')

    this.version(1).stores({
      sessions: '++id, startedAt, endedAt',
      detections: '++id, sessionId, plate, timestamp, [sessionId+timestamp]',
      crops: '++id, detectionId',
      assets: '++id, &key',
    })

    this.version(2).stores({
      sessions: '++id, startedAt, endedAt',
      detections: '++id, sessionId, plate, timestamp, [sessionId+timestamp]',
      crops: '++id, detectionId',
      assets: '++id, &key',
      prefs: '&key',
    })

    // v3: adds SessionRecord.mode and DetectionRecord.{suppressed,decisionTrace}.
    // No index changes; additive fields handled by consumers with defaults.
    this.version(3).stores({
      sessions: '++id, startedAt, endedAt',
      detections: '++id, sessionId, plate, timestamp, [sessionId+timestamp]',
      crops: '++id, detectionId',
      assets: '++id, &key',
      prefs: '&key',
    })

    // v4: adds captureProfiles table; SessionRecord.captureProfileId is additive.
    this.version(4).stores({
      sessions: '++id, startedAt, endedAt',
      detections: '++id, sessionId, plate, timestamp, [sessionId+timestamp]',
      crops: '++id, detectionId',
      assets: '++id, &key',
      prefs: '&key',
      captureProfiles: '++id, &name, updatedAt',
    })
  }
}

let dbInstance: ALPRmeDB | null = null

export function getDb(): ALPRmeDB {
  if (!dbInstance) {
    dbInstance = new ALPRmeDB()
  }
  return dbInstance
}

export async function openDb(timeoutMs = DB_OPEN_TIMEOUT_MS): Promise<ALPRmeDB> {
  const db = getDb()
  if (!db.isOpen()) {
    try {
      await Promise.race([
        db.open(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Database open timed out')), timeoutMs),
        ),
      ])
    } catch (e) {
      throw new Error(`Failed to open database: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return db
}
