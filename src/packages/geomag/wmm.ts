import { magvar } from 'magvar'

export class Wmm {
  get declinationModel(): string { return 'WMM 2025-2030' }

  declination(lat: number, lon: number, _altKm = 0, _decimalYear?: number): number {
    return magvar(lat, lon)
  }
}

let cachedInstance: Wmm | null = null

export function getWmm(): Wmm {
  if (!cachedInstance) {
    cachedInstance = new Wmm()
  }
  return cachedInstance
}

export async function loadWmm(): Promise<Wmm> {
  return getWmm()
}
