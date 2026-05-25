export interface OrientationSource {
  readonly heading: number | null
  readonly absolute: boolean
  readonly error: string | null
  readonly watching: boolean
  start(): Promise<void>
  stop(): void
}

export class DeviceOrientationSource implements OrientationSource {
  heading: number | null = null
  absolute = false
  error: string | null = null
  watching = false
  private handler: ((e: DeviceOrientationEvent) => void) | null = null

  async start(): Promise<void> {
    if (this.watching) return
    this.watching = true
    this.error = null

    this.handler = (event: DeviceOrientationEvent) => {
      if (event.alpha !== null) {
        const screenAngle = screen.orientation?.angle ?? 0
        this.heading = ((event.alpha + screenAngle) % 360 + 360) % 360
        this.absolute = event.absolute
      }
    }

    window.addEventListener('deviceorientation', this.handler)
  }

  stop(): void {
    if (this.handler) {
      window.removeEventListener('deviceorientation', this.handler)
      this.handler = null
    }
    this.watching = false
    this.heading = null
  }
}

export class WebkitCompassSource implements OrientationSource {
  heading: number | null = null
  absolute = true
  error: string | null = null
  watching = false
  private handler: ((e: DeviceOrientationEvent) => void) | null = null

  async start(): Promise<void> {
    if (this.watching) return
    this.watching = true
    this.error = null

    this.handler = (event: DeviceOrientationEvent) => {
      if ((event as any).webkitCompassHeading !== undefined) {
        this.heading = (event as any).webkitCompassHeading
        this.absolute = true
      }
    }

    window.addEventListener('deviceorientation', this.handler)
  }

  stop(): void {
    if (this.handler) {
      window.removeEventListener('deviceorientation', this.handler)
      this.handler = null
    }
    this.watching = false
    this.heading = null
  }
}

export class MockOrientationSource implements OrientationSource {
  heading: number | null = null
  absolute = true
  error: string | null = null
  watching = false
  private interval: ReturnType<typeof setInterval> | null = null
  private baseHeading: number

  constructor(baseHeading = 0) {
    this.baseHeading = baseHeading
  }

  async start(): Promise<void> {
    if (this.watching) return
    this.watching = true
    this.heading = this.baseHeading

    this.interval = setInterval(() => {
      this.heading = ((this.heading ?? this.baseHeading) + 1.5) % 360
    }, 200)
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.watching = false
    this.heading = null
  }
}

export function createOrientationSource(): OrientationSource {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
    return new WebkitCompassSource()
  }
  if (typeof DeviceOrientationEvent !== 'undefined') {
    return new DeviceOrientationSource()
  }
  return new MockOrientationSource()
}
