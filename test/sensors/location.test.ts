import { describe, it, expect } from 'vitest'
import { GeolocationSource, MockLocationSource } from '@/sensors/location'

describe('GeolocationSource', () => {
  it('reports error when geolocation is not available', () => {
    const source = new GeolocationSource()
    source.start()
    expect(source.error).toBe('Geolocation not available')
    expect(source.watching).toBe(false)
  })
})

describe('MockLocationSource', () => {
  it('replays points on interval', async () => {
    const source = new MockLocationSource([
      { lat: 51.5, lon: -0.1 },
      { lat: 48.8, lon: 2.3 },
    ])
    source.start()
    expect(source.watching).toBe(true)

    await new Promise(r => setTimeout(r, 100))
    expect(source.current?.latitude).toBe(51.5)

    await new Promise(r => setTimeout(r, 1000))
    expect(source.current?.latitude).toBe(48.8)

    source.stop()
    expect(source.watching).toBe(false)
    expect(source.current).toBeNull()
  })

  it('does nothing with empty points', () => {
    const source = new MockLocationSource([])
    source.start()
    expect(source.watching).toBe(false)
  })

  it('loops through points', async () => {
    const source = new MockLocationSource([{ lat: 10, lon: 20 }])
    source.start()
    await new Promise(r => setTimeout(r, 100))
    expect(source.current?.latitude).toBe(10)
    await new Promise(r => setTimeout(r, 1000))
    expect(source.current?.latitude).toBe(10)
    source.stop()
  })
})
