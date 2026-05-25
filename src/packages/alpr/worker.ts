import { Alpr } from './index'
import type { OcrConfig } from './types'
import type { WorkerRequest, WorkerResponse, InitResponse } from './worker-protocol'

let alpr: Alpr | null = null
let busy = false

function detectBackend(requested: Array<'webgpu' | 'webgl' | 'wasm'> | undefined): string {
  if (requested?.includes('webgpu') && typeof (self as any).navigator?.gpu !== 'undefined') return 'webgpu'
  if (requested?.includes('webgl') && typeof (self as any).navigator?.gpu === 'undefined') return 'webgl'
  return 'wasm'
}

async function handleInit(req: Extract<WorkerRequest, { type: 'init' }>): Promise<InitResponse> {
  const { detectorUrl, ocrUrl, ocrConfigUrl, backendPreference } = req.payload

  const ocrConfig: OcrConfig = await fetch(ocrConfigUrl).then(r => r.json())

  alpr = new Alpr()
  await alpr.init({
    detectorUrl,
    ocrUrl,
    ocrConfig,
    executionProviders: backendPreference as Array<'webgpu' | 'webgl' | 'wasm'> | undefined,
  })

  const det = alpr.detectorInputSize
  const backend = detectBackend(backendPreference)
  return {
    type: 'init',
    id: req.id,
    ok: true,
    backend,
    detectorInputShape: det ? [1, 3, det.h, det.w] : [1, 3, 384, 384],
    ocrInputShape: [1, 64, 128, 3],
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data

  if (req.type === 'init') {
    try {
      const res = await handleInit(req)
      self.postMessage(res)
    } catch (err) {
      self.postMessage({ type: 'error', id: req.id, error: String(err) } satisfies WorkerResponse)
    }
    return
  }

  if (!alpr) {
    self.postMessage({ type: 'error', id: req.id, error: 'Worker not initialized' } satisfies WorkerResponse)
    return
  }

  if (req.type === 'predict') {
    if (busy) {
      self.postMessage({ type: 'predict', id: req.id, ok: false, error: 'BUSY' } satisfies WorkerResponse)
      return
    }

    busy = true
    try {
      const canvas = new OffscreenCanvas(
        req.payload.bitmap.width,
        req.payload.bitmap.height,
      )
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(req.payload.bitmap, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      const results = await alpr.predict(imageData)
      self.postMessage({
        type: 'predict',
        id: req.id,
        ok: true,
        detections: results,
      } satisfies WorkerResponse)
    } catch (err) {
      self.postMessage({ type: 'error', id: req.id, error: String(err) } satisfies WorkerResponse)
    } finally {
      busy = false
    }
    return
  }

  if (req.type === 'predict-batch') {
    if (busy) {
      self.postMessage({ type: 'predict-batch', id: req.id, ok: false, error: 'BUSY' } satisfies WorkerResponse)
      return
    }

    busy = true
    try {
      const results: Array<{ tileId: string; detections: Awaited<ReturnType<typeof alpr.predict>> }> = []
      for (const tile of req.payload.tiles) {
        const canvas = new OffscreenCanvas(tile.bitmap.width, tile.bitmap.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(tile.bitmap, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const detections = await alpr.predict(imageData)
        results.push({ tileId: tile.tileId, detections })
        tile.bitmap.close?.()
      }
      self.postMessage({
        type: 'predict-batch',
        id: req.id,
        ok: true,
        results,
      } satisfies WorkerResponse)
    } catch (err) {
      self.postMessage({ type: 'error', id: req.id, error: String(err) } satisfies WorkerResponse)
    } finally {
      busy = false
    }
    return
  }

  if (req.type === 'dispose') {
    alpr.dispose()
    alpr = null
    busy = false
    self.postMessage({ type: 'dispose', id: req.id, ok: true } satisfies WorkerResponse)
    return
  }

  self.postMessage({ type: 'error', id: 0, error: 'Unknown message type' } satisfies WorkerResponse)
}