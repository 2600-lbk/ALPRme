import * as ort from 'onnxruntime-web'
import type { BoundingBox } from './types'
import { createCanvas } from './canvas-helpers'

export interface Stage1Result {
  bbox: BoundingBox
  confidence: number
  classId: number
}

export class Stage1Detector {
  private session: ort.InferenceSession | null = null
  private imgSize: [number, number] | null = null
  private confidenceThreshold: number

  constructor(options: { confidenceThreshold?: number } = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? 0.4
  }

  get inputShape(): readonly (number | string)[] | null {
    return this.session?.inputMetadata?.[0]?.isTensor
      ? this.session.inputMetadata[0].shape
      : null
  }

  async init(modelUrl: string, executionProviders?: Array<'webgpu' | 'webgl' | 'wasm'>): Promise<void> {
    const opts = executionProviders?.length
      ? { executionProviders: executionProviders as unknown as readonly string[] }
      : undefined
    this.session = await ort.InferenceSession.create(modelUrl, opts)
    const meta = this.session.inputMetadata[0]
    if (!meta || !meta.isTensor) {
      throw new Error('Stage 1 model must have tensor input')
    }
    const shape = meta.shape
    if (shape.length !== 4) {
      throw new Error('Stage 1 model must have 4D input')
    }
    const h = Number(shape[2])
    const w = Number(shape[3])
    if (h !== w) {
      throw new Error(`Stage 1 model requires square input, got ${h}x${w}`)
    }
    this.imgSize = [h, w]
  }

  async detect(image: ImageData): Promise<Stage1Result[]> {
    if (!this.session || !this.imgSize) {
      throw new Error('Stage 1 not initialized')
    }
    const [imgH, imgW] = this.imgSize
    const { data: floatData, ratio, padding } = preprocess(image, imgH, imgW)
    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, imgH, imgW])

    const outputs = await this.session.run({ [this.session.inputNames[0]!]: inputTensor })
    const outputTensor = outputs[this.session.outputNames[0]!]
    if (!outputTensor) {
      throw new Error('Stage 1 model produced no output')
    }
    const outputData = outputTensor.data as Float32Array
    const numDetections = outputData.length / 7

    return parseYoloOutput(outputData, numDetections, ratio, padding, this.confidenceThreshold)
  }

  dispose(): void {
    this.session?.release()
    this.session = null
    this.imgSize = null
  }
}

export function letterboxDims(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
): { ratio: [number, number]; padding: [number, number]; newW: number; newH: number } {
  const r = Math.min(targetH / srcH, targetW / srcW)
  const newW = Math.round(srcW * r)
  const newH = Math.round(srcH * r)
  const dw = (targetW - newW) / 2
  const dh = (targetH - newH) / 2
  return { ratio: [r, r], padding: [dw, dh], newW, newH }
}

export function letterbox(
  image: ImageData,
  targetHeight: number,
  targetWidth: number,
  color: [number, number, number] = [114, 114, 114],
): { data: Uint8ClampedArray; ratio: [number, number]; padding: [number, number] } {
  const { width: srcW, height: srcH } = image
  const dims = letterboxDims(srcW, srcH, targetWidth, targetHeight)
  const { ratio, padding, newW, newH } = dims

  const srcCanvas = createCanvas(srcW, srcH)
  srcCanvas.getContext('2d')!.putImageData(image, 0, 0)

  const outCanvas = createCanvas(targetWidth, targetHeight)
  const outCtx = outCanvas.getContext('2d')!

  outCtx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`
  outCtx.fillRect(0, 0, targetWidth, targetHeight)

  const top = Math.round(padding[1] - 0.1)
  const left = Math.round(padding[0] - 0.1)
  outCtx.drawImage(srcCanvas, left, top, newW, newH)

  const resultImageData = outCtx.getImageData(0, 0, targetWidth, targetHeight)

  return {
    data: resultImageData.data,
    ratio,
    padding,
  }
}

export function preprocess(
  image: ImageData,
  targetHeight: number,
  targetWidth: number,
): { data: Float32Array; ratio: [number, number]; padding: [number, number] } {
  const { data: rgbaData, ratio, padding } = letterbox(image, targetHeight, targetWidth)
  const pixelCount = targetHeight * targetWidth
  const floatData = new Float32Array(3 * pixelCount)

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4
    const r = rgbaData[srcIdx]! / 255
    const g = rgbaData[srcIdx + 1]! / 255
    const b = rgbaData[srcIdx + 2]! / 255
    floatData[0 * pixelCount + i] = r
    floatData[1 * pixelCount + i] = g
    floatData[2 * pixelCount + i] = b
  }

  return { data: floatData, ratio, padding }
}

function parseYoloOutput(
  outputData: Float32Array,
  numDetections: number,
  ratio: [number, number],
  padding: [number, number],
  scoreThreshold: number,
): Stage1Result[] {
  const results: Stage1Result[] = []

  for (let i = 0; i < numDetections; i++) {
    const offset = i * 7
    const score = outputData[offset + 6]!
    if (score < scoreThreshold) continue

    const x1 = (outputData[offset + 1]! - padding[0]) / ratio[0]
    const y1 = (outputData[offset + 2]! - padding[1]) / ratio[1]
    const x2 = (outputData[offset + 3]! - padding[0]) / ratio[0]
    const y2 = (outputData[offset + 4]! - padding[1]) / ratio[1]
    const classId = outputData[offset + 5]!

    results.push({
      bbox: { x1, y1, x2, y2 },
      confidence: score,
      classId,
    })
  }

  return results
}
