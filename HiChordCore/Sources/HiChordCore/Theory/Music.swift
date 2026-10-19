import Foundation

/// A pitch class, 0 = C ... 11 = B.
public typealias PitchClass = Int

public enum NoteNames {
    static let sharpNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    static let flatNames = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
    /// How key names are displayed in the key menu.
    static let keyNames = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

    public static func name(_ pc: PitchClass, preferFlats: Bool) -> String {
        let i = mod12(pc)
        return preferFlats ? flatNames[i] : sharpNames[i]
    }

    public static func keyName(_ pc: PitchClass) -> String { keyNames[mod12(pc)] }

    /// Note name with octave, MIDI 60 = C4.
    public static func noteName(midi: Int, preferFlats: Bool = false) -> String {
        name(midi, preferFlats: preferFlats) + String(midi / 12 - 1)
    }

    public static func frequency(midi: Double) -> Double {
        440.0 * pow(2.0, (midi - 69.0) / 12.0)
    }
}

@inline(__always) public func mod12(_ x: Int) -> Int { ((x % 12) + 12) % 12 }

public enum Scale: Int, CaseIterable, Codable, Sendable {
    case major, minor, harmonicMinor, melodicMinor, majorPentatonic, minorPentatonic, blues, dorian, mixolydian, lydian

    public var displayName: String {
        switch self {
        case .major: return "MAJOR"
        case .minor: return "MINOR"
        case .harmonicMinor: return "HARM MIN"
        case .melodicMinor: return "MEL MIN"
        case .majorPentatonic: return "MAJ PENT"
        case .minorPentatonic: return "MIN PENT"
        case .blues: return "BLUES"
        case .dorian: return "DORIAN"
        case .mixolydian: return "MIXO"
        case .lydian: return "LYDIAN"
        }
    }

    /// Short tag for the home screen.
    public var shortName: String {
        switch self {
        case .major: return "MAJ"
        case .minor: return "MIN"
        case .harmonicMinor: return "HMN"
        case .melodicMinor: return "MMN"
        case .majorPentatonic: return "MP5"
        case .minorPentatonic: return "mP5"
        case .blues: return "BLU"
        case .dorian: return "DOR"
        case .mixolydian: return "MIX"
        case .lydian: return "LYD"
        }
    }

    /// The notes of the scale (used by Lead mode, ear training, etc.).
    public var intervals: [Int] {
        switch self {
        case .major: return [0, 2, 4, 5, 7, 9, 11]
        case .minor: return [0, 2, 3, 5, 7, 8, 10]
        case .harmonicMinor: return [0, 2, 3, 5, 7, 8, 11]
        case .melodicMinor: return [0, 2, 3, 5, 7, 9, 11]
        case .majorPentatonic: return [0, 2, 4, 7, 9]
        case .minorPentatonic: return [0, 3, 5, 7, 10]
        case .blues: return [0, 3, 5, 6, 7, 10]
        case .dorian: return [0, 2, 3, 5, 7, 9, 10]
        case .mixolydian: return [0, 2, 4, 5, 7, 9, 10]
        case .lydian: return [0, 2, 4, 6, 7, 9, 11]
        }
    }

    /// Seven-note scale the seven chord buttons are built from. Pentatonic and blues
    /// scales borrow their chords from the closest heptatonic parent.
    public var chordParent: [Int] {
        switch self {
        case .majorPentatonic: return Scale.major.intervals
        case .minorPentatonic: return Scale.minor.intervals
        case .blues: return Scale.mixolydian.intervals
        default: return intervals
        }
    }

    /// Whether the scale has a minor third over its tonic.
    public var isMinor: Bool { chordParent[2] == 3 }

    /// The parallel scale used by Borrow mode (major <-> natural minor).
    public var parallel: Scale { isMinor ? .major : .minor }

    /// The note a Lead-mode button plays, as a semitone offset from the key root.
    public func leadOffset(button: Int) -> Int {
        let s = intervals
        return s[button % s.count] + 12 * (button / s.count)
    }

    /// Chord degrees whose default quality is forced (blues uses dominant 7ths on I, IV, V).
    func defaultChordType(degree: Int) -> ChordType? {
        guard self == .blues else { return nil }
        return [0, 3, 4].contains(degree) ? .dom7 : nil
    }
}
