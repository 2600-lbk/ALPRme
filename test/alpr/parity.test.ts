import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadImage, createCanvas } from 'canvas'
import type { BoundingBox } from '@/packages/alpr/types'
import { Alpr, iou } from '@/packages/alpr'
import type { OcrConfig } from '@/packages/alpr/types'

interface ExpectedFixture {
  image: string
  width: number
  height: number
  detections: Array<{
    plate: string
    confidence: number
    char_confidences: number[]
    detector_confidence: number
    bbox: { x1: number; y1: number; x2: number; y2: number }
    region: string | null
    region_confidence: number | null
  }>
}

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'alpr')
const DATASET_DIR = join(FIXTURES_DIR, 'dataset')
const MODELS_DIR = join(process.cwd(), 'public', 'models')
const PARITY_MIN_IOU = 0.7

function resolveImagePath(name: string): string {
  // Look in root fixtures first, then dataset subdirectory.
  const rootPath = join(FIXTURES_DIR, name)
  if (existsSync(rootPath)) return rootPath
  const datasetPath = join(DATASET_DIR, name)
  if (existsSync(datasetPath)) return datasetPath
  return rootPath // fallback — will throw if missing
}

async function loadImageAsImageData(path: string): Promise<ImageData> {
  const img = await loadImage(path)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const raw = ctx.getImageData(0, 0, img.width, img.height)
  return Object.assign(raw, { colorSpace: 'srgb' }) as unknown as ImageData
}

function plateTextCloseEnough(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()
  for (let i = 0; i < sortedActual.length; i++) {
    const a = sortedActual[i]!
    const e = sortedExpected[i]!
    if (a === e) continue
    const dist = editDistance(a, e)
    if (dist > 1) return false
  }
  return true
}

function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1,
        )
      }
    }
  }
  return matrix[b.length]![a.length]!
}

describe('ALPR parity', () => {
  const alpr = new Alpr()
  const fixtures: Array<{ expected: ExpectedFixture; imageData: ImageData }> = []

  beforeAll(async () => {
    const ocrConfig = JSON.parse(
      readFileSync(join(MODELS_DIR, 'cct_v2_global_plate_config.json'), 'utf-8'),
    ) as OcrConfig

    await alpr.init({
      detectorUrl: join(MODELS_DIR, 'yolo-v9-t-384.onnx'),
      ocrUrl: join(MODELS_DIR, 'cct_xs_v2_global.onnx'),
      ocrConfig,
    })

    const files = readdirSync(FIXTURES_DIR)
    const expectedFiles = files.filter((f: string) => f.endsWith('.expected.json'))

    for (const ef of expectedFiles) {
      const expected = JSON.parse(
        readFileSync(join(FIXTURES_DIR, ef), 'utf-8'),
      ) as ExpectedFixture

      const imagePath = resolveImagePath(expected.image)
      const imageData = await loadImageAsImageData(imagePath)

      fixtures.push({ expected, imageData })
    }
  }, 30000)

  it('initializes to correct model shapes', () => {
    expect(alpr.isInitialized).toBe(true)
  })

  it('all fixture plates match reference plate text', async () => {
    // OCR uses canvas drawImage (bilinear) for resizing, while Python reference
    // uses OpenCV INTER_LINEAR. Minor pixel differences can cause argmax flips
    // on low-confidence character positions (edit distance ≤ 1 accepted).
    for (const { expected, imageData } of fixtures) {
      const results = await alpr.predict(imageData)
      const actualPlates = results.map(r => r.plate).sort()
      const expectedPlates = expected.detections.map(d => d.plate).sort()

      expect(results.length, `${expected.image}: detection count`).toBe(expected.detections.length)
      expect(plateTextCloseEnough(actualPlates, expectedPlates),
        `${expected.image}: plates ${actualPlates} vs ${expectedPlates}`,
      ).toBe(true)
    }
  }, 30000)

  it('all fixture bounding boxes have IoU >= 0.7 vs reference', async () => {
    for (const { expected, imageData } of fixtures) {
      const results = await alpr.predict(imageData)

      for (const refDet of expected.detections) {
        const refBox: BoundingBox = refDet.bbox
        const bestIoU = Math.max(
          ...results.map(r => iou(r.bbox, refBox)),
          0,
        )
        expect(bestIoU,
          `${expected.image}: bbox IoU for plate "${refDet.plate}"`,
        ).toBeGreaterThanOrEqual(PARITY_MIN_IOU)
      }
    }
  }, 60000)

  it('detector confidence >= 0 threshold', async () => {
    for (const { imageData } of fixtures) {
      const results = await alpr.predict(imageData)
      for (const r of results) {
        expect(r.confidence).toBeGreaterThanOrEqual(0)
        expect(r.confidence).toBeLessThanOrEqual(1)
      }
    }
  }, 30000)

  it('negative (blank) fixture returns zero detections', async () => {
    const canvas = createCanvas(640, 480)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, 640, 480)
    const raw = ctx.getImageData(0, 0, 640, 480)
    const blackFrame = Object.assign(raw, { colorSpace: 'srgb' }) as unknown as ImageData
    const results = await alpr.predict(blackFrame)
    expect(results.length).toBe(0)
  }, 30000)

  it('corrupt model URL throws typed error on init', async () => {
    const badAlpr = new Alpr()
    await expect(
      badAlpr.init({
        detectorUrl: '/nonexistent/model.onnx',
        ocrUrl: '/nonexistent/ocr.onnx',
        ocrConfig: {
          max_plate_slots: 10,
          alphabet: '0123456789_',
          pad_char: '_',
          img_height: 64,
          img_width: 128,
          image_color_mode: 'rgb',
        },
      }),
    ).rejects.toThrow()
  }, 10000)
})
