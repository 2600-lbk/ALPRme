import type { LocationSource, LocationData } from '@/sensors/location'
import type { OrientationSource } from '@/sensors/orientation'
import { getWmm } from './wmm'

export function correctedHeading(rawDeg: number, declinationDeg: number): number {
  return ((rawDeg + declinationDeg) % 360 + 360) % 360
}

export interface CorrectedHeadingState {
  trueHeading: number | null
  rawHeading: number | null
  declination: number | null
  latitude: number | null
  longitude: number | null
  location: LocationData | null
}

export class CorrectedHeadingSource {
  private location: LocationSource
  private orientation: OrientationSource
  private wmm = getWmm()
  private orientationInterval: ReturnType<typeof setInterval> | null = null

  state: CorrectedHeadingState = {
    trueHeading: null,
    rawHeading: null,
    declination: null,
    latitude: null,
    longitude: null,
    location: null,
  }

  onChange: ((state: CorrectedHeadingState) => void) | null = null

  constructor(location: LocationSource, orientation: OrientationSource) {
    this.location = location
    this.orientation = orientation
  }

  async start(): Promise<void> {
    this.location.start()
    await this.orientation.start()

    this.orientationInterval = setInterval(() => {
      this.recompute()
    }, 200)

    this.recompute()
  }

  stop(): void {
    this.location.stop()
    this.orientation.stop()

    if (this.orientationInterval !== null) {
      clearInterval(this.orientationInterval)
      this.orientationInterval = null
    }
  }

  private recompute(): void {
    const raw = this.orientation.heading
    const loc = this.location.current

    this.state.rawHeading = raw
    this.state.latitude = loc?.latitude ?? null
    this.state.longitude = loc?.longitude ?? null
    this.state.location = loc

    if (raw !== null && loc) {
      const decl = this.wmm.declination(loc.latitude, loc.longitude)
      this.state.declination = decl
      this.state.trueHeading = correctedHeading(raw, decl)
    } else {
      this.state.declination = null
      this.state.trueHeading = null
    }

    this.onChange?.(this.state)
  }
}
