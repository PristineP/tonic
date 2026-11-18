import { ChordType, TriadFamily } from './chordType'
import { JoyDirection, JoystickMap } from './joystick'
import { mod12, NoteNames, PitchClass, Scale } from './music'

/** A chord described by root, quality and optional slash bass. */
export interface ChordSpec {
  root: PitchClass
  type: ChordType
  bass: PitchClass | null
}

export function chordSpec(root: PitchClass, type: ChordType, bass: PitchClass | null = null): ChordSpec {
  return { root: mod12(root), type, bass: bass === null ? null : mod12(bass) }
}

export namespace ChordSpec {
  export function name(spec: ChordSpec, preferFlats: boolean): string {
    let s = NoteNames.name(spec.root, preferFlats) + ChordType.suffix(spec.type)
    if (spec.bass !== null && spec.bass !== spec.root) {
      s += '/' + NoteNames.name(spec.bass, preferFlats)
    }
    return s
  }

  export function equals(a: ChordSpec, b: ChordSpec): boolean {
    return a.root === b.root && a.type === b.type && a.bass === b.bass
  }
}

export enum BassMode { off, root, slash }

export namespace BassMode {
  export const allCases: BassMode[] = [BassMode.off, BassMode.root, BassMode.slash]
  export function displayName(m: BassMode): string {
    return ['OFF', 'ROOT', 'AUTO SLASH'][m]
  }
}

/** Everything that affects which chord a button produces. */
export interface HarmonySettings {
  key: PitchClass
  scale: Scale
  /** Global octave shift, -2 ... +2. */
  octave: number
  joystickMap: JoystickMap
  /** 0 = root position, 1-3 = inversions. */
  inversion: number
  voiceLeading: boolean
  bassMode: BassMode
  /** Per-button octave offsets, -2 ... +2. */
  buttonOctaves: number[]
}

export function defaultHarmonySettings(): HarmonySettings {
  return {
    key: 0,
    scale: Scale.major,
    octave: 0,
    joystickMap: JoystickMap.standard,
    inversion: 0,
    voiceLeading: false,
    bassMode: BassMode.off,
    buttonOctaves: [0, 0, 0, 0, 0, 0, 0],
  }
}

export function copyHarmonySettings(s: HarmonySettings): HarmonySettings {
  return { ...s, buttonOctaves: s.buttonOctaves.slice() }
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export namespace HarmonySettings {
  /** Whether chord names in this key read better with flats. */
  export function prefersFlats(s: HarmonySettings): boolean {
    // Find the relative major so minor/modal keys spell like their parent.
    const parent = Scale.chordParent(s.scale)
    let majorOffset = 0
    if (
      arraysEqual(parent, Scale.intervals(Scale.minor)) ||
      arraysEqual(parent, Scale.intervals(Scale.harmonicMinor)) ||
      arraysEqual(parent, Scale.intervals(Scale.melodicMinor))
    ) majorOffset = 3
    else if (arraysEqual(parent, Scale.intervals(Scale.dorian))) majorOffset = -2
    else if (arraysEqual(parent, Scale.intervals(Scale.mixolydian))) majorOffset = 5
    else if (arraysEqual(parent, Scale.intervals(Scale.lydian))) majorOffset = 7
    const relMajor = mod12(s.key + majorOffset)
    return [1, 3, 5, 8, 10].includes(relMajor)
  }
}

export interface Voicing {
  notes: number[]
  bass: number | null
}

export namespace Voicing {
  export function allNotes(v: Voicing): number[] {
    return (v.bass === null ? [] : [v.bass]).concat(v.notes)
  }
  export function equals(a: Voicing, b: Voicing): boolean {
    return a.bass === b.bass && arraysEqual(a.notes, b.notes)
  }
}

/** Turns button presses and joystick directions into chords and voicings. */
export namespace ChordBuilder {
  /** The diatonic chord on a scale degree (0-6). */
  export function diatonic(degree: number, settings: HarmonySettings): ChordSpec {
    return diatonicIn(degree, settings.key, settings.scale)
  }

  export function diatonicIn(degree: number, key: PitchClass, scale: Scale): ChordSpec {
    const s = Scale.chordParent(scale)
    const d = ((degree % 7) + 7) % 7
    const root = s[d]
    const third = mod12(s[(d + 2) % 7] - root)
    const fifth = mod12(s[(d + 4) % 7] - root)
    const type = Scale.defaultChordType(scale, d) ?? ChordType.triad(third, fifth)
    return chordSpec(key + root, type)
  }

  /** Applies a joystick direction to the diatonic chord of a degree. */
  export function chord(degree: number, direction: JoyDirection, settings: HarmonySettings): ChordSpec {
    const base = diatonic(degree, settings)
    return transform(base, degree, direction, settings)
  }

  export function transform(base: ChordSpec, degree: number, direction: JoyDirection, settings: HarmonySettings): ChordSpec {
    const family = ChordType.family(base.type)
    const r = base.root
    const on = (t: ChordType) => chordSpec(r, t)
    const flipped = (): ChordType => {
      switch (family) {
        case TriadFamily.major: case TriadFamily.augmented: case TriadFamily.suspended: return ChordType.minor
        case TriadFamily.minor: case TriadFamily.diminished: return ChordType.major
      }
    }
    const seventh = (): ChordType => {
      if (base.type === ChordType.dom7) return ChordType.dom7 // blues I/IV/V stay dominant
      switch (family) {
        case TriadFamily.major: case TriadFamily.suspended: return ChordType.maj7
        case TriadFamily.minor: return ChordType.min7
        case TriadFamily.diminished: return ChordType.halfDim7
        case TriadFamily.augmented: return ChordType.aug7
      }
    }
    const ninth = (): ChordType => {
      switch (family) {
        case TriadFamily.major: case TriadFamily.suspended: case TriadFamily.augmented:
          return base.type === ChordType.dom7 ? ChordType.dom9 : ChordType.maj9
        case TriadFamily.minor: return ChordType.min9
        case TriadFamily.diminished: return ChordType.halfDim7
      }
    }
    const minorish = family === TriadFamily.minor || family === TriadFamily.diminished

    if (direction === JoyDirection.center) return base
    const D = JoyDirection
    switch (settings.joystickMap) {
      case JoystickMap.standard:
        switch (direction) {
          case D.up: return on(flipped())
          case D.upRight: return on(ChordType.dom7)
          case D.right: return on(seventh())
          case D.downRight: return on(ninth())
          case D.down: return on(ChordType.sus4)
          case D.downLeft: return on(family === TriadFamily.major || family === TriadFamily.augmented ? ChordType.six : ChordType.sus2)
          case D.left: return on(family === TriadFamily.diminished ? ChordType.minor : ChordType.diminished)
          case D.upLeft: return on(ChordType.augmented)
        }
        break
      case JoystickMap.extended:
        switch (direction) {
          case D.up: return on(ChordType.halfDim7)
          case D.upRight: return on(ChordType.dom9)
          case D.right: return on(ChordType.sus4Dom7)
          case D.downRight: return on(ChordType.add11)
          case D.down: return on(minorish ? ChordType.minorAdd9 : ChordType.add9)
          case D.downLeft: return on(ChordType.dom7Sharp9)
          case D.left: return on(ChordType.min11)
          case D.upLeft: return on(minorish ? ChordType.min9 : ChordType.maj9)
        }
        break
      case JoystickMap.chromatic:
        switch (direction) {
          case D.up: return chordSpec(r + 1, base.type)
          case D.down: return chordSpec(r - 1, base.type)
          case D.upRight: return on(ChordType.minMaj7)
          case D.right: return on(ChordType.maj13)
          case D.downRight: return on(ChordType.dom7Flat9)
          case D.downLeft: return on(ChordType.dom7Alt)
          case D.left: return on(ChordType.sixNine)
          case D.upLeft: return on(ChordType.halfDim7)
        }
        break
      case JoystickMap.borrow:
        switch (direction) {
          case D.up: return chordSpec(r + 7, ChordType.dom7) // secondary dominant
          case D.upRight: // same degree in the parallel major/minor
            return diatonicIn(degree, settings.key, Scale.parallel(settings.scale))
          case D.right: return chordSpec(r - 1, ChordType.major) // flat-side / Neapolitan major
          case D.downRight: return chordSpec(r - 1, ChordType.dim7) // passing diminished
          case D.down: return chordSpec(r + 6, ChordType.dom7) // tritone substitution
          case D.downLeft: return chordSpec(r - 2, ChordType.dom7) // backdoor dominant
          case D.left: return on(ChordType.major) // borrowed major
          case D.upLeft: return chordSpec(r + 7, ChordType.sus4Dom7)
        }
        break
      case JoystickMap.classic:
        switch (direction) {
          case D.up: return on(flipped())
          case D.upRight: return on(ChordType.dom7)
          case D.right: return on(seventh())
          case D.downRight: return on(ChordType.classicNine)
          case D.down: return on(ChordType.sus4)
          case D.downLeft: return on(ChordType.sus2)
          case D.left: return on(ChordType.diminished)
          case D.upLeft: return on(ChordType.augmented)
        }
        break
    }
    return base
  }

  /** MIDI note of the chord root before octave shifts. Roots stay within the octave
   *  starting at the key so progressions sit in one comfortable register. */
  export function rootMidi(spec: ChordSpec, settings: HarmonySettings): number {
    const keyRoot = 48 + settings.key // C3 ... B3
    return keyRoot + mod12(spec.root - settings.key)
  }

  /** Voices a chord into MIDI notes.
   *  @param previous the last voicing played, used for voice leading.
   *  @param inversionOverride inversion to use instead of the global one. */
  export function voicing(
    spec: ChordSpec,
    degree: number,
    settings: HarmonySettings,
    previous: number[] | null = null,
    inversionOverride: number | null = null,
  ): Voicing {
    const btnOct = degree >= 0 && degree < settings.buttonOctaves.length ? settings.buttonOctaves[degree] : 0
    const octaveShift = 12 * (settings.octave + btnOct)
    const root = rootMidi(spec, settings) + octaveShift
    let notes = ChordType.intervals(spec.type).map((i) => root + i)

    if (settings.voiceLeading && previous !== null && previous.length > 0) {
      notes = leadVoices(notes, previous)
    } else {
      const inv = inversionOverride ?? settings.inversion
      notes = invert(notes, inv)
    }

    const lowest = notes.length > 0 ? Math.min(...notes) : root
    let bass: number | null = null
    switch (settings.bassMode) {
      case BassMode.off: break
      case BassMode.root: bass = bassNote(spec.bass ?? spec.root, lowest); break
      case BassMode.slash: {
        // Auto slash: the bass follows the lowest chord tone, giving smooth inverted bass lines.
        const pc = spec.bass ?? mod12(lowest)
        bass = bassNote(pc, lowest)
        break
      }
    }
    if (spec.bass !== null && settings.bassMode === BassMode.off) {
      bass = bassNote(spec.bass, lowest)
    }
    return { notes: notes.map(clampMidi), bass: bass === null ? null : clampMidi(bass) }
  }

  export function clampMidi(n: number): number {
    while (n < 12) n += 12
    while (n > 115) n -= 12
    return n
  }

  /** The bass pitch class placed one to two octaves below the chord. */
  export function bassNote(pc: PitchClass, lowest: number): number {
    let b = lowest - 12
    b -= mod12(b - pc)
    if (lowest - b < 12) b -= 12
    return b
  }

  /** Moves the lowest notes up an octave `times` times. */
  export function invert(notes: number[], times: number): number[] {
    if (notes.length === 0 || !(times > 0)) return notes.slice()
    const n = notes.slice().sort((a, b) => a - b)
    const count = times % n.length
    for (let i = 0; i < count; i++) {
      const low = n.shift()!
      n.push(low + 12)
    }
    return n
  }

  /** Picks the inversion and octave of `notes` closest to the previous voicing. */
  export function leadVoices(notes: number[], previous: number[]): number[] {
    const target = previous.reduce((a, b) => a + b, 0) / previous.length
    const prevMax = Math.max(...previous)
    let best = notes
    let bestScore = Infinity
    for (let inv = 0; inv < notes.length; inv++) {
      const inverted = invert(notes, inv)
      for (const shift of [-24, -12, 0, 12]) {
        const cand = inverted.map((n) => n + shift)
        const lo = cand[0]
        const hi = cand[cand.length - 1]
        if (lo === undefined || hi === undefined || lo < 40 || hi > 88) continue
        const centroid = cand.reduce((a, b) => a + b, 0) / cand.length
        // Prefer small centroid motion, then small top-voice motion.
        const topMove = Math.abs(hi - prevMax)
        const score = Math.abs(centroid - target) * 2 + topMove * 0.5
        if (score < bestScore) { bestScore = score; best = cand }
      }
    }
    return best
  }
}
