import { ref, computed, onUnmounted, type Ref, type ComputedRef } from 'vue'
import { createOrientationSource, type OrientationSource } from '@/sensors/orientation'
import { GeolocationSource, MockLocationSource, type LocationSource } from '@/sensors/location'
import { CorrectedHeadingSource, type CorrectedHeadingState } from '@/packages/geomag/heading'

export interface UseSensorsReturn {
  headingState: Ref<CorrectedHeadingState>
  hasLocation: Ref<boolean>
  hasOrientation: Ref<boolean>
  needsPermission: ComputedRef<boolean>
  permissionError: Ref<string | null>
  enableSensors: () => Promise<void>
  stop: () => void
}

function needsIosPermission(): boolean {
  return typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as any).requestPermission === 'function'
}

export function useSensors(): UseSensorsReturn {
  const headingState = ref<CorrectedHeadingState>({
    trueHeading: null,
    rawHeading: null,
    declination: null,
    latitude: null,
    longitude: null,
    location: null,
  })

  const hasLocation = ref(false)
  const hasOrientation = ref(false)
  const permissionError = ref<string | null>(null)
  const needsPermission = computed(() => needsIosPermission())

  let locationSource: LocationSource | null = null
  let orientationSource: OrientationSource | null = null
  let correctedSource: CorrectedHeadingSource | null = null

  /**
   * Start any sensors that aren't already running. Safe to call multiple times.
   *
   * Geolocation: starts immediately on first call. No user gesture required on
   * any platform (the browser shows the OS permission prompt itself).
   *
   * Orientation: created immediately so the corrected-heading source always has
   * a source to read from (location data flows even if the heading is null).
   * On iOS Safari `DeviceOrientationEvent.requestPermission()` must run inside a
   * user gesture; we attempt it here, and if it throws (no gesture) or returns
   * denied we leave hasOrientation=false so the UI shows the "Enable Sensors"
   * prompt. Tapping the button calls enableSensors() again with a fresh gesture.
   * On Android/desktop there is no permission gate.
   *
   * This split lets AppShell call enableSensors() once on mount — Android gets
   * everything live immediately; iOS gets location live and orientation deferred
   * to the explicit prompt.
   */
  async function enableSensors(): Promise<void> {
    // ─── Geolocation (idempotent) ──────────────────────────────────────────
    if (!locationSource) {
      locationSource = navigator.geolocation
        ? new GeolocationSource()
        : new MockLocationSource([
            { lat: 37.7749, lon: -122.4194 },
            { lat: 40.7128, lon: -74.006 },
            { lat: 51.5074, lon: -0.1278 },
          ])
      locationSource.start()
    }
    hasLocation.value = locationSource.current !== null || locationSource.error === null

    // ─── Orientation source: create on first call regardless of perm state ─
    // The factory returns a real source for the platform. On iOS the listener
    // is attached but will not fire until perm is granted; on Android it just
    // works.
    if (!orientationSource) {
      orientationSource = createOrientationSource()
    }

    // ─── Try to enable the listener ────────────────────────────────────────
    if (!hasOrientation.value) {
      permissionError.value = null

      if (needsIosPermission()) {
        try {
          const perm = await (DeviceOrientationEvent as any).requestPermission()
          if (perm !== 'granted') {
            permissionError.value = 'Motion & Orientation permission denied'
          } else {
            await orientationSource.start()
            hasOrientation.value = true
          }
        } catch {
          // Called outside a user gesture (e.g. from onMounted). Leave the
          // prompt visible; a button-tap call will retry with a gesture.
        }
      } else {
        try {
          await orientationSource.start()
          hasOrientation.value = true
        } catch {
          hasOrientation.value = false
        }
      }
    }

    // ─── Corrected-heading source: created once both child sources exist ───
    // location alone is enough to start emitting state — trueHeading stays null
    // until orientation arrives, but lat/lon/speed etc. flow through.
    if (!correctedSource && locationSource && orientationSource) {
      correctedSource = new CorrectedHeadingSource(locationSource, orientationSource)
      correctedSource.onChange = (state) => {
        headingState.value = { ...state }
        hasLocation.value = state.location !== null
      }
      await correctedSource.start()
    }
  }

  function stop(): void {
    correctedSource?.stop()
    locationSource?.stop()
    orientationSource?.stop()

    correctedSource = null
    locationSource = null
    orientationSource = null

    hasLocation.value = false
    hasOrientation.value = false
  }

  onUnmounted(() => stop())

  return { headingState, hasLocation, hasOrientation, needsPermission, permissionError, enableSensors, stop }
}
