export interface BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Detection {
  plate: string
  confidence: number
  charConfidences: number[]
  bbox: BoundingBox
  detectorConfidence: number
  region: string | null
  regionConfidence: number | null
}

export interface OcrConfig {
  max_plate_slots: number
  alphabet: string
  pad_char: string
  img_height: number
  img_width: number
  image_color_mode: 'rgb' | 'grayscale'
  keep_aspect_ratio?: boolean
  interpolation?: string
  padding_color?: [number, number, number]
  plate_regions?: string[]
}

export interface AlprInitOptions {
  detectorUrl: string
  ocrUrl: string
  ocrConfig: OcrConfig | string
  executionProviders?: Array<'webgpu' | 'webgl' | 'wasm'>
}

export function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  if (x2 <= x1 || y2 <= y1) return 0
  const intersection = (x2 - x1) * (y2 - y1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return intersection / (areaA + areaB - intersection)
}
