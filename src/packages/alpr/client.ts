import type { WorkerDetection, WorkerRequest, WorkerResponse } from './worker-protocol'

export class AlprClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, {
    resolve: (value: WorkerResponse) => void
    reject: (error: Error) => void
  }>()

  get isInitialized(): boolean {
    return this.worker !== null
  }

  async init(options: {
    detectorUrl: string
    ocrUrl: string
    ocrConfigUrl: string
    backendPreference?: Array<'webgpu' | 'webgl' | 'wasm'>
  }): Promise<{
    backend: string
    detectorInputShape: [number, number, number, number]
    ocrInputShape: [number, number, number, number]
  }> {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data
      const pending = this.pending.get(res.id)
      if (pending) {
        this.pending.delete(res.id)
        pending.resolve(res)
      }
    }

    this.worker.onerror = (err) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(err.message))
      }
      this.pending.clear()
    }

    const response = await this.sendRequest({
      type: 'init',
      id: this.nextId++,
      payload: {
        detectorUrl: options.detectorUrl,
        ocrUrl: options.ocrUrl,
        ocrConfigUrl: options.ocrConfigUrl,
        backendPreference: options.backendPreference,
      },
    })

    if (response.type === 'error' || !(response as { ok?: boolean }).ok) {
      throw new Error((response as { error?: string }).error ?? 'Init failed')
    }

    const initRes = response as {
      backend: string
      detectorInputShape: [number, number, number, number]
      ocrInputShape: [number, number, number, number]
    }
    return {
      backend: initRes.backend,
      detectorInputShape: initRes.detectorInputShape,
      ocrInputShape: initRes.ocrInputShape,
    }
  }

  async predict(bitmap: ImageBitmap): Promise<WorkerDetection[]> {
    if (!this.worker) {
      throw new Error('AlprClient not initialized')
    }

    const response = await this.sendRequest({
      type: 'predict',
      id: this.nextId++,
      payload: { bitmap },
    }, [bitmap])

    if (response.type === 'predict' && !response.ok) {
      throw new Error('BUSY')
    }

    if (response.type === 'error') {
      throw new Error(response.error)
    }

    return (response as { detections: WorkerDetection[] }).detections
  }

  /**
   * Send N tiles to the worker in a single request. The worker processes them
   * serially and returns per-tile detections (tagged with the original tileId
   * so the caller can reproject bboxes back to source coords).
   */
  async predictBatch(
    tiles: Array<{ tileId: string; bitmap: ImageBitmap }>,
  ): Promise<Array<{ tileId: string; detections: WorkerDetection[] }>> {
    if (!this.worker) {
      throw new Error('AlprClient not initialized')
    }
    if (tiles.length === 0) return []

    const response = await this.sendRequest({
      type: 'predict-batch',
      id: this.nextId++,
      payload: { tiles },
    }, tiles.map(t => t.bitmap))

    if (response.type === 'predict-batch' && !response.ok) {
      throw new Error('BUSY')
    }
    if (response.type === 'error') {
      throw new Error(response.error)
    }

    return (response as { results: Array<{ tileId: string; detections: WorkerDetection[] }> }).results
  }

  async dispose(): Promise<void> {
    if (!this.worker) return

    await this.sendRequest({
      type: 'dispose',
      id: this.nextId++,
    })

    this.worker.terminate()
    this.worker = null
    this.pending.clear()
  }

  private sendRequest(req: WorkerRequest, transfer?: Transferable[]): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject })
      if (transfer) {
        this.worker!.postMessage(req, transfer)
      } else {
        this.worker!.postMessage(req)
      }
    })
  }
}
