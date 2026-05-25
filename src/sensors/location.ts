export interface LocationData {
  latitude: number
  longitude: number
  altitude: number | null
  accuracy: number
  altitudeAccuracy: number | null
  heading: number | null
  speed: number | null
  timestamp: number
}

export interface LocationSource {
  readonly current: LocationData | null
  readonly error: string | null
  readonly watching: boolean
  start(): void
  stop(): void
}

export class GeolocationSource implements LocationSource {
  current: LocationData | null = null
  error: string | null = null
  watching = false
  private watchId: number | null = null

  start(): void {
    if (this.watching) return
    if (!navigator.geolocation) {
      this.error = 'Geolocation not available'
      return
    }

    this.watching = true
    this.error = null

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.current = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude,
          accuracy: pos.coords.accuracy,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        }
        this.error = null
      },
      (err) => {
        this.error = err.message
        this.current = null
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      },
    )
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }
    this.watching = false
    this.current = null
  }
}

export class MockLocationSource implements LocationSource {
  current: LocationData | null = null
  error: string | null = null
  watching = false
  private interval: ReturnType<typeof setInterval> | null = null
  private index = 0
  private points: Array<{ lat: number; lon: number }>

  constructor(points: Array<{ lat: number; lon: number }> = []) {
    this.points = points
  }

  start(): void {
    if (this.watching || this.points.length === 0) return
    this.watching = true
    this.index = 0
    this.emitCurrent()
    this.index++
    this.interval = setInterval(() => {
      this.emitCurrent()
      this.index++
    }, 1000)
  }

  private emitCurrent(): void {
    if (this.points.length === 0) return
    const pt = this.points[this.index % this.points.length]!
    this.current = {
      latitude: pt.lat,
      longitude: pt.lon,
      altitude: 0,
      accuracy: 5,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    }
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.watching = false
    this.current = null
  }

  addPoint(lat: number, lon: number): void {
    this.points.push({ lat, lon })
  }
}
