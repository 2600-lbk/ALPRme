declare module 'magvar' {
  export function magvar(lat: number, lon: number): number
  export function calculateMagVar(lat: number, lon: number, altKm: number, decimalYear: number): number
  export function julianDaysNow(): number
}
