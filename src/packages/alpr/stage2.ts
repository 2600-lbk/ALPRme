import * as ort from 'onnxruntime-web'
import type { OcrConfig } from './types'
import { createCanvas } from './canvas-helpers'

export interface Stage2Result {
  plate: string
  confidence: number
  charConfidences: number[]
  region: string | null
  regionConfidence: number | null
}

export class Stage2OCR {
  private session: ort.InferenceSession | null = null
  config: OcrConfig | null = null
  private regionLabels: string[] | null = null
  private hasRegionHead = false

  async init(modelUrl: string, config: OcrConfig, executionProviders?: Array<'webgpu' | 'webgl' | 'wasm'>): Promise<void> {
    this.config = config
    const opts = executionProviders?.length
      ? { executionProviders: executionProviders as unknown as readonly string[] }
      : undefined
    this.session = await ort.InferenceSession.create(modelUrl, opts)
    this.hasRegionHead = this.session.outputNames.includes('region')
    this.regionLabels = config.plate_regions ?? null
  }

  async recognize(plateImage: ImageData): Promise<Stage2Result | null> {
    if (!this.session || !this.config) {
      throw new Error('Stage 2 not initialized')
    }
    const config = this.config

    const resized = resizeImageData(
      plateImage,
      config.img_height,
      config.img_width,
      config.keep_aspect_ratio ?? false,
      config.padding_color ?? [114, 114, 114],
    )

    const channels = config.image_color_mode === 'grayscale' ? 1 : 3
    const h = config.img_height
    const w = config.img_width
    const pixelCount = h * w
    const inputData = new Uint8Array(channels * pixelCount)

    for (let i = 0; i < pixelCount; i++) {
      const srcIdx = i * 4
      const dstIdx = i * channels
      if (channels === 3) {
        inputData[dstIdx] = resized.data[srcIdx]!
        inputData[dstIdx + 1] = resized.data[srcIdx + 1]!
        inputData[dstIdx + 2] = resized.data[srcIdx + 2]!
      } else {
        const r = resized.data[srcIdx]!
        const g = resized.data[srcIdx + 1]!
        const b = resized.data[srcIdx + 2]!
        inputData[dstIdx] = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
      }
    }

    const inputTensor = new ort.Tensor('uint8', inputData, [1, h, w, channels])

    const fetches = this.hasRegionHead
      ? [this.session.outputNames.find(n => n === 'plate')!, this.session.outputNames.find(n => n === 'region')!]
      : [this.session.outputNames.find(n => n === 'plate')!]

    const outputs = await this.session.run({ input: inputTensor }, fetches)

    const plateOutput = (outputs.plate ?? outputs[fetches[0]!])!.data as Float32Array
    const regionOutput = outputs.region
      ? (outputs.region.data as Float32Array)
      : undefined

    return decodeOutput(plateOutput, config, regionOutput, this.regionLabels)
  }

  dispose(): void {
    this.session?.release()
    this.session = null
    this.config = null
    this.regionLabels = null
  }
}

function resizeImageData(
  image: ImageData,
  targetHeight: number,
  targetWidth: number,
  keepAspectRatio: boolean,
  paddingColor: [number, number, number],
): ImageData {
  const canvas = createCanvas(targetWidth, targetHeight)
  const ctx = canvas.getContext('2d')!

  const source = imageDataToCanvas(image)

  if (!keepAspectRatio) {
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
    return ctx.getImageData(0, 0, targetWidth, targetHeight)
  }

  const r = Math.min(targetHeight / image.height, targetWidth / image.width)
  const newW = Math.round(image.width * r)
  const newH = Math.round(image.height * r)

  const dw = (targetWidth - newW) / 2
  const dh = (targetHeight - newH) / 2

  ctx.fillStyle = `rgb(${paddingColor[0]},${paddingColor[1]},${paddingColor[2]})`
  ctx.fillRect(0, 0, targetWidth, targetHeight)

  const top = Math.round(dh - 0.1)
  const left = Math.round(dw - 0.1)
  ctx.drawImage(source, left, top, newW, newH)

  return ctx.getImageData(0, 0, targetWidth, targetHeight)
}

function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(image, 0, 0)
  return canvas as unknown as HTMLCanvasElement
}

function decodeOutput(
  plateData: Float32Array,
  config: OcrConfig,
  regionData: Float32Array | undefined,
  regionLabels: string[] | null,
): Stage2Result {
  const { max_plate_slots, alphabet, pad_char } = config
  const vocabSize = alphabet.length

  const chars: string[] = []
  const charConfidences: number[] = []

  for (let slot = 0; slot < max_plate_slots; slot++) {
    const start = slot * vocabSize
    let maxIdx = 0
    let maxVal = plateData[start]!

    for (let j = 1; j < vocabSize; j++) {
      const val = plateData[start + j]!
      if (val > maxVal) {
        maxVal = val
        maxIdx = j
      }
    }

    chars.push(alphabet[maxIdx]!)
    charConfidences.push(maxVal)
  }

  let plate = chars.join('')
  if (pad_char) {
    while (plate.endsWith(pad_char)) {
      plate = plate.slice(0, -1)
    }
  }

  const validCharConfidences = charConfidences.slice(0, plate.length)
  const confidence = validCharConfidences.length > 0
    ? validCharConfidences.reduce((a, b) => a + b, 0) / validCharConfidences.length
    : 0

  let region: string | null = null
  let regionConfidence: number | null = null

  if (regionData && regionLabels) {
    let maxIdx = 0
    let maxVal = regionData[0]!
    for (let j = 1; j < regionData.length; j++) {
      if (regionData[j]! > maxVal) {
        maxVal = regionData[j]!
        maxIdx = j
      }
    }
    region = regionLabels[maxIdx] ?? null
    regionConfidence = maxVal
  }

  return { plate, confidence, charConfidences: validCharConfidences, region, regionConfidence }
}
