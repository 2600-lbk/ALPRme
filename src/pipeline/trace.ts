export type DecisionStage = 'prefilter' | 'stabilizer' | 'motion' | 'dedup'
export type DecisionVerdict = 'pass' | 'suppress' | 'emit' | 'hold'

export interface DecisionEntry {
  stage: DecisionStage
  verdict: DecisionVerdict
  reason: string
  threshold?: number
  value?: number
}

export type DecisionTrace = DecisionEntry[]

export function pass(stage: DecisionStage, reason: string, value?: number, threshold?: number): DecisionEntry {
  return { stage, verdict: 'pass', reason, value, threshold }
}

export function suppress(stage: DecisionStage, reason: string, value?: number, threshold?: number): DecisionEntry {
  return { stage, verdict: 'suppress', reason, value, threshold }
}

export function emit(stage: DecisionStage, reason: string): DecisionEntry {
  return { stage, verdict: 'emit', reason }
}

export function hold(stage: DecisionStage, reason: string, value?: number, threshold?: number): DecisionEntry {
  return { stage, verdict: 'hold', reason, value, threshold }
}
