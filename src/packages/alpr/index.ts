import type { AlprInitOptions, Detection, OcrConfig } from './types'
import { Stage1Detector } from './stage1'
import { Stage2OCR } from './stage2'
import { createCanvas } from './canvas-helpers'

export type { AlprInitOptions, Detection, OcrConfig, BoundingBox } from './types'
export { Stage1Detector, letterboxDims } from './stage1'
export { Stage2OCR } from './stage2'
export { iou } from './types'

export class Alpr {
  private detector = new Stage1Detector()
  private ocr = new Stage2OCR()
  private ocrConfig: OcrConfig | null = null
  private initialized = false

  get isInitialized(): boolean {
    return this.initialized
  }

  /** Detector input shape in (width, height) pixels. Square per the model
   *  contract enforced in Stage1Detector.init. Null until initialized. */
  get detectorInputSize(): { w: number; h: number } | null {
    const shape = this.detector.inputShape
    if (!shape || shape.length !== 4) return null
    const h = Number(shape[2])
    const w = Number(shape[3])
    if (!Number.isFinite(h) || !Number.isFinite(w)) return null
    return { w, h }
  }

  async init(options: AlprInitOptions): Promise<void> {
    const config: OcrConfig = typeof options.ocrConfig === 'string'
      ? await fetchOcrConfig(options.ocrConfig)
      : options.ocrConfig

    this.ocrConfig = config
    const providers = options.executionProviders

    await Promise.all([
      this.detector.init(options.detectorUrl, providers),
      this.ocr.init(options.ocrUrl, config, providers),
    ])

    this.initialized = true
  }

  async predict(image: ImageData): Promise<Detection[]> {
    if (!this.initialized || !this.ocrConfig) {
      throw new Error('Alpr not initialized')
    }

    const detections = await this.detector.detect(image)
    const results: Detection[] = []

    for (const det of detections) {
      const cropped = cropImageData(image, det.bbox)
      if (!cropped) continue

      const ocrResult = await this.ocr.recognize(cropped)
      if (!ocrResult) continue

      results.push({
        plate: ocrResult.plate,
        confidence: ocrResult.confidence,
        charConfidences: ocrResult.charConfidences,
        bbox: det.bbox,
        detectorConfidence: det.confidence,
        region: ocrResult.region,
        regionConfidence: ocrResult.regionConfidence,
      })
    }

    return results
  }

  dispose(): void {
    this.detector.dispose()
    this.ocr.dispose()
    this.ocrConfig = null
    this.initialized = false
  }
}

function cropImageData(image: ImageData, bbox: { x1: number; y1: number; x2: number; y2: number }): ImageData | null {
  const x1 = Math.max(0, Math.floor(bbox.x1))
  const y1 = Math.max(0, Math.floor(bbox.y1))
  const x2 = Math.min(image.width, Math.ceil(bbox.x2))
  const y2 = Math.min(image.height, Math.ceil(bbox.y2))

  const cropW = x2 - x1
  const cropH = y2 - y1

  if (cropW <= 0 || cropH <= 0) return null

  const canvas = createCanvas(cropW, cropH)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(image, -x1, -y1)

  return ctx.getImageData(0, 0, cropW, cropH)
}

async function fetchOcrConfig(url: string): Promise<OcrConfig> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch OCR config: ${response.status} ${response.statusText}`)
  }
  return response.json()
}
