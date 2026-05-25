import { ref, onUnmounted, type Ref } from 'vue'
import type { CaptureProfile } from '@/capture/profile'
import {
  readCapabilities,
  applyProfile as applyProfileToTrack,
  buildInitialConstraints,
  EMPTY_CAPABILITIES,
  type CameraCapabilities,
} from '@/capture/capabilities'

export interface UseCameraReturn {
  stream: Ref<MediaStream | null>
  videoRef: Ref<HTMLVideoElement | null>
  error: Ref<string | null>
  devices: Ref<MediaDeviceInfo[]>
  activeDeviceId: Ref<string | null>
  capabilities: Ref<CameraCapabilities>
  /** Actual resolution negotiated with the camera (from track.getSettings). */
  settings: Ref<{ width: number; height: number } | null>
  start: (profile: CaptureProfile) => Promise<void>
  stop: () => void
  resume: () => Promise<void>
  enumerate: () => Promise<void>
  applyProfile: (profile: CaptureProfile) => Promise<{ warnings: string[] }>
}

/**
 * Drives the camera via getUserMedia, with per-track capability discovery
 * (`getCapabilities`) and per-frame control (`applyConstraints` for zoom,
 * torch, focus, exposure, white balance). The active CaptureProfile drives
 * the constraints; capabilities reflect what the device actually supports so
 * the UI can render only the relevant controls.
 *
 * `resume()` re-attaches the existing stream to the video element after the
 * component returns from a keep-alive cache (DOM detach drops srcObject and
 * pauses playback).
 */
export function useCamera(): UseCameraReturn {
  const stream = ref<MediaStream | null>(null)
  const videoRef = ref<HTMLVideoElement | null>(null)
  const error = ref<string | null>(null)
  const devices = ref<MediaDeviceInfo[]>([])
  const activeDeviceId = ref<string | null>(null)
  const capabilities = ref<CameraCapabilities>(EMPTY_CAPABILITIES)
  const settings = ref<{ width: number; height: number } | null>(null)
  let activeProfile: CaptureProfile | null = null

  async function enumerate(): Promise<void> {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      devices.value = allDevices.filter(d => d.kind === 'videoinput')
    } catch {
      devices.value = []
    }
  }

  async function start(profile: CaptureProfile): Promise<void> {
    if (stream.value) stop()

    error.value = null
    activeProfile = profile

    try {
      const constraints: MediaStreamConstraints = {
        video: buildInitialConstraints(profile),
        audio: false,
      }
      stream.value = await navigator.mediaDevices.getUserMedia(constraints)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      stream.value = null
      return
    }

    const track = stream.value.getVideoTracks()[0]
    if (track) {
      const settingsNow = track.getSettings()
      activeDeviceId.value = settingsNow.deviceId ?? null
      if (typeof settingsNow.width === 'number' && typeof settingsNow.height === 'number') {
        settings.value = { width: settingsNow.width, height: settingsNow.height }
      }
      capabilities.value = readCapabilities(track)
      // Apply per-capability controls (zoom, torch, focus, …). Warnings are
      // swallowed here; the profile editor surfaces them via its own
      // applyProfile call.
      await applyProfileToTrack(track, profile, capabilities.value).catch(() => {})
    }

    if (videoRef.value && stream.value) {
      videoRef.value.srcObject = stream.value
      try { await videoRef.value.play() } catch { /* gesture-restriction; ignore */ }
    }

    await enumerate()
  }

  function stop(): void {
    if (stream.value) {
      stream.value.getTracks().forEach(t => t.stop())
      stream.value = null
    }
    if (videoRef.value) {
      videoRef.value.srcObject = null
    }
    activeDeviceId.value = null
    capabilities.value = EMPTY_CAPABILITIES
    settings.value = null
  }

  /**
   * Re-attach an existing stream to the video element (the DOM was detached
   * while AppShell was in the keep-alive cache). If the underlying tracks
   * have died, fall back to a full start() using the last profile.
   */
  async function resume(): Promise<void> {
    const tracksAlive = stream.value
      ? stream.value.getVideoTracks().some(t => t.readyState === 'live')
      : false

    if (!tracksAlive) {
      if (activeProfile) await start(activeProfile)
      return
    }
    if (videoRef.value) {
      if (videoRef.value.srcObject !== stream.value) {
        videoRef.value.srcObject = stream.value
      }
      try { await videoRef.value.play() } catch { /* gesture-restriction; ignore */ }
    }

    // Some Android cameras advertise different capability ranges after rotate;
    // re-read so the UI stays accurate.
    const track = stream.value?.getVideoTracks()[0]
    if (track) capabilities.value = readCapabilities(track)
  }

  async function applyProfile(profile: CaptureProfile): Promise<{ warnings: string[] }> {
    activeProfile = profile
    const track = stream.value?.getVideoTracks()[0]
    if (!track) return { warnings: ['no active camera track'] }

    // If the profile demands a different resolution or device, a hot apply is
    // not enough — restart the stream.
    const wantDeviceId = profile.deviceId
    if (wantDeviceId && wantDeviceId !== activeDeviceId.value) {
      await start(profile)
      return { warnings: [] }
    }

    const settingsNow = track.getSettings()
    const wantedRes = profile.resolution
    if (wantedRes !== 'max' && settingsNow.width && settingsNow.height) {
      if (settingsNow.width !== wantedRes.width || settingsNow.height !== wantedRes.height) {
        // Try a soft constraint first; fall back to restart if the camera refuses.
        try {
          await track.applyConstraints({ width: { ideal: wantedRes.width }, height: { ideal: wantedRes.height } })
          const after = track.getSettings()
          if (after.width !== wantedRes.width || after.height !== wantedRes.height) {
            await start(profile)
            return { warnings: [] }
          }
          if (typeof after.width === 'number' && typeof after.height === 'number') {
            settings.value = { width: after.width, height: after.height }
          }
        } catch {
          await start(profile)
          return { warnings: [] }
        }
      }
    }

    const result = await applyProfileToTrack(track, profile, capabilities.value)
    return { warnings: result.warnings }
  }

  onUnmounted(() => stop())

  return {
    stream,
    videoRef,
    error,
    devices,
    activeDeviceId,
    capabilities,
    settings,
    start,
    stop,
    resume,
    enumerate,
    applyProfile,
  }
}
