// localStorage persistence (best effort: private windows may refuse storage).
import { decodeDeviceSettings, defaultDeviceSettings, type DeviceSettings } from '../core/device/deviceSettings'

const SETTINGS = 'tonic.settings.v1'
const PRESETS = 'tonic.presets.v1'
const SAMPLE = 'tonic.sample.v1'
const PREFS = 'tonic.prefs.v1'

function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable or full */
  }
}

export function loadSettings(): DeviceSettings {
  const raw = get(SETTINGS)
  if (!raw) return defaultDeviceSettings()
  try {
    return decodeDeviceSettings(JSON.parse(raw))
  } catch {
    return defaultDeviceSettings()
  }
}

export function saveSettings(s: DeviceSettings): void {
  set(SETTINGS, JSON.stringify(s))
}

export function loadPresets(): (DeviceSettings | null)[] {
  try {
    const p = JSON.parse(get(PRESETS) ?? 'null')
    if (Array.isArray(p) && p.length === 4) return p.map((x) => (x ? decodeDeviceSettings(x) : null))
  } catch {
    /* fall through */
  }
  return [null, null, null, null]
}

export function savePresets(p: (DeviceSettings | null)[]): void {
  set(PRESETS, JSON.stringify(p))
}

export interface Prefs {
  seenWelcome: boolean
  bigDisplay: boolean
  midiEnabled: boolean
  midiPort: string | null
}

export function loadPrefs(): Prefs {
  const d: Prefs = { seenWelcome: false, bigDisplay: true, midiEnabled: false, midiPort: null }
  try {
    return { ...d, ...JSON.parse(get(PREFS) ?? '{}') }
  } catch {
    return d
  }
}

export function savePrefs(p: Prefs): void {
  set(PREFS, JSON.stringify(p))
}

// The latest mic sample survives reloads (base64 of float32 PCM).
export function saveSample(samples: Float32Array, sampleRate: number, rootNote: number): void {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  set(SAMPLE, JSON.stringify({ sampleRate, rootNote, data: btoa(bin) }))
}

export function loadSample(): { samples: Float32Array; sampleRate: number; rootNote: number } | null {
  try {
    const raw = get(SAMPLE)
    if (!raw) return null
    const o = JSON.parse(raw)
    const bin = atob(o.data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const samples = new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
    if (!(o.sampleRate > 0) || !(o.rootNote >= 0 && o.rootNote <= 127)) return null
    return { samples, sampleRate: o.sampleRate, rootNote: o.rootNote }
  } catch {
    return null
  }
}
