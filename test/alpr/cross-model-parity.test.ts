import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadImage, createCanvas } from 'canvas'
import { Alpr } from '@/packages/alpr'
import type { OcrConfig } from '@/packages/alpr/types'
import type { BoundingBox } from '@/packages/alpr/types'

// ---------------------------------------------------------------------------
// Model combos (3 detectors × 2 OCRs = 6)
// ---------------------------------------------------------------------------
interface ModelCombo {
  label: string
  detectorPath: string
  ocrPath: string
  ocrConfigPath: string
}

const MODELS_DIR = join(process.cwd(), 'public', 'models')

const COMBOS: ModelCombo[] = [
  {
    label: 'yolo-v9-t-256 / cct-xs-v2-global',
    detectorPath: join(MODELS_DIR, 'yolo-v9-t-256.onnx'),
    ocrPath: join(MODELS_DIR, 'cct_xs_v2_global.onnx'),
    ocrConfigPath: join(MODELS_DIR, 'cct_v2_global_plate_config.json'),
  },
  {
    label: 'yolo-v9-t-256 / cct-s-v2-global',
    detectorPath: join(MODELS_DIR, 'yolo-v9-t-256.onnx'),
    ocrPath: join(MODELS_DIR, 'cct_s_v2_global.onnx'),
    ocrConfigPath: join(MODELS_DIR, 'cct_v2_global_plate_config.json'),
  },
  {
    label: 'yolo-v9-t-384 / cct-xs-v2-global',
    detectorPath: join(MODELS_DIR, 'yolo-v9-t-384.onnx'),
    ocrPath: join(MODELS_DIR, 'cct_xs_v2_global.onnx'),
    ocrConfigPath: join(MODELS_DIR, 'cct_v2_global_plate_config.json'),
  },
  {
    label: 'yolo-v9-t-384 / cct-s-v2-global',
    detectorPath: join(MODELS_DIR, 'yolo-v9-t-384.onnx'),
    ocrPath: join(MODELS_DIR, 'cct_s_v2_global.onnx'),
    ocrConfigPath: join(MODELS_DIR, 'cct_v2_global_plate_config.json'),
  },
  {
    label: 'yolo-v9-t-512 / cct-xs-v2-global',
    detectorPath: join(MODELS_DIR, 'yolo-v9-t-512.onnx'),
    ocrPath: join(MODELS_DIR, 'cct_xs_v2_global.onnx'),
    ocrConfigPath: join(MODELS_DIR, 'cct_v2_global_plate_config.json'),
  },
  {
    label: 'yolo-v9-t-512 / cct-s-v2-global',
    detectorPath: join(MODELS_DIR, 'yolo-v9-t-512.onnx'),
    ocrPath: join(MODELS_DIR, 'cct_s_v2_global.onnx'),
    ocrConfigPath: join(MODELS_DIR, 'cct_v2_global_plate_config.json'),
  },
]

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Strip characters not in the OCR alphabet (0-9A-Z). */
function normalizePlate(text: string): string {
  return text.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

function editDistance(a: string, b: string): number {
  const na = normalizePlate(a)
  const nb = normalizePlate(b)
  if (na.length === 0) return nb.length
  if (nb.length === 0) return na.length
  const m: number[][] = Array.from({ length: nb.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= na.length; j++) m[0]![j] = j
  for (let i = 1; i <= nb.length; i++)
    for (let j = 1; j <= na.length; j++)
      m[i]![j] = nb[i - 1] === na[j - 1]
        ? m[i - 1]![j - 1]!
        : Math.min(m[i - 1]![j - 1]!, m[i]![j - 1]!, m[i - 1]![j]!) + 1
  return m[nb.length]![na.length]!
}

async function loadImageAsImageData(path: string): Promise<ImageData> {
  const img = await loadImage(path)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const raw = ctx.getImageData(0, 0, img.width, img.height)
  return Object.assign(raw, { colorSpace: 'srgb' }) as unknown as ImageData
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'alpr')
const DATASET_DIR = join(FIXTURES_DIR, 'dataset')
const PY_RESULTS_PATH = join(FIXTURES_DIR, 'eval_results.json')

interface JsResult {
  plates: string[]
  bestEditDistance: number
  exactMatch: boolean
  detectionCount: number
  bestConfidence: number
  bboxes: BoundingBox[]
}

interface PyExpected {
  plates: string[]
  exactMatch: boolean
  bestEditDistance: number
}

function loadGroundTruth(): Map<string, string> {
  const metaPath = join(DATASET_DIR, 'metadata.json')
  const gt = new Map<string, string>()
  if (existsSync(metaPath)) {
    const raw = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, string>
    for (const [k, v] of Object.entries(raw)) gt.set(k, v)
  }
  return gt
}

function loadPyResults(): Map<string, Map<string, PyExpected>> | null {
  if (!existsSync(PY_RESULTS_PATH)) return null
  const raw = JSON.parse(readFileSync(PY_RESULTS_PATH, 'utf-8'))
  const images = raw.images as Record<string, { results: Record<string, { plates: string[]; exact_match: boolean; best_edit_distance: number }> }>
  const map = new Map<string, Map<string, PyExpected>>()
  for (const [img, data] of Object.entries(images)) {
    const comboMap = new Map<string, PyExpected>()
    for (const [key, res] of Object.entries(data.results)) {
      // key format: "yolo-v9-t-384/cct-xs-v2-global|whole"
      comboMap.set(key.split('|')[0]!, {
        plates: res.plates,
        exactMatch: res.exact_match,
        bestEditDistance: res.best_edit_distance,
      })
    }
    map.set(img, comboMap)
  }
  return map
}

// ---------------------------------------------------------------------------
// Table output
// ---------------------------------------------------------------------------

function pad(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 2) + '..' : s.padEnd(w)
}

function printReport(
  results: Array<{
    combo: string
    image: string
    gt: string
    js: JsResult | null
    py: PyExpected | null
  }>,
): void {
  const hdr =
    `${pad('Image', 24)} | ${pad('GT', 10)} | ${pad('Combo', 36)} | ` +
    `${pad('JS Plates', 22)} | ${' Ed'} | ${'M'} | ${'  Conf'} | ` +
    `${pad('Py Plates', 22)} | ${'PyM'}`

  console.log('\n' + '='.repeat(hdr.length))
  console.log('CROSS-MODEL JS PARITY REPORT')
  console.log('='.repeat(hdr.length))
  console.log(hdr)
  console.log('-'.repeat(hdr.length))

  let jsMatch = 0
  let pyMatch = 0
  let total = 0

  let lastCombo = ''

  for (const r of results) {
    if (r.combo !== lastCombo) {
      if (lastCombo) console.log('-'.repeat(hdr.length))
      lastCombo = r.combo
    }

    const jsPlates = r.js ? r.js.plates.join(',') || '(none)' : 'ERR'
    const jsEdit = r.js?.bestEditDistance ?? '?'
    const jsOk = r.js?.exactMatch ? '✓' : '✗'
    const jsConf = r.js?.bestConfidence.toFixed(3) ?? '?'

    const pyPlates = r.py ? r.py.plates.join(',') || '(none)' : '-'
    const pyOk = r.py ? (r.py.exactMatch ? '✓' : '✗') : '-'

    console.log(
      `${pad(r.image, 24)} | ${pad(r.gt, 10)} | ${pad(r.combo, 36)} | ` +
      `${pad(jsPlates, 22)} | ${jsEdit} | ${jsOk} | ${jsConf} | ` +
      `${pad(pyPlates, 22)} | ${pyOk}`,
    )

    if (r.js?.exactMatch) jsMatch++
    if (r.py?.exactMatch) pyMatch++
    total++
  }

  console.log('-'.repeat(hdr.length))
  console.log(
    `${pad('TOTALS', 24)} | ${pad('', 10)} | ${pad('', 36)} | ` +
    `${pad('', 22)} |     |   |       | ` +
    `${pad(`JS exact: ${jsMatch}/${total}  Py: ${pyMatch}/${total}`, 22)} | `,
  )
  console.log('='.repeat(hdr.length) + '\n')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FIXTURES_DIR_ALPR = join(process.cwd(), 'test', 'fixtures', 'alpr')

function collectFixtureImages(): Array<{ path: string; name: string }> {
  const images: Array<{ path: string; name: string }> = []
  for (const dir of [FIXTURES_DIR_ALPR, DATASET_DIR]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (/\.(png|jpe?g)$/i.test(f) && !f.startsWith('.')) {
        images.push({ path: join(dir, f), name: f })
      }
    }
  }
  return images
}

describe('Cross-model ALPR parity (JS direct)', () => {
  const gtMap = loadGroundTruth()
  const pyResults = loadPyResults()
  const allImages = collectFixtureImages()
  const reportRows: Array<{
    combo: string
    image: string
    gt: string
    js: JsResult | null
    py: PyExpected | null
  }> = []

  // Only test combos whose model files exist
  const availableCombos = COMBOS.filter(c =>
    existsSync(c.detectorPath) && existsSync(c.ocrPath) && existsSync(c.ocrConfigPath),
  )

  if (availableCombos.length === 0) {
    it.skip('no model files available — skipping cross-model parity', () => {})
    return
  }

  // Map Python result keys to JS combo labels.
  // Python key format: "yolo-v9-t-384/cct-xs-v2"
  // JS label format:    "yolo-v9-t-384 / cct-xs-v2-global"
  function pyKeyFromLabel(label: string): string {
    return label
      .replace(/ \/ /, '/')
      .replace(/-global$/, '')
  }

  for (const combo of availableCombos) {
    describe(combo.label, () => {
      const alpr = new Alpr()
      const fixtures: Array<{ imageData: ImageData; name: string; gt: string }> = []

      beforeAll(async () => {
        const ocrConfig = JSON.parse(
          readFileSync(combo.ocrConfigPath, 'utf-8'),
        ) as OcrConfig

        await alpr.init({
          detectorUrl: combo.detectorPath,
          ocrUrl: combo.ocrPath,
          ocrConfig,
        })

        for (const img of allImages) {
          try {
            const imageData = await loadImageAsImageData(img.path)
            const gt = gtMap.get(img.name) ?? ''
            fixtures.push({ imageData, name: img.name, gt })
          } catch {
            // skip unreadable images
          }
        }
      }, 120000)

      afterAll(() => {
        alpr.dispose()
      })

      it('predicts and validates all fixture images', async () => {
        let exactCount = 0

        for (const fix of fixtures) {
          const results = await alpr.predict(fix.imageData)
          const plates = results.map(r => r.plate).filter(Boolean)
          const dists = plates.map(p => editDistance(p, fix.gt))
          const bestDist = dists.length > 0 ? Math.min(...dists) : fix.gt.length
          const exact = bestDist === 0
          const bestConf = dists.length > 0
            ? results[dists.indexOf(bestDist)]!.confidence
            : 0

          if (exact) exactCount++

          // Bbox bounds check (allow 1-pixel floating point tolerance)
          const EPS = 1.0
          for (const det of results) {
            expect(det.bbox.x1).toBeGreaterThanOrEqual(-EPS)
            expect(det.bbox.y1).toBeGreaterThanOrEqual(-EPS)
            expect(det.bbox.x2).toBeLessThanOrEqual(fix.imageData.width + EPS)
            expect(det.bbox.y2).toBeLessThanOrEqual(fix.imageData.height + EPS)
            expect(det.confidence).toBeGreaterThanOrEqual(0)
            expect(det.confidence).toBeLessThanOrEqual(1)
            expect(det.detectorConfidence).toBeGreaterThanOrEqual(0)
            expect(det.detectorConfidence).toBeLessThanOrEqual(1)
          }

          const jsResult: JsResult = {
            plates,
            bestEditDistance: bestDist,
            exactMatch: exact,
            detectionCount: results.length,
            bestConfidence: bestConf,
            bboxes: results.map(r => r.bbox),
          }

          const pyExpected = pyResults?.get(fix.name)?.get(pyKeyFromLabel(combo.label)) ?? null

          reportRows.push({
            combo: combo.label,
            image: fix.name,
            gt: fix.gt,
            js: jsResult,
            py: pyExpected,
          })
        }

        const pct = fixtures.length > 0 ? exactCount / fixtures.length : 0
        console.log(`  ${combo.label}: ${exactCount}/${fixtures.length} exact matches (${(pct * 100).toFixed(0)}%)`)
        expect(pct).toBeGreaterThanOrEqual(0.05)
      }, 600000)
    })
  }

  // After all combos, print the consolidated report
  describe('Consolidated report', () => {
    it('prints cross-model parity table', () => {
      printReport(reportRows)
      expect(reportRows.length).toBeGreaterThan(0)
    })
  })
})
