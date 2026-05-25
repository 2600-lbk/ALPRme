const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const MODELS = `${BASE}/models/`

export interface ModelEntry {
  key: string
  name: string
  path: string
  inputSize: string
  sizeMB: number
  description: string
}

export const STAGE1_MODELS: ModelEntry[] = [
  {
    key: 'yolo-v9-t-256',
    name: 'Small (YOLOv9-t 256)',
    path: `${MODELS}yolo-v9-t-256.onnx`,
    inputSize: '256×256',
    sizeMB: 7.4,
    description: 'Fastest. Best battery life. May miss small or distant plates.',
  },
  {
    key: 'yolo-v9-t-384',
    name: 'Medium (YOLOv9-t 384)',
    path: `${MODELS}yolo-v9-t-384.onnx`,
    inputSize: '384×384',
    sizeMB: 7.4,
    description: 'Default. Good balance of speed and accuracy for mobile.',
  },
  {
    key: 'yolo-v9-t-512',
    name: 'Large (YOLOv9-t 512)',
    path: `${MODELS}yolo-v9-t-512.onnx`,
    inputSize: '512×512',
    sizeMB: 7.4,
    description: 'Highest accuracy. Noticeably slower. Best for stationary use.',
  },
]

export const STAGE2_MODELS: ModelEntry[] = [
  {
    key: 'cct-xs-v2-global',
    name: 'Small (CCT XS v2)',
    path: `${MODELS}cct_xs_v2_global.onnx`,
    inputSize: '128×64',
    sizeMB: 3.2,
    description: 'Fastest OCR. Global Latin alphabet. 66-country region recognition.',
  },
  {
    key: 'cct-s-v2-global',
    name: 'Large (CCT S v2)',
    path: `${MODELS}cct_s_v2_global.onnx`,
    inputSize: '128×64',
    sizeMB: 5.0,
    description: 'Higher accuracy OCR. Global Latin alphabet. 66-country region recognition.',
  },
]

export const OCR_CONFIG_URLS: Record<string, string> = {
  'cct-xs-v2-global': `${MODELS}cct_v2_global_plate_config.json`,
  'cct-s-v2-global': `${MODELS}cct_v2_global_plate_config.json`,
}

export const DEFAULT_STAGE1_KEY = 'yolo-v9-t-384'
export const DEFAULT_STAGE2_KEY = 'cct-xs-v2-global'
