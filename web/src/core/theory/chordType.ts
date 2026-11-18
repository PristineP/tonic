/** Every chord quality Tonic can produce. */
export enum ChordType {
  major, minor, diminished, augmented, sus2, sus4, power,
  dom7, maj7, min7, halfDim7, dim7, minMaj7, aug7, sus4Dom7,
  six, minor6, sixNine,
  add9, minorAdd9, add11,
  dom9, maj9, min9, min11, maj13,
  dom7Sharp9, dom7Flat9, dom7Alt,
  /** The technically unconventional "ninth" of the classic firmware (root, 3rd, 5th, 9th an octave up, no 7th). */
  classicNine,
}

export enum TriadFamily { major, minor, diminished, augmented, suspended }

const table: [number[], string][] = [
  [[0, 4, 7], ''],
  [[0, 3, 7], 'm'],
  [[0, 3, 6], 'dim'],
  [[0, 4, 8], 'aug'],
  [[0, 2, 7], 'sus2'],
  [[0, 5, 7], 'sus4'],
  [[0, 7, 12], '5'],
  [[0, 4, 7, 10], '7'],
  [[0, 4, 7, 11], 'maj7'],
  [[0, 3, 7, 10], 'm7'],
  [[0, 3, 6, 10], 'm7b5'],
  [[0, 3, 6, 9], 'dim7'],
  [[0, 3, 7, 11], 'mMaj7'],
  [[0, 4, 8, 10], 'aug7'],
  [[0, 5, 7, 10], '7sus4'],
  [[0, 4, 7, 9], '6'],
  [[0, 3, 7, 9], 'm6'],
  [[0, 4, 7, 9, 14], '6/9'],
  [[0, 4, 7, 14], 'add9'],
  [[0, 3, 7, 14], 'madd9'],
  [[0, 4, 7, 17], 'add11'],
  [[0, 4, 7, 10, 14], '9'],
  [[0, 4, 7, 11, 14], 'maj9'],
  [[0, 3, 7, 10, 14], 'm9'],
  [[0, 3, 7, 10, 14, 17], 'm11'],
  [[0, 4, 7, 11, 14, 21], 'maj13'],
  [[0, 4, 7, 10, 15], '7#9'],
  [[0, 4, 7, 10, 13], '7b9'],
  [[0, 4, 10, 13, 15, 20], '7alt'],
  [[0, 4, 7, 14, 19], '9*'],
]

export namespace ChordType {
  export const allCases: ChordType[] = table.map((_, i) => i as ChordType)

  /** Semitones above the root. */
  export function intervals(t: ChordType): number[] {
    return table[t][0].slice()
  }

  /** Suffix appended to the root name, e.g. "m7". */
  export function suffix(t: ChordType): string {
    return table[t][1]
  }

  /** The basic triad family the chord belongs to. */
  export function family(t: ChordType): TriadFamily {
    switch (t) {
      case ChordType.minor: case ChordType.min7: case ChordType.minMaj7: case ChordType.minor6:
      case ChordType.minorAdd9: case ChordType.min9: case ChordType.min11:
        return TriadFamily.minor
      case ChordType.diminished: case ChordType.halfDim7: case ChordType.dim7:
        return TriadFamily.diminished
      case ChordType.augmented: case ChordType.aug7:
        return TriadFamily.augmented
      case ChordType.sus2: case ChordType.sus4: case ChordType.sus4Dom7: case ChordType.power:
        return TriadFamily.suspended
      default:
        return TriadFamily.major
    }
  }

  /** Builds the triad that matches the given intervals of a third and fifth. */
  export function triad(third: number, fifth: number): ChordType {
    if (third === 3 && fifth === 7) return ChordType.minor
    if (third === 3 && fifth === 6) return ChordType.diminished
    if (third === 4 && fifth === 8) return ChordType.augmented
    if (third === 4 && fifth === 7) return ChordType.major
    if (fifth === 6) return ChordType.diminished
    if (fifth === 8) return ChordType.augmented
    return third === 3 ? ChordType.minor : ChordType.major
  }
}
