import { ChordType } from './chordType'

/** A pitch class, 0 = C ... 11 = B. */
export type PitchClass = number

export function mod12(x: number): number {
  return ((x % 12) + 12) % 12
}

export namespace NoteNames {
  export const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  export const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
  /** How key names are displayed in the key menu. */
  export const keyNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

  export function name(pc: PitchClass, preferFlats: boolean): string {
    const i = mod12(pc)
    return preferFlats ? flatNames[i] : sharpNames[i]
  }

  export function keyName(pc: PitchClass): string {
    return keyNames[mod12(pc)]
  }

  /** Note name with octave, MIDI 60 = C4. */
  export function noteName(midi: number, preferFlats = false): string {
    return name(midi, preferFlats) + String(Math.trunc(midi / 12) - 1)
  }

  export function frequency(midi: number): number {
    return 440.0 * Math.pow(2.0, (midi - 69.0) / 12.0)
  }
}

export enum Scale {
  major,
  minor,
  harmonicMinor,
  melodicMinor,
  majorPentatonic,
  minorPentatonic,
  blues,
  dorian,
  mixolydian,
  lydian,
}

const scaleIntervals: Record<Scale, number[]> = {
  [Scale.major]: [0, 2, 4, 5, 7, 9, 11],
  [Scale.minor]: [0, 2, 3, 5, 7, 8, 10],
  [Scale.harmonicMinor]: [0, 2, 3, 5, 7, 8, 11],
  [Scale.melodicMinor]: [0, 2, 3, 5, 7, 9, 11],
  [Scale.majorPentatonic]: [0, 2, 4, 7, 9],
  [Scale.minorPentatonic]: [0, 3, 5, 7, 10],
  [Scale.blues]: [0, 3, 5, 6, 7, 10],
  [Scale.dorian]: [0, 2, 3, 5, 7, 9, 10],
  [Scale.mixolydian]: [0, 2, 4, 5, 7, 9, 10],
  [Scale.lydian]: [0, 2, 4, 6, 7, 9, 11],
}

export namespace Scale {
  export const allCases: Scale[] = [
    Scale.major, Scale.minor, Scale.harmonicMinor, Scale.melodicMinor, Scale.majorPentatonic,
    Scale.minorPentatonic, Scale.blues, Scale.dorian, Scale.mixolydian, Scale.lydian,
  ]

  export function displayName(s: Scale): string {
    return ['MAJOR', 'MINOR', 'HARM MIN', 'MEL MIN', 'MAJ PENT', 'MIN PENT', 'BLUES', 'DORIAN', 'MIXO', 'LYDIAN'][s]
  }

  /** Short tag for the home screen. */
  export function shortName(s: Scale): string {
    return ['MAJ', 'MIN', 'HMN', 'MMN', 'MP5', 'mP5', 'BLU', 'DOR', 'MIX', 'LYD'][s]
  }

  /** The notes of the scale (used by Lead mode, ear training, etc.). */
  export function intervals(s: Scale): number[] {
    return scaleIntervals[s].slice()
  }

  /** Seven-note scale the seven chord buttons are built from. Pentatonic and blues
   *  scales borrow their chords from the closest heptatonic parent. */
  export function chordParent(s: Scale): number[] {
    switch (s) {
      case Scale.majorPentatonic: return intervals(Scale.major)
      case Scale.minorPentatonic: return intervals(Scale.minor)
      case Scale.blues: return intervals(Scale.mixolydian)
      default: return intervals(s)
    }
  }

  /** Whether the scale has a minor third over its tonic. */
  export function isMinor(s: Scale): boolean {
    return chordParent(s)[2] === 3
  }

  /** The parallel scale used by Borrow mode (major <-> natural minor). */
  export function parallel(s: Scale): Scale {
    return isMinor(s) ? Scale.major : Scale.minor
  }

  /** The note a Lead-mode button plays, as a semitone offset from the key root. */
  export function leadOffset(s: Scale, button: number): number {
    const iv = scaleIntervals[s]
    return iv[button % iv.length] + 12 * Math.trunc(button / iv.length)
  }

  /** Chord degrees whose default quality is forced (blues uses dominant 7ths on I, IV, V). */
  export function defaultChordType(s: Scale, degree: number): ChordType | null {
    if (s !== Scale.blues) return null
    return [0, 3, 4].includes(degree) ? ChordType.dom7 : null
  }
}
