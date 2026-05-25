import type { CaptureProfile } from './profile'

export interface RangeCapability {
  min: number
  max: number
  step: number
}

/**
 * Normalized snapshot of what `track.getCapabilities()` reports. Every field
 * is nullable so the UI can render only the controls the device actually
 * supports (iOS Safari 17+ commonly exposes zoom + torch; Android Chrome adds
 * focus, exposure, white balance).
 */
export interface CameraCapabilities {
  zoom: RangeCapability | null
  focusModes: string[]
  focusDistance: RangeCapability | null
  exposureModes: string[]
  exposureCompensation: RangeCapability | null
  whiteBalanceModes: string[]
  torch: boolean
  resolution: { maxWidth: number; maxHeight: number } | null
}

export const EMPTY_CAPABILITIES: CameraCapabilities = {
  zoom: null,
  focusModes: [],
  focusDistance: null,
  exposureModes: [],
  exposureCompensation: null,
  whiteBalanceModes: [],
  torch: false,
  resolution: null,
}

function range(raw: unknown): RangeCapability | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { min?: number; max?: number; step?: number }
  if (typeof r.min !== 'number' || typeof r.max !== 'number') return null
  return {
    min: r.min,
    max: r.max,
    step: typeof r.step === 'number' && r.step > 0 ? r.step : (r.max - r.min) / 100,
  }
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

/** Normalize a track's capabilities into our shape, tolerating browser variance. */
export function readCapabilities(track: MediaStreamTrack): CameraCapabilities {
  const caps = typeof track.getCapabilities === 'function'
    ? (track.getCapabilities() as Record<string, unknown>)
    : {}

  const maxW = (caps.width as { max?: number } | undefined)?.max
  const maxH = (caps.height as { max?: number } | undefined)?.max

  return {
    zoom: range(caps.zoom),
    focusModes: stringArray(caps.focusMode),
    focusDistance: range(caps.focusDistance),
    exposureModes: stringArray(caps.exposureMode),
    exposureCompensation: range(caps.exposureCompensation),
    whiteBalanceModes: stringArray(caps.whiteBalanceMode),
    torch: caps.torch === true,
    resolution: typeof maxW === 'number' && typeof maxH === 'number'
      ? { maxWidth: maxW, maxHeight: maxH }
      : null,
  }
}

export interface ApplyResult {
  applied: Partial<CaptureProfile>
  warnings: string[]
}

/**
 * Apply the profile's camera fields to a live MediaStreamTrack via
 * `applyConstraints`. Fields the device doesn't support are silently skipped
 * and recorded as warnings. Returns the subset that actually applied so the
 * caller can reconcile its in-memory profile with reality.
 */
export async function applyProfile(
  track: MediaStreamTrack,
  profile: CaptureProfile,
  caps: CameraCapabilities = readCapabilities(track),
): Promise<ApplyResult> {
  const advanced: Record<string, unknown> = {}
  const applied: Partial<CaptureProfile> = {}
  const warnings: string[] = []

  if (profile.zoom != null) {
    if (caps.zoom) {
      const clamped = Math.min(caps.zoom.max, Math.max(caps.zoom.min, profile.zoom))
      advanced.zoom = clamped
      applied.zoom = clamped
    } else {
      warnings.push('zoom not supported')
    }
  }

  if (profile.torch) {
    if (caps.torch) {
      advanced.torch = true
      applied.torch = true
    } else {
      warnings.push('torch not supported')
    }
  } else if (caps.torch) {
    // Explicitly turn torch off when supported and the profile wants it off.
    advanced.torch = false
    applied.torch = false
  }

  if (profile.focusMode) {
    if (caps.focusModes.includes(profile.focusMode)) {
      advanced.focusMode = profile.focusMode
      applied.focusMode = profile.focusMode
    } else {
      warnings.push(`focusMode '${profile.focusMode}' not supported`)
    }
  }

  if (profile.focusDistance != null) {
    if (caps.focusDistance) {
      const clamped = Math.min(caps.focusDistance.max, Math.max(caps.focusDistance.min, profile.focusDistance))
      advanced.focusDistance = clamped
      applied.focusDistance = clamped
    } else {
      warnings.push('focusDistance not supported')
    }
  }

  if (profile.exposureMode) {
    if (caps.exposureModes.includes(profile.exposureMode)) {
      advanced.exposureMode = profile.exposureMode
      applied.exposureMode = profile.exposureMode
    } else {
      warnings.push(`exposureMode '${profile.exposureMode}' not supported`)
    }
  }

  if (profile.exposureCompensation != null) {
    if (caps.exposureCompensation) {
      const clamped = Math.min(
        caps.exposureCompensation.max,
        Math.max(caps.exposureCompensation.min, profile.exposureCompensation),
      )
      advanced.exposureCompensation = clamped
      applied.exposureCompensation = clamped
    } else {
      warnings.push('exposureCompensation not supported')
    }
  }

  if (profile.whiteBalanceMode) {
    if (caps.whiteBalanceModes.includes(profile.whiteBalanceMode)) {
      advanced.whiteBalanceMode = profile.whiteBalanceMode
      applied.whiteBalanceMode = profile.whiteBalanceMode
    } else {
      warnings.push(`whiteBalanceMode '${profile.whiteBalanceMode}' not supported`)
    }
  }

  if (Object.keys(advanced).length > 0) {
    try {
      // `advanced` is the standard place for per-capability constraints.
      await track.applyConstraints({ advanced: [advanced] as MediaTrackConstraintSet[] })
    } catch (e) {
      warnings.push(`applyConstraints failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { applied, warnings }
}

/**
 * Build a `MediaTrackConstraints` block from the profile's camera intent —
 * used at `getUserMedia` time. Subset of fields that *must* be set before the
 * stream is opened (resolution, facingMode, deviceId).
 */
export function buildInitialConstraints(profile: CaptureProfile): MediaTrackConstraints {
  const out: MediaTrackConstraints = {}

  if (profile.deviceId) {
    out.deviceId = { exact: profile.deviceId }
  } else if (profile.facingMode) {
    out.facingMode = profile.facingMode
  }

  if (profile.resolution === 'max') {
    // Encourage the largest stream the device will deliver; the actual
    // negotiated size is read back from track.getSettings() afterwards.
    out.width = { ideal: 3840 }
    out.height = { ideal: 2160 }
  } else {
    out.width = { ideal: profile.resolution.width }
    out.height = { ideal: profile.resolution.height }
  }

  return out
}
