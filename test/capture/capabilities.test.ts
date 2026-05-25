import { describe, it, expect, vi } from 'vitest'
import { readCapabilities, applyProfile, buildInitialConstraints } from '@/capture/capabilities'
import { buildDefaultProfile, type CaptureProfile } from '@/capture/profile'

function mockTrack(caps: Record<string, unknown> | null, applyOk = true): MediaStreamTrack {
  const apply = vi.fn(async () => { if (!applyOk) throw new Error('apply failed') })
  return {
    getCapabilities: caps == null ? undefined : () => caps,
    applyConstraints: apply,
  } as unknown as MediaStreamTrack
}

describe('readCapabilities', () => {
  it('returns empty shape when track has no getCapabilities', () => {
    const t = mockTrack(null)
    const c = readCapabilities(t)
    expect(c.zoom).toBeNull()
    expect(c.torch).toBe(false)
    expect(c.focusModes).toEqual([])
    expect(c.resolution).toBeNull()
  })

  it('normalizes full capabilities', () => {
    const t = mockTrack({
      zoom: { min: 1, max: 5, step: 0.1 },
      focusMode: ['continuous', 'manual', 'single-shot'],
      focusDistance: { min: 0, max: 100, step: 1 },
      exposureMode: ['continuous', 'manual'],
      exposureCompensation: { min: -3, max: 3, step: 0.33 },
      whiteBalanceMode: ['auto', 'manual'],
      torch: true,
      width: { max: 3840 },
      height: { max: 2160 },
    })
    const c = readCapabilities(t)
    expect(c.zoom).toEqual({ min: 1, max: 5, step: 0.1 })
    expect(c.focusModes).toEqual(['continuous', 'manual', 'single-shot'])
    expect(c.exposureCompensation?.min).toBe(-3)
    expect(c.torch).toBe(true)
    expect(c.resolution).toEqual({ maxWidth: 3840, maxHeight: 2160 })
  })

  it('infers step when missing', () => {
    const t = mockTrack({ zoom: { min: 0, max: 10 } })
    const c = readCapabilities(t)
    expect(c.zoom?.step).toBeGreaterThan(0)
  })
})

describe('applyProfile', () => {
  function profileWith(overrides: Partial<CaptureProfile>): CaptureProfile {
    return { ...buildDefaultProfile(), ...overrides } as CaptureProfile
  }

  it('records warning when zoom requested but not supported', async () => {
    const t = mockTrack({})
    const r = await applyProfile(t, profileWith({ zoom: 2 }))
    expect(r.warnings.some(w => w.includes('zoom'))).toBe(true)
    expect(r.applied.zoom).toBeUndefined()
  })

  it('clamps zoom to capability range and applies', async () => {
    const t = mockTrack({ zoom: { min: 1, max: 4, step: 0.1 } })
    const r = await applyProfile(t, profileWith({ zoom: 99 }))
    expect(r.applied.zoom).toBe(4)
    expect((t.applyConstraints as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      advanced: [{ zoom: 4 }],
    })
  })

  it('only sets torch=true if supported', async () => {
    const t = mockTrack({})
    const r = await applyProfile(t, profileWith({ torch: true }))
    expect(r.warnings.some(w => w.includes('torch'))).toBe(true)
    expect(r.applied.torch).toBeUndefined()
  })

  it('applies torch=true when supported', async () => {
    const t = mockTrack({ torch: true })
    const r = await applyProfile(t, profileWith({ torch: true }))
    expect(r.applied.torch).toBe(true)
  })

  it('rejects focusMode not in capability list', async () => {
    const t = mockTrack({ focusMode: ['continuous'] })
    const r = await applyProfile(t, profileWith({ focusMode: 'manual' }))
    expect(r.warnings.some(w => w.includes('focusMode'))).toBe(true)
  })

  it('captures applyConstraints rejection as a warning', async () => {
    const t = mockTrack({ zoom: { min: 1, max: 4, step: 0.1 } }, false)
    const r = await applyProfile(t, profileWith({ zoom: 2 }))
    expect(r.warnings.some(w => w.includes('applyConstraints failed'))).toBe(true)
  })
})

describe('buildInitialConstraints', () => {
  it('asks for 480p resolution by default', () => {
    const c = buildInitialConstraints(buildDefaultProfile() as CaptureProfile)
    expect(c.width).toEqual({ ideal: 640 })
    expect(c.height).toEqual({ ideal: 480 })
    expect(c.facingMode).toBe('environment')
  })

  it('honors explicit resolution', () => {
    const p = { ...buildDefaultProfile(), resolution: { width: 1280, height: 720 } } as CaptureProfile
    const c = buildInitialConstraints(p)
    expect(c.width).toEqual({ ideal: 1280 })
    expect(c.height).toEqual({ ideal: 720 })
  })

  it('uses deviceId when provided (takes precedence over facingMode)', () => {
    const p = { ...buildDefaultProfile(), deviceId: 'abc123' } as CaptureProfile
    const c = buildInitialConstraints(p)
    expect(c.deviceId).toEqual({ exact: 'abc123' })
    expect(c.facingMode).toBeUndefined()
  })

  it('honors profile.resolution literally regardless of captureMode', () => {
    // Resolution is independent of mode — the editor's "Snap to default" button
    // is the only thing that synthesizes a mode-specific value, and it writes
    // back into profile.resolution before this function runs.
    const p1 = { ...buildDefaultProfile(), captureMode: 'whole-frame' as const, resolution: 'max' as const } as CaptureProfile
    expect(buildInitialConstraints(p1).width).toEqual({ ideal: 3840 })

    const p2 = { ...buildDefaultProfile(), captureMode: 'tiled' as const, resolution: { width: 640, height: 480 } } as CaptureProfile
    expect(buildInitialConstraints(p2).width).toEqual({ ideal: 640 })
  })
})
