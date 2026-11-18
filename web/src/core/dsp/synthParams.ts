/** Oscillator / generator types. */
export enum WaveType {
  sine, triangle, saw, square, pulse, sawSquare, supersaw, fm, pluck, organ, buzzOrgan, noise, sample,
}

/** A complete synth voice description. Plain data so it can cross to the audio thread. */
export interface SynthParams {
  wave: WaveType
  /** Second oscillator (ignored by fm, pluck, organ, noise and sample). */
  wave2: WaveType
  osc2Mix: number
  osc2Semitones: number
  detuneCents: number
  fmRatio: number
  fmIndex: number
  /** Seconds for the FM index to fall to `fmSustain` of its start value. */
  fmDecay: number
  fmSustain: number
  noise: number
  attack: number
  decay: number
  sustain: number
  release: number
  cutoff: number
  resonance: number
  /** Filter envelope depth in octaves. */
  filterEnv: number
  filterDecay: number
  /** 0 ... 1, how much the cutoff follows pitch. */
  keyTrack: number
  vibratoRate: number
  /** Vibrato depth in semitones. */
  vibratoDepth: number
  vibratoDelay: number
  tremoloRate: number
  tremoloDepth: number
  /** Seconds for a plucked string to decay by 60 dB. */
  pluckDecay: number
  /** 0 ... 1 brightness of plucked strings. */
  pluckBright: number
  /** "Ahh" vowel formant amount, 0 ... 1. */
  formant: number
  glide: number
  gain: number
  /** Octave offset (used for basses). */
  octave: number
}

export function defaultSynthParams(): SynthParams {
  return {
    wave: WaveType.saw, wave2: WaveType.saw, osc2Mix: 0, osc2Semitones: 0, detuneCents: 0,
    fmRatio: 1, fmIndex: 0, fmDecay: 0.5, fmSustain: 0.2, noise: 0,
    attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.3,
    cutoff: 8000, resonance: 0.1, filterEnv: 0, filterDecay: 0.3, keyTrack: 0.5,
    vibratoRate: 5, vibratoDepth: 0, vibratoDelay: 0.3, tremoloRate: 5, tremoloDepth: 0,
    pluckDecay: 3, pluckBright: 0.5, formant: 0, glide: 0, gain: 0.5, octave: 0,
  }
}

/** Returns a copy with attack/release scaled by user offsets. */
export function withEnvelope(p: SynthParams, attackScale: number, releaseScale: number): SynthParams {
  return {
    ...p,
    attack: Math.min(4, Math.max(0.001, p.attack * attackScale)),
    release: Math.min(8, Math.max(0.01, p.release * releaseScale)),
  }
}

export function synthParamsEqual(a: SynthParams, b: SynthParams): boolean {
  for (const k of Object.keys(a) as (keyof SynthParams)[]) if (a[k] !== b[k]) return false
  return true
}

/** A named factory or user sound. `id` is the name. */
export interface SoundPreset {
  name: string
  params: SynthParams
}

function buildFactory(): SoundPreset[] {
  const list: SoundPreset[] = []
  const add = (name: string, build: (p: SynthParams) => void) => {
    const p = defaultSynthParams()
    build(p)
    list.push({ name, params: p })
  }
  const W = WaveType

  add('SAW', p => {
    p.wave = W.supersaw; p.detuneCents = 14; p.cutoff = 3200; p.resonance = 0.15
    p.filterEnv = 1.2; p.filterDecay = 0.4; p.attack = 0.004; p.decay = 0.6; p.sustain = 0.7; p.release = 0.35; p.gain = 0.32
  })
  add('SAW BASS', p => {
    p.wave = W.saw; p.wave2 = W.square; p.osc2Mix = 0.35; p.osc2Semitones = -12; p.octave = -1
    p.cutoff = 600; p.resonance = 0.35; p.filterEnv = 2.5; p.filterDecay = 0.25; p.keyTrack = 0.3
    p.attack = 0.002; p.decay = 0.4; p.sustain = 0.6; p.release = 0.12; p.gain = 0.45
  })
  add('PIANO', p => {
    p.wave = W.fm; p.fmRatio = 1; p.fmIndex = 2.2; p.fmDecay = 0.6; p.fmSustain = 0.1; p.wave2 = W.triangle; p.osc2Mix = 0.3
    p.attack = 0.002; p.decay = 1.8; p.sustain = 0.0; p.release = 0.35; p.cutoff = 5000; p.keyTrack = 0.6; p.gain = 0.42
  })
  add('TINE EP', p => {
    p.wave = W.fm; p.fmRatio = 14; p.fmIndex = 1.6; p.fmDecay = 0.12; p.fmSustain = 0.05; p.wave2 = W.sine; p.osc2Mix = 0.6
    p.attack = 0.002; p.decay = 2.4; p.sustain = 0.15; p.release = 0.5; p.cutoff = 7000; p.tremoloRate = 4.5; p.tremoloDepth = 0.12; p.gain = 0.45
  })
  add('ORGAN', p => {
    p.wave = W.organ; p.attack = 0.006; p.decay = 0.1; p.sustain = 1; p.release = 0.06; p.cutoff = 9000
    p.vibratoRate = 6.5; p.vibratoDepth = 0.08; p.vibratoDelay = 0; p.gain = 0.3
  })
  add('STRINGS', p => {
    p.wave = W.supersaw; p.detuneCents = 18; p.attack = 0.35; p.decay = 0.5; p.sustain = 0.85; p.release = 0.9
    p.cutoff = 2600; p.resonance = 0.05; p.vibratoRate = 5; p.vibratoDepth = 0.06; p.gain = 0.3
  })
  add('HORNS', p => {
    p.wave = W.saw; p.wave2 = W.saw; p.osc2Mix = 0.5; p.detuneCents = 8; p.attack = 0.05; p.decay = 0.3; p.sustain = 0.8; p.release = 0.2
    p.cutoff = 900; p.filterEnv = 1.8; p.filterDecay = 0.25; p.resonance = 0.1; p.vibratoDepth = 0.05; p.gain = 0.36
  })
  add('BRASS', p => {
    p.wave = W.supersaw; p.detuneCents = 10; p.attack = 0.03; p.decay = 0.4; p.sustain = 0.75; p.release = 0.25
    p.cutoff = 1200; p.filterEnv = 2.2; p.filterDecay = 0.35; p.resonance = 0.2; p.gain = 0.32
  })
  add('E.GUITAR', p => {
    p.wave = W.pluck; p.pluckDecay = 4; p.pluckBright = 0.7; p.attack = 0.001; p.sustain = 1; p.release = 0.25
    p.cutoff = 3500; p.resonance = 0.2; p.gain = 0.55
  })
  add('CLARINET', p => {
    p.wave = W.square; p.attack = 0.04; p.decay = 0.2; p.sustain = 0.9; p.release = 0.12; p.cutoff = 1400; p.resonance = 0.1
    p.keyTrack = 0.8; p.vibratoDepth = 0.04; p.noise = 0.02; p.gain = 0.32
  })
  add('FLUTE', p => {
    p.wave = W.sine; p.wave2 = W.triangle; p.osc2Mix = 0.3; p.osc2Semitones = 12; p.noise = 0.06; p.attack = 0.06; p.decay = 0.2
    p.sustain = 0.9; p.release = 0.15; p.cutoff = 4000; p.vibratoDepth = 0.07; p.vibratoDelay = 0.25; p.gain = 0.42
  })
  add('GRAND PNO', p => {
    p.wave = W.fm; p.fmRatio = 1; p.fmIndex = 3.0; p.fmDecay = 0.4; p.fmSustain = 0.15; p.wave2 = W.saw; p.osc2Mix = 0.15; p.detuneCents = 3
    p.attack = 0.001; p.decay = 2.6; p.sustain = 0; p.release = 0.45; p.cutoff = 6000; p.filterEnv = 0.8; p.filterDecay = 0.8; p.gain = 0.42
  })
  add('RETRO EP', p => {
    p.wave = W.fm; p.fmRatio = 1; p.fmIndex = 1.2; p.fmDecay = 0.25; p.fmSustain = 0.3; p.attack = 0.003; p.decay = 1.5; p.sustain = 0.3
    p.release = 0.4; p.cutoff = 3000; p.tremoloRate = 5.5; p.tremoloDepth = 0.25; p.gain = 0.45
  })
  add('VOX AHH', p => {
    p.wave = W.saw; p.wave2 = W.saw; p.osc2Mix = 0.5; p.detuneCents = 9; p.formant = 1; p.attack = 0.25; p.decay = 0.4; p.sustain = 0.9
    p.release = 0.6; p.cutoff = 3000; p.vibratoRate = 5.2; p.vibratoDepth = 0.12; p.gain = 0.55
  })
  add('VIBES', p => {
    p.wave = W.fm; p.fmRatio = 4; p.fmIndex = 0.8; p.fmDecay = 0.15; p.fmSustain = 0.1; p.attack = 0.001; p.decay = 2.8; p.sustain = 0
    p.release = 0.8; p.tremoloRate = 6; p.tremoloDepth = 0.3; p.cutoff = 8000; p.gain = 0.5
  })
  add('FM EPIANO', p => {
    p.wave = W.fm; p.fmRatio = 1; p.fmIndex = 1.8; p.fmDecay = 0.3; p.fmSustain = 0.2; p.wave2 = W.sine; p.osc2Mix = 0.25; p.osc2Semitones = 12
    p.attack = 0.002; p.decay = 2.0; p.sustain = 0.2; p.release = 0.5; p.cutoff = 6000; p.gain = 0.45
  })
  add('AC.GUITAR', p => {
    p.wave = W.pluck; p.pluckDecay = 2.5; p.pluckBright = 0.45; p.attack = 0.001; p.sustain = 1; p.release = 0.3; p.cutoff = 6000; p.gain = 0.6
  })
  add('HARP', p => {
    p.wave = W.pluck; p.pluckDecay = 5; p.pluckBright = 0.25; p.attack = 0.001; p.sustain = 1; p.release = 1.5; p.cutoff = 5000; p.gain = 0.6
  })
  add('BUZZ ORGAN', p => {
    p.wave = W.buzzOrgan; p.attack = 0.004; p.decay = 0.1; p.sustain = 1; p.release = 0.05; p.cutoff = 5000; p.resonance = 0.2; p.gain = 0.26
  })
  add('HUMMING', p => {
    p.wave = W.triangle; p.wave2 = W.sine; p.osc2Mix = 0.5; p.formant = 0.5; p.attack = 0.3; p.decay = 0.3; p.sustain = 0.9; p.release = 0.5
    p.cutoff = 1200; p.vibratoDepth = 0.1; p.vibratoRate = 4.8; p.gain = 0.6
  })
  add('SINE', p => {
    p.wave = W.sine; p.attack = 0.01; p.decay = 0.3; p.sustain = 0.9; p.release = 0.3; p.cutoff = 12000; p.gain = 0.5
  })
  add('FM WOW', p => {
    p.wave = W.fm; p.fmRatio = 2; p.fmIndex = 5; p.fmDecay = 1.2; p.fmSustain = 0.05; p.attack = 0.01; p.decay = 1.2; p.sustain = 0.5
    p.release = 0.5; p.cutoff = 4000; p.resonance = 0.4; p.filterEnv = 2; p.filterDecay = 0.6; p.gain = 0.38
  })
  add('ROBBO BASS', p => {
    p.wave = W.square; p.wave2 = W.saw; p.osc2Mix = 0.5; p.detuneCents = 12; p.octave = -1; p.cutoff = 400; p.resonance = 0.6
    p.filterEnv = 3; p.filterDecay = 0.18; p.attack = 0.002; p.decay = 0.3; p.sustain = 0.5; p.release = 0.1; p.gain = 0.4
  })
  add('SHUTTER', p => {
    p.wave = W.pulse; p.attack = 0.002; p.decay = 0.12; p.sustain = 0.25; p.release = 0.1; p.cutoff = 2500; p.resonance = 0.5
    p.filterEnv = 2.5; p.filterDecay = 0.08; p.tremoloRate = 12; p.tremoloDepth = 0.6; p.gain = 0.4
  })
  add('TRIANGLE', p => {
    p.wave = W.triangle; p.attack = 0.005; p.decay = 0.3; p.sustain = 0.8; p.release = 0.25; p.cutoff = 10000; p.gain = 0.55
  })
  add('SQUARE', p => {
    p.wave = W.square; p.attack = 0.003; p.decay = 0.3; p.sustain = 0.8; p.release = 0.2; p.cutoff = 6000; p.gain = 0.3
  })
  add('SAWSQUARE', p => {
    p.wave = W.sawSquare; p.detuneCents = 6; p.attack = 0.003; p.decay = 0.4; p.sustain = 0.7; p.release = 0.25; p.cutoff = 4000
    p.filterEnv = 1; p.filterDecay = 0.3; p.gain = 0.3
  })
  add('OCEAN', p => {
    p.wave = W.noise; p.attack = 1.2; p.decay = 1; p.sustain = 0.9; p.release = 2.5; p.cutoff = 900; p.resonance = 0.55
    p.keyTrack = 1; p.vibratoRate = 0.15; p.vibratoDepth = 6; p.vibratoDelay = 0; p.gain = 0.7
  })
  return list
}

/** The built-in sound library. */
export namespace SoundLibrary {
  /** Factory presets. Treat as read-only; copy params before mutating. */
  export const factory: readonly SoundPreset[] = buildFactory()

  /** Sound used when the user records or loads a sample. */
  export function samplePreset(name = 'MIC SAMPLE'): SoundPreset {
    const p = defaultSynthParams()
    p.wave = WaveType.sample; p.attack = 0.002; p.decay = 0.5; p.sustain = 1; p.release = 0.25; p.cutoff = 14000; p.keyTrack = 0; p.gain = 0.8
    return { name, params: p }
  }

  /** Names used by the sound + button quick-select shortcuts. */
  export const quickSelect: readonly string[] = ['PIANO', 'TINE EP', 'STRINGS', 'SAW', 'SAW BASS', 'E.GUITAR', 'VOX AHH']
}
