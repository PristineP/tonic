import { HarmonySettings, defaultHarmonySettings } from '../theory/harmony'
import { FXParams, defaultFXParams } from '../dsp/effects'
import { VocoderParams, defaultVocoderParams } from '../dsp/vocoder'
import { DrumKit, BeatStyle } from '../dsp/drums'
import { ArpPattern, NoteRate, PerformStyle } from '../dsp/engineTypes'
import { EarTrainer } from '../training/earTrainer'

/** The device's play modes (mode key menu). */
export enum PlayMode {
  play,
  strum,
  lead,
  drone,
  arp,
  repeatGate,
  sequencer,
  drums,
  beat,
  chordRush,
  earTrainer,
  tuner,
  mic,
  vocoder,
  mixer,
}

export namespace PlayMode {
  export const allCases: PlayMode[] = [
    PlayMode.play, PlayMode.strum, PlayMode.lead, PlayMode.drone, PlayMode.arp, PlayMode.repeatGate,
    PlayMode.sequencer, PlayMode.drums, PlayMode.beat, PlayMode.chordRush, PlayMode.earTrainer,
    PlayMode.tuner, PlayMode.mic, PlayMode.vocoder, PlayMode.mixer,
  ]

  export function displayName(m: PlayMode): string {
    switch (m) {
      case PlayMode.play: return 'PLAY'
      case PlayMode.strum: return 'STRUM'
      case PlayMode.lead: return 'LEAD'
      case PlayMode.drone: return 'DRONE'
      case PlayMode.arp: return 'ARP'
      case PlayMode.repeatGate: return 'REPEAT'
      case PlayMode.sequencer: return 'SEQUENCER'
      case PlayMode.drums: return 'DRUMS'
      case PlayMode.beat: return 'BEAT'
      case PlayMode.chordRush: return 'CHORD RUSH'
      case PlayMode.earTrainer: return 'EAR TRAIN'
      case PlayMode.tuner: return 'TUNER'
      case PlayMode.mic: return 'MIC'
      case PlayMode.vocoder: return 'VOCODER'
      case PlayMode.mixer: return 'MIXER'
    }
  }

  export function shortName(m: PlayMode): string {
    switch (m) {
      case PlayMode.sequencer: return 'SEQ'
      case PlayMode.earTrainer: return 'EAR'
      case PlayMode.repeatGate: return 'RPT'
      case PlayMode.chordRush: return 'RUSH'
      case PlayMode.vocoder: return 'VOC'
      default: return displayName(m)
    }
  }

  /** Modes where the seven buttons play chords. */
  export function playsChords(m: PlayMode): boolean {
    switch (m) {
      case PlayMode.play: case PlayMode.strum: case PlayMode.drone: case PlayMode.arp:
      case PlayMode.repeatGate: case PlayMode.sequencer: case PlayMode.vocoder:
        return true
      default:
        return false
    }
  }

  export function engineStyle(m: PlayMode): PerformStyle {
    switch (m) {
      case PlayMode.strum: return PerformStyle.strum
      case PlayMode.drone: return PerformStyle.drone
      case PlayMode.arp: return PerformStyle.arp
      case PlayMode.repeatGate: return PerformStyle.repeatGate
      default: return PerformStyle.chord
    }
  }

  /** Whether the mode can use the microphone (the vocoder only with its mic source). */
  export function usesMicrophone(m: PlayMode): boolean {
    return m === PlayMode.tuner || m === PlayMode.mic || m === PlayMode.vocoder
  }
}

/** Everything the user can set, persisted between launches. */
export interface DeviceSettings {
  harmony: HarmonySettings
  soundName: string
  fx: FXParams
  /** Multipliers applied to the preset's attack and release. */
  attackScale: number
  releaseScale: number
  mode: PlayMode
  bpm: number
  arpPattern: ArpPattern
  arpRate: NoteRate
  arpLatch: boolean
  repeatRate: NoteRate
  strumMs: number
  kit: DrumKit
  beatStyle: BeatStyle
  beatVariation: number
  /** Beats per sequencer step. */
  seqStepBeats: number
  /** 0 = free, otherwise 1, 2, 4 or 8 bars. */
  loopBars: number
  metronome: boolean
  earLevel: EarTrainer.Level
  leadGlide: number
  /** The wheel sweeps the low-pass filter instead of the volume. */
  filterWheel: boolean
  volume: number
  filter: number
  /** Hold one chord button and press another to put the second's root in the bass. */
  slashChords: boolean
  showScope: boolean
  showKeyLabels: boolean
  haptics: boolean
  vocoder: VocoderParams
  rushSong: number
  /** Best Chord Rush score per song. */
  rushBest: number[]
}

export function defaultDeviceSettings(): DeviceSettings {
  return {
    harmony: defaultHarmonySettings(),
    soundName: 'PIANO',
    fx: defaultFXParams(),
    attackScale: 1,
    releaseScale: 1,
    mode: PlayMode.play,
    bpm: 100,
    arpPattern: ArpPattern.up,
    arpRate: NoteRate.sixteenth,
    arpLatch: false,
    repeatRate: NoteRate.eighth,
    strumMs: 22,
    kit: DrumKit.tight,
    beatStyle: BeatStyle.rock,
    beatVariation: 0,
    seqStepBeats: 2,
    loopBars: 2,
    metronome: false,
    earLevel: EarTrainer.Level.notes,
    leadGlide: 0.06,
    filterWheel: false,
    volume: 0.75,
    filter: 1,
    slashChords: false,
    showScope: true,
    showKeyLabels: true,
    haptics: true,
    vocoder: defaultVocoderParams(),
    rushSong: 0,
    rushBest: [],
  }
}

export function copyDeviceSettings(s: DeviceSettings): DeviceSettings {
  return structuredClone(s)
}

/** Structural equality for plain JSON-like data. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Takes `value` when it has the same JSON shape as `fallback`; objects merge key by key. */
function tolerant<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) return fallback
    const sample = fallback[0]
    if (sample === undefined) return value.filter(v => typeof v === 'number') as T
    return value.filter(v => typeof v === typeof sample) as T
  }
  if (typeof fallback === 'object' && fallback !== null) {
    if (typeof value !== 'object' || Array.isArray(value)) return fallback
    const out: Record<string, unknown> = {}
    for (const [k, d] of Object.entries(fallback as Record<string, unknown>)) {
      out[k] = tolerant((value as Record<string, unknown>)[k], d)
    }
    return out as T
  }
  if (typeof value !== typeof fallback) return fallback
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback
  return value as T
}

/** Decodes saved settings tolerantly so settings saved by older versions still load. */
export function decodeDeviceSettings(json: unknown): DeviceSettings {
  const d = defaultDeviceSettings()
  let source = json
  if (typeof json === 'string') {
    try { source = JSON.parse(json) } catch { return d }
  }
  const s = tolerant(source, d)
  // Legacy keys from builds before the Chord Rush rename.
  if (source && typeof source === 'object') {
    const raw = source as Record<string, unknown>
  }
  const octs = s.harmony.buttonOctaves
  if (octs.length !== 7) s.harmony.buttonOctaves = Array.from({ length: 7 }, (_, i) => octs[i] ?? 0)
  return s
}
