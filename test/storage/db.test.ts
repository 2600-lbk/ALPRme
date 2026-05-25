import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, ALPRmeDB } from '@/storage/db'

describe('ALPRmeDB', () => {
  let db: ALPRmeDB

  beforeEach(async () => {
    db = getDb()
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    await db.delete()
  })

  it('creates session', async () => {
    const id = await db.sessions.add({
      startedAt: Date.now(),
      endedAt: null,
      keepCrops: false,
    })
    expect(id).toBeGreaterThan(0)

    const session = await db.sessions.get(id as number)
    expect(session?.keepCrops).toBe(false)
  })

  it('creates detection linked to session', async () => {
    const sessionId = await db.sessions.add({
      startedAt: Date.now(),
      endedAt: null,
      keepCrops: true,
    }) as number

    const detId = await db.detections.add({
      sessionId,
      plate: 'ABC123',
      confidence: 0.95,
      charConfidences: [0.9],
      bbox: { x1: 10, y1: 20, x2: 100, y2: 50 },
      detectorConfidence: 0.85,
      latitude: 37.77,
      longitude: -122.42,
      heading: 45,
      speedKph: null,
      altitudeM: null,
      region: null,
      regionConfidence: null,
      timestamp: Date.now(),
    }) as number

    const det = await db.detections.get(detId)
    expect(det?.plate).toBe('ABC123')
    expect(det?.sessionId).toBe(sessionId)
  })

  it('queries detections by session', async () => {
    const s1 = await db.sessions.add({ startedAt: 1000, endedAt: null, keepCrops: false }) as number
    const s2 = await db.sessions.add({ startedAt: 2000, endedAt: null, keepCrops: false }) as number

    await db.detections.add({
      sessionId: s1, plate: 'A', confidence: 0.9, charConfidences: [],
      bbox: { x1: 0, y1: 0, x2: 10, y2: 10 }, detectorConfidence: 0.8,
      latitude: null, longitude: null, heading: null, speedKph: null, altitudeM: null, region: null, regionConfidence: null, timestamp: 1100,
    })
    await db.detections.add({
      sessionId: s1, plate: 'B', confidence: 0.8, charConfidences: [],
      bbox: { x1: 0, y1: 0, x2: 10, y2: 10 }, detectorConfidence: 0.7,
      latitude: null, longitude: null, heading: null, speedKph: null, altitudeM: null, region: null, regionConfidence: null, timestamp: 1200,
    })
    await db.detections.add({
      sessionId: s2, plate: 'C', confidence: 0.7, charConfidences: [],
      bbox: { x1: 0, y1: 0, x2: 10, y2: 10 }, detectorConfidence: 0.6,
      latitude: null, longitude: null, heading: null, speedKph: null, altitudeM: null, region: null, regionConfidence: null, timestamp: 2100,
    })

    const s1Dets = await db.detections.where({ sessionId: s1 }).toArray()
    expect(s1Dets.length).toBe(2)

    const s2Dets = await db.detections.where({ sessionId: s2 }).toArray()
    expect(s2Dets.length).toBe(1)
  })

  it('updates session endedAt', async () => {
    const id = await db.sessions.add({ startedAt: 1000, endedAt: null, keepCrops: false }) as number

    await db.sessions.update(id, { endedAt: 5000 })
    const updated = await db.sessions.get(id)
    expect(updated?.endedAt).toBe(5000)
  })

  it('deletes detection and associated crops', async () => {
    const sessionId = await db.sessions.add({ startedAt: 1000, endedAt: null, keepCrops: true }) as number
    const detId = await db.detections.add({
      sessionId, plate: 'X', confidence: 0.5, charConfidences: [],
      bbox: { x1: 0, y1: 0, x2: 10, y2: 10 }, detectorConfidence: 0.5,
      latitude: null, longitude: null, heading: null, speedKph: null, altitudeM: null, region: null, regionConfidence: null, timestamp: 1100,
    }) as number

    await db.crops.add({ detectionId: detId, blob: new Blob(['test']) })

    await db.crops.where({ detectionId: detId }).delete()
    await db.detections.delete(detId)

    const det = await db.detections.get(detId)
    expect(det).toBeUndefined()

    const crops = await db.crops.where({ detectionId: detId }).toArray()
    expect(crops.length).toBe(0)
  })

  it('stores and retrieves assets by key', async () => {
    await db.assets.add({
      key: 'wmm-cof',
      data: new Blob(['test data']),
      lastModified: Date.now(),
    })

    const asset = await db.assets.where({ key: 'wmm-cof' }).first()
    expect(asset?.key).toBe('wmm-cof')

    const missing = await db.assets.where({ key: 'nonexistent' }).first()
    expect(missing).toBeUndefined()
  })

  it('round-trips 1000 synthetic detections', async () => {
    const sessionId = await db.sessions.add({ startedAt: 1000, endedAt: null, keepCrops: false }) as number

    for (let i = 0; i < 1000; i++) {
      await db.detections.add({
        sessionId, plate: `PLATE${i}`, confidence: 0.5 + Math.random() * 0.5, charConfidences: [],
        bbox: { x1: i, y1: i, x2: i + 10, y2: i + 10 }, detectorConfidence: 0.5,
        latitude: null, longitude: null, heading: null, speedKph: null, altitudeM: null, region: null, regionConfidence: null,
        timestamp: 1000 + i * 10,
      })
    }

    const count = await db.detections.where({ sessionId }).count()
    expect(count).toBe(1000)
  })
})
