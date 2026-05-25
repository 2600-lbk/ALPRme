import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

interface ExpectedFixture {
  image: string
  width: number
  height: number
  detections: Array<{
    plate: string
    bbox: { x1: number; y1: number; x2: number; y2: number }
    detector_confidence: number
  }>
}

interface PredictResult {
  count: number
  plates: string[]
  bboxes: Array<{ x1: number; y1: number; x2: number; y2: number }>
  confidences: number[]
}

interface FixtureReport {
  image: string
  expected: { count: number; plates: string[] }
  direct: PredictResult | null
  worker: PredictResult | null
  directMatch: boolean
  workerMatch: boolean
  crossMatch: boolean
}

function iou(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): number {
  const ix1 = Math.max(a.x1, b.x1)
  const iy1 = Math.max(a.y1, b.y1)
  const ix2 = Math.min(a.x2, b.x2)
  const iy2 = Math.min(a.y2, b.y2)
  if (ix2 <= ix1 || iy2 <= iy1) return 0
  const inter = (ix2 - ix1) * (iy2 - iy1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (areaA + areaB - inter)
}

function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const m: number[][] = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j++) m[0]![j] = j
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      m[i]![j] = b[i - 1] === a[j - 1]
        ? m[i - 1]![j - 1]!
        : Math.min(m[i - 1]![j - 1]!, m[i]![j - 1]!, m[i - 1]![j]!) + 1
  return m[b.length]![a.length]!
}

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'alpr')

function loadExpected(): ExpectedFixture[] {
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.expected.json'))
  return files.map(f => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')) as ExpectedFixture)
}

test.describe('Cross-model parity report', () => {
  test('direct vs worker predictions match across all fixtures', async ({ page }) => {
    await page.goto('/worker-test.html')
    await page.waitForFunction(() => (window as any).__ready)

    const expectedFixtures = loadExpected()
    expect(expectedFixtures.length).toBeGreaterThanOrEqual(1)

    const report: FixtureReport[] = await page.evaluate(async (fixturesJson: string) => {
      const editDistance = function (a: string, b: string): number {
        if (a.length === 0) return b.length
        if (b.length === 0) return a.length
        const m: number[][] = Array.from({ length: b.length + 1 }, (_, i) => [i])
        for (let j = 0; j <= a.length; j++) m[0]![j] = j
        for (let i = 1; i <= b.length; i++)
          for (let j = 1; j <= a.length; j++)
            m[i]![j] = b[i - 1] === a[j - 1]
              ? m[i - 1]![j - 1]!
              : Math.min(m[i - 1]![j - 1]!, m[i]![j - 1]!, m[i - 1]![j]!) + 1
        return m[b.length]![a.length]!
      }

      const expectedList: ExpectedFixture[] = JSON.parse(fixturesJson)
      const AlprClient = (window as any).__client
      const Alpr = (window as any).__Alpr
      const results: FixtureReport[] = []

      const loadImageData = async (src: string): Promise<ImageData> => {
        const img = new Image()
        img.src = src
        await new Promise<void>(resolve => { img.onload = () => resolve() })
        const c = new OffscreenCanvas(img.width, img.height)
        c.getContext('2d')!.drawImage(img, 0, 0)
        return c.getContext('2d')!.getImageData(0, 0, img.width, img.height)
      }

      const runDirect = async (imgData: ImageData, initOpts: any) => {
        const alpr = new Alpr()
        await alpr.init(initOpts)
        const dets = await alpr.predict(imgData)
        alpr.dispose()
        return dets
      }

      const runWorker = async (imgData: ImageData, initOpts: any) => {
        const client = new AlprClient()
        await client.init(initOpts)
        const c = new OffscreenCanvas(imgData.width, imgData.height)
        c.getContext('2d')!.putImageData(imgData, 0, 0)
        const bmp = c.transferToImageBitmap()
        const dets = await client.predict(bmp)
        await client.dispose()
        return dets
      }

      const ocrConfigData = await fetch('/models/cct_v2_global_plate_config.json').then(r => r.json())

      const directInitOpts = {
        detectorUrl: '/models/yolo-v9-t-384.onnx',
        ocrUrl: '/models/cct_xs_v2_global.onnx',
        ocrConfig: ocrConfigData,
      }

      const workerInitOpts = {
        detectorUrl: '/models/yolo-v9-t-384.onnx',
        ocrUrl: '/models/cct_xs_v2_global.onnx',
        ocrConfigUrl: '/models/cct_v2_global_plate_config.json',
      }

      for (const expected of expectedList) {
        const imgData = await loadImageData('/fixtures/dataset/' + expected.image)

        let directResult: PredictResult | null = null
        let workerResult: PredictResult | null = null

        try {
          const direct = await runDirect(imgData, directInitOpts)
          directResult = {
            count: direct.length,
            plates: direct.map(d => d.plate),
            bboxes: direct.map(d => d.bbox),
            confidences: direct.map(d => d.confidence),
          }
        } catch (e: any) {
          directResult = { count: -1, plates: ['ERR:' + String(e?.message || e).slice(0, 80)], bboxes: [], confidences: [] }
        }

        try {
          const worker = await runWorker(imgData, workerInitOpts)
          workerResult = {
            count: worker.length,
            plates: worker.map((d: any) => d.plate),
            bboxes: worker.map((d: any) => d.bbox),
            confidences: worker.map((d: any) => d.confidence),
          }
        } catch (e: any) {
          workerResult = { count: -1, plates: ['ERR:' + String(e?.message || e).slice(0, 40)], bboxes: [], confidences: [] }
        }

        const expPlates = expected.detections.map(d => d.plate).sort()
        const directPlates = directResult?.plates.sort() ?? []
        const workerPlates = workerResult?.plates.sort() ?? []

        const platesMatch = (a: string[], b: string[]) =>
          a.length === b.length && a.every((p, i) => editDistance(p, b[i]!) <= 1)

        results.push({
          image: expected.image,
          expected: { count: expected.detections.length, plates: expPlates },
          direct: directResult,
          worker: workerResult,
          directMatch: platesMatch(directPlates, expPlates),
          workerMatch: platesMatch(workerPlates, expPlates),
          crossMatch: directResult && workerResult && platesMatch(directPlates, workerPlates),
        })
      }

      return results
    }, JSON.stringify(expectedFixtures))

    // Print report table
    const pad = (s: string, w: number) => s.padEnd(w)
    const header = `${pad('Image', 18)} | ${pad('Expected', 15)} | ${pad('Direct', 40)} | ${pad('Worker', 15)} | ${pad('D=E', 5)} | ${pad('W=E', 5)} | ${pad('D=W', 5)}`
    console.log('\n' + '='.repeat(header.length))
    console.log('PHASE 1-2 CROSS-MODEL PARITY REPORT')
    console.log('='.repeat(header.length))
    console.log(header)
    console.log('-'.repeat(header.length))

    let directOk = 0; let workerOk = 0; let crossOk = 0

    for (const r of report) {
      if (r.directMatch) directOk++
      if (r.workerMatch) workerOk++
      if (r.crossMatch) crossOk++

      const expStr = r.expected.count === 0 ? 'NEGATIVE' : r.expected.count + ':' + r.expected.plates.join(',')
      const dirStr = r.direct ? r.direct.count + ':' + r.direct.plates.join(',') : 'FAIL'
      const wrkStr = r.worker ? r.worker.count + ':' + r.worker.plates.join(',') : 'FAIL'

      console.log(
        pad(r.image, 18) + ' | ' +
        pad(expStr, 15) + ' | ' +
        pad(dirStr, 40) + ' | ' +
        pad(wrkStr, 15) + ' | ' +
        pad(r.directMatch ? '✓' : '✗', 5) + ' | ' +
        pad(r.workerMatch ? '✓' : '✗', 5) + ' | ' +
        pad(r.crossMatch ? '✓' : '✗', 5),
      )
    }

    console.log('-'.repeat(header.length))
    console.log(
      pad('TOTALS', 18) + ' | ' +
      pad('', 15) + ' | ' +
      pad('', 40) + ' | ' +
      pad('', 15) + ' | ' +
      pad(`${directOk}/${report.length}`, 5) + ' | ' +
      pad(`${workerOk}/${report.length}`, 5) + ' | ' +
      pad(`${crossOk}/${report.length}`, 5),
    )
    console.log('='.repeat(header.length))

    // Assertions
    expect(directOk).toBeGreaterThanOrEqual(report.length - 2)
    expect(workerOk).toBeGreaterThanOrEqual(report.length - 2)
    expect(crossOk).toBe(report.length) // direct and worker must match each other
  }, 120000)
})
