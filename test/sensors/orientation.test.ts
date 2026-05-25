import { describe, it, expect } from 'vitest'
import { MockOrientationSource, createOrientationSource } from '@/sensors/orientation'

describe('MockOrientationSource', () => {
  it('starts and produces heading values', async () => {
    const source = new MockOrientationSource(0)
    await source.start()
    expect(source.watching).toBe(true)
    expect(source.heading).toBe(0)

    await new Promise(r => setTimeout(r, 250))
    expect(source.heading).toBeGreaterThan(0)

    source.stop()
    expect(source.watching).toBe(false)
    expect(source.heading).toBeNull()
  })

  it('starts from given base heading', async () => {
    const source = new MockOrientationSource(45)
    await source.start()
    expect(source.heading).toBe(45)
    source.stop()
  })
})

describe('createOrientationSource', () => {
  it('returns a working source on desktop', () => {
    const orig = (globalThis as any).DeviceOrientationEvent
    ;(globalThis as any).DeviceOrientationEvent = undefined
    try {
      const source = createOrientationSource()
      expect(source).toBeInstanceOf(MockOrientationSource)
    } finally {
      ;(globalThis as any).DeviceOrientationEvent = orig
    }
  })

  it('returns DeviceOrientationSource when DeviceOrientationEvent exists (no requestPermission)', () => {
    // Simulate Android: DeviceOrientationEvent exists but no requestPermission
    const orig = (globalThis as any).DeviceOrientationEvent
    ;(globalThis as any).DeviceOrientationEvent = class {}
    try {
      const source = createOrientationSource()
      expect(source.constructor.name).toBe('DeviceOrientationSource')
    } finally {
      ;(globalThis as any).DeviceOrientationEvent = orig
    }
  })

  it('returns WebkitCompassSource when requestPermission exists (iOS)', () => {
    const orig = (globalThis as any).DeviceOrientationEvent
    ;(globalThis as any).DeviceOrientationEvent = class {
      static requestPermission() { return Promise.resolve('granted') }
    }
    try {
      const source = createOrientationSource()
      expect(source.constructor.name).toBe('WebkitCompassSource')
    } finally {
      ;(globalThis as any).DeviceOrientationEvent = orig
    }
  })
})
