import type { FXParams } from './effects'
import type { SynthParams } from './synthParams'
import type { VocoderParams } from './vocoder'

/** Up to eight MIDI notes. Plain array so it survives postMessage. */
export type NoteSet = number[]
export const NOTE_SET_CAPACITY = 8

/** Builds a NoteSet, truncating to capacity and clamping to Int16 as Swift did. */
export function noteSet(notes: Iterable<number> = []): NoteSet {
  const out: number[] = []
  for (const n of notes) {
    if (out.length >= NOTE_SET_CAPACITY) break
    out.push(Math.max(-32768, Math.min(32767, Math.trunc(n))))
  }
  return out
}

export function noteSetEqual(a: NoteSet, b: NoteSet): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i])
}

/** How the engine turns a held chord into sound. */
export enum PerformStyle { chord, strum, drone, arp, repeatGate }

export enum ArpPattern { up, down, upDown, random, converge, upTwoOctaves }
export namespace ArpPattern {
  export const allCases: readonly ArpPattern[] = [0, 1, 2, 3, 4, 5]
  export function displayName(p: ArpPattern): string { return ['UP', 'DOWN', 'UP-DOWN', 'RANDOM', 'CONVERGE', 'UP 2 OCT'][p] }
}

export enum NoteRate { quarter, eighth, eighthTriplet, sixteenth, sixteenthTriplet, thirtySecond }
export namespace NoteRate {
  export const allCases: readonly NoteRate[] = [0, 1, 2, 3, 4, 5]
  export function displayName(r: NoteRate): string { return ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'][r] }
  export function stepsPerBeat(r: NoteRate): number { return [1, 2, 3, 4, 6, 8][r] }
}

/** Looper track states. */
export enum TrackState { empty, armed, recording, playing, muted }

/** Commands sent from the UI thread to the audio thread (structured-clone safe). */
export type EngineCommand =
  | { type: 'press'; id: number; notes: NoteSet; velocity: number }
  | { type: 'release'; id: number }
  | { type: 'releaseAll' }
  | { type: 'drum'; pad: number; velocity: number }
  | { type: 'style'; style: PerformStyle }
  | { type: 'patch'; params: SynthParams }
  | { type: 'fx'; params: FXParams }
  | { type: 'tempo'; bpm: number }
  | { type: 'arp'; pattern: ArpPattern; rate: NoteRate; latch: boolean }
  | { type: 'repeatRate'; rate: NoteRate }
  | { type: 'strumSpeed'; ms: number }
  | { type: 'kit'; kit: number }
  | { type: 'beat'; style: number; variation: number; on: boolean }
  | { type: 'seqStep'; index: number; notes: NoteSet }
  | { type: 'seqLength'; length: number }
  | { type: 'seqStepBeats'; beats: number }
  | { type: 'seqPlay'; on: boolean }
  | { type: 'loopRecord'; track: number }
  | { type: 'loopMute'; track: number; muted: boolean }
  | { type: 'loopLevel'; track: number; level: number }
  | { type: 'loopClear'; track: number }
  | { type: 'loopBars'; bars: number }
  | { type: 'transport'; playing: boolean }
  | { type: 'master'; volume: number; cutoff: number }
  | { type: 'metronome'; on: boolean }
  | { type: 'useSample'; slot: number; length: number; sourceRate: number; rootNote: number }
  /** Plays notes for a fixed time (ear trainer prompts, auditions). */
  | { type: 'preview'; notes: NoteSet; delay: number; duration: number }
  | { type: 'stopPreview' }
  | { type: 'drumRepeat'; pad: number; on: boolean }
  | { type: 'vocoder'; on: boolean; params: VocoderParams }

/** A MIDI message produced by the engine for MIDI output. */
export interface MIDIMessage {
  status: number
  data1: number
  data2: number
  /** Samples into the future at which the message is due (from the render call that produced it). */
  sampleOffset: number
}

/** State published by the audio thread for the UI. */
export interface EngineStatus {
  beat: number
  tempo: number
  loopLength: number
  loopPosition: number
  /** TrackState per track (6). */
  tracks: number[]
  recordingTrack: number
  countIn: number
  beatStep: number
  seqStep: number
  peak: number
  transportPlaying: boolean
  beatOn: boolean
  seqPlaying: boolean
  activeVoices: number
}

export function defaultEngineStatus(): EngineStatus {
  return {
    beat: 0, tempo: 100, loopLength: 0, loopPosition: 0, tracks: [0, 0, 0, 0, 0, 0], recordingTrack: -1,
    countIn: 0, beatStep: -1, seqStep: -1, peak: 0, transportPlaying: false, beatOn: false, seqPlaying: false, activeVoices: 0,
  }
}

export function trackState(status: EngineStatus, t: number): TrackState {
  const raw = status.tracks[Math.min(Math.max(t, 0), 5)]
  return raw >= 0 && raw <= 4 ? (raw as TrackState) : TrackState.empty
}
