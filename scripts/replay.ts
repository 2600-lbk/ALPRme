/**
 * Offline pipeline replay tool.
 *
 * Reads an exported session CSV (from the in-app "CSV" export) or GeoJSON and runs
 * each detection back through the filtering Pipeline with a chosen preset (or custom
 * params). Writes a report CSV showing what would happen now vs what was stored
 * originally — letting you tune heuristics against field-collected data.
 *
 * Usage:
 *   npx vite-node scripts/replay.ts -- --in session-3.csv --preset balanced --out report.csv
 *
 * If `--preset` is omitted, defaults to 'balanced'.
 * If `--out` is omitted, prints to stdout.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Pipeline, type PipelineParams } from '../src/pipeline'
import { FILTER_PRESETS, type FilterPreset } from '../src/pipeline/presets'
import type { Detection } from '../src/storage/dedup'

interface CliArgs {
  in: string
  out: string | null
  preset: FilterPreset
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = { preset: 'balanced', out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--in') args.in = argv[++i]
    else if (a === '--out') args.out = argv[++i] ?? null
    else if (a === '--preset') args.preset = argv[++i] as FilterPreset
  }
  if (!args.in) {
    throw new Error('Required: --in <path>')
  }
  if (!FILTER_PRESETS[args.preset!]) {
    throw new Error(`Unknown preset: ${args.preset}. Use one of: ${Object.keys(FILTER_PRESETS).join(', ')}`)
  }
  return args as CliArgs
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0)
  const headers = parseCsvLine(lines[0]!)
  const rows = lines.slice(1).map(parseCsvLine)
  return { headers, rows }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = false
      } else cur += c
    } else {
      if (c === ',') { out.push(cur); cur = '' }
      else if (c === '"') inQuote = true
      else cur += c
    }
  }
  out.push(cur)
  return out
}

function csvField(value: unknown): string {
  const s = String(value ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

interface ReplayRow {
  originalSuppressed: boolean
  plate: string
  timestamp: number
  newVerdict: 'emit' | 'update' | 'suppress'
  newTrace: string
  diff: 'agree' | 'now-emit' | 'now-suppress'
}

function loadDetectionsFromCsv(path: string): { dets: Detection[]; originalSuppressed: boolean[] } {
  const text = readFileSync(path, 'utf8')
  const { headers, rows } = parseCsv(text)
  const col = (name: string): number => {
    const i = headers.indexOf(name)
    if (i < 0) throw new Error(`CSV missing column: ${name}`)
    return i
  }
  const cPlate = col('plate')
  const cConf = col('confidence')
  const cCharConf = col('confidence_per_char')
  const cDetConf = col('detectorConfidence')
  const cX1 = col('bbox_x1'), cY1 = col('bbox_y1'), cX2 = col('bbox_x2'), cY2 = col('bbox_y2')
  const cLat = col('latitude'), cLon = col('longitude')
  const cHeading = col('heading'), cSpeed = col('speed_kmh'), cAlt = col('altitude_m')
  const cRegion = col('region'), cRegConf = col('regionConfidence')
  const cTs = col('timestamp')
  const cSup = headers.indexOf('suppressed')

  const dets: Detection[] = []
  const originalSuppressed: boolean[] = []
  for (const r of rows) {
    if (r.length < headers.length) continue
    dets.push({
      plate: r[cPlate]!,
      confidence: Number(r[cConf]),
      charConfidences: r[cCharConf]!.split(/\s+/).filter(Boolean).map(Number),
      bbox: { x1: Number(r[cX1]), y1: Number(r[cY1]), x2: Number(r[cX2]), y2: Number(r[cY2]) },
      detectorConfidence: Number(r[cDetConf]),
      latitude: r[cLat] === '' ? null : Number(r[cLat]),
      longitude: r[cLon] === '' ? null : Number(r[cLon]),
      heading: r[cHeading] === '' ? null : Number(r[cHeading]),
      speedKph: r[cSpeed] === '' ? null : Number(r[cSpeed]),
      altitudeM: r[cAlt] === '' ? null : Number(r[cAlt]),
      region: r[cRegion] === '' ? null : r[cRegion]!,
      regionConfidence: r[cRegConf] === '' ? null : Number(r[cRegConf]),
      timestamp: Number(r[cTs]),
    })
    originalSuppressed.push(cSup >= 0 ? r[cSup] === '1' : false)
  }
  return { dets, originalSuppressed }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const params: PipelineParams = FILTER_PRESETS[args.preset]
  const pipeline = new Pipeline(params)

  const path = resolve(args.in)
  if (!path.toLowerCase().endsWith('.csv')) {
    throw new Error('Only CSV input is supported in this version. Use the in-app CSV export.')
  }

  const { dets, originalSuppressed } = loadDetectionsFromCsv(path)
  // Replay must run chronologically for stabilizer/dedup state to be meaningful.
  const ordered = dets
    .map((d, i) => ({ d, originalSuppressed: originalSuppressed[i]! }))
    .sort((a, b) => a.d.timestamp - b.d.timestamp)

  const reportRows: ReplayRow[] = []
  let counts = { agree: 0, nowEmit: 0, nowSuppress: 0 }
  for (const { d, originalSuppressed: was } of ordered) {
    const r = pipeline.process(d)
    const newSup = r.verdict === 'suppress'
    const diff: ReplayRow['diff'] = was === newSup ? 'agree' : (newSup ? 'now-suppress' : 'now-emit')
    if (diff === 'agree') counts.agree++
    else if (diff === 'now-emit') counts.nowEmit++
    else counts.nowSuppress++
    reportRows.push({
      originalSuppressed: was,
      plate: d.plate,
      timestamp: d.timestamp,
      newVerdict: r.verdict,
      newTrace: JSON.stringify(r.trace),
      diff,
    })
  }

  const header = ['plate', 'timestamp', 'original_suppressed', 'new_verdict', 'diff', 'new_trace']
  const lines = [
    header.join(','),
    ...reportRows.map(r => [
      csvField(r.plate),
      r.timestamp,
      r.originalSuppressed ? '1' : '0',
      r.newVerdict,
      r.diff,
      csvField(r.newTrace),
    ].join(',')),
  ]

  const output = lines.join('\n')

  if (args.out) {
    writeFileSync(resolve(args.out), output)
    process.stderr.write(`Wrote ${reportRows.length} rows to ${args.out}\n`)
  } else {
    process.stdout.write(output + '\n')
  }
  process.stderr.write(
    `Summary: ${counts.agree} agree, ${counts.nowEmit} now-emit (was suppressed), ${counts.nowSuppress} now-suppress (was emitted)\n`,
  )
}

main()
