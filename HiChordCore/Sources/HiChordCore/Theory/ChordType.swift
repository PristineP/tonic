import Foundation

/// Every chord quality HiChord can produce.
public enum ChordType: Int, CaseIterable, Codable, Sendable {
    case major, minor, diminished, augmented, sus2, sus4, power
    case dom7, maj7, min7, halfDim7, dim7, minMaj7, aug7, sus4Dom7
    case six, minor6, sixNine
    case add9, minorAdd9, add11
    case dom9, maj9, min9, min11, maj13
    case dom7Sharp9, dom7Flat9, dom7Alt
    /// The technically unconventional "ninth" from the original firmware (root, 3rd, 5th, 9th an octave up, no 7th).
    case ogNine

    /// Semitones above the root.
    public var intervals: [Int] {
        switch self {
        case .major: return [0, 4, 7]
        case .minor: return [0, 3, 7]
        case .diminished: return [0, 3, 6]
        case .augmented: return [0, 4, 8]
        case .sus2: return [0, 2, 7]
        case .sus4: return [0, 5, 7]
        case .power: return [0, 7, 12]
        case .dom7: return [0, 4, 7, 10]
        case .maj7: return [0, 4, 7, 11]
        case .min7: return [0, 3, 7, 10]
        case .halfDim7: return [0, 3, 6, 10]
        case .dim7: return [0, 3, 6, 9]
        case .minMaj7: return [0, 3, 7, 11]
        case .aug7: return [0, 4, 8, 10]
        case .sus4Dom7: return [0, 5, 7, 10]
        case .six: return [0, 4, 7, 9]
        case .minor6: return [0, 3, 7, 9]
        case .sixNine: return [0, 4, 7, 9, 14]
        case .add9: return [0, 4, 7, 14]
        case .minorAdd9: return [0, 3, 7, 14]
        case .add11: return [0, 4, 7, 17]
        case .dom9: return [0, 4, 7, 10, 14]
        case .maj9: return [0, 4, 7, 11, 14]
        case .min9: return [0, 3, 7, 10, 14]
        case .min11: return [0, 3, 7, 10, 14, 17]
        case .maj13: return [0, 4, 7, 11, 14, 21]
        case .dom7Sharp9: return [0, 4, 7, 10, 15]
        case .dom7Flat9: return [0, 4, 7, 10, 13]
        case .dom7Alt: return [0, 4, 10, 13, 15, 20]
        case .ogNine: return [0, 4, 7, 14, 19]
        }
    }

    /// Suffix appended to the root name, e.g. "m7".
    public var suffix: String {
        switch self {
        case .major: return ""
        case .minor: return "m"
        case .diminished: return "dim"
        case .augmented: return "aug"
        case .sus2: return "sus2"
        case .sus4: return "sus4"
        case .power: return "5"
        case .dom7: return "7"
        case .maj7: return "maj7"
        case .min7: return "m7"
        case .halfDim7: return "m7b5"
        case .dim7: return "dim7"
        case .minMaj7: return "mMaj7"
        case .aug7: return "aug7"
        case .sus4Dom7: return "7sus4"
        case .six: return "6"
        case .minor6: return "m6"
        case .sixNine: return "6/9"
        case .add9: return "add9"
        case .minorAdd9: return "madd9"
        case .add11: return "add11"
        case .dom9: return "9"
        case .maj9: return "maj9"
        case .min9: return "m9"
        case .min11: return "m11"
        case .maj13: return "maj13"
        case .dom7Sharp9: return "7#9"
        case .dom7Flat9: return "7b9"
        case .dom7Alt: return "7alt"
        case .ogNine: return "9*"
        }
    }

    /// The basic triad family the chord belongs to, used when a joystick transformation
    /// needs to know whether the chord "feels" major or minor.
    public var family: TriadFamily {
        switch self {
        case .minor, .min7, .minMaj7, .minor6, .minorAdd9, .min9, .min11: return .minor
        case .diminished, .halfDim7, .dim7: return .diminished
        case .augmented, .aug7: return .augmented
        case .sus2, .sus4, .sus4Dom7, .power: return .suspended
        default: return .major
        }
    }

    /// Builds the triad that matches the given intervals of a third and fifth.
    static func triad(third: Int, fifth: Int) -> ChordType {
        switch (third, fifth) {
        case (3, 7): return .minor
        case (3, 6): return .diminished
        case (4, 8): return .augmented
        case (4, 7): return .major
        case (_, 6): return .diminished
        case (_, 8): return .augmented
        default: return third == 3 ? .minor : .major
        }
    }
}

public enum TriadFamily: Sendable { case major, minor, diminished, augmented, suspended }
