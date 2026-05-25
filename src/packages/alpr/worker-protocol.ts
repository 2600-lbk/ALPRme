export interface WorkerDetection {
  plate: string
  confidence: number
  charConfidences: number[]
  bbox: { x1: number; y1: number; x2: number; y2: number }
  detectorConfidence: number
  region: string | null
  regionConfidence: number | null
}

export interface InitRequest {
  type: 'init'
  id: number
  payload: {
    detectorUrl: string
    ocrUrl: string
    ocrConfigUrl: string
    backendPreference?: Array<'webgpu' | 'webgl' | 'wasm'>
  }
}

export interface PredictRequest {
  type: 'predict'
  id: number
  payload: {
    bitmap: ImageBitmap
  }
}

export interface PredictBatchRequest {
  type: 'predict-batch'
  id: number
  payload: {
    tiles: Array<{ tileId: string; bitmap: ImageBitmap }>
  }
}

export interface DisposeRequest {
  type: 'dispose'
  id: number
}

export type WorkerRequest = InitRequest | PredictRequest | PredictBatchRequest | DisposeRequest

export interface InitResponse {
  type: 'init'
  id: number
  ok: true
  backend: string
  detectorInputShape: [number, number, number, number]
  ocrInputShape: [number, number, number, number]
}

export interface PredictResponse {
  type: 'predict'
  id: number
  ok: true
  detections: WorkerDetection[]
}

export interface PredictBatchResponse {
  type: 'predict-batch'
  id: number
  ok: true
  results: Array<{ tileId: string; detections: WorkerDetection[] }>
}

export interface BusyResponse {
  type: 'predict' | 'predict-batch'
  id: number
  ok: false
  error: 'BUSY'
}

export interface ErrorResponse {
  type: 'error'
  id: number
  error: string
}

export type WorkerResponse =
  | InitResponse
  | PredictResponse
  | PredictBatchResponse
  | BusyResponse
  | { type: 'dispose'; id: number; ok: true }
  | ErrorResponse
