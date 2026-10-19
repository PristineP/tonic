import Foundation

/// A chord described by root, quality and optional slash bass.
public struct ChordSpec: Equatable, Sendable {
    public var root: PitchClass
    public var type: ChordType
    public var bass: PitchClass?

    public init(root: PitchClass, type: ChordType, bass: PitchClass? = nil) {
        self.root = mod12(root)
        self.type = type
        self.bass = bass.map(mod12)
    }

    public func name(preferFlats: Bool) -> String {
        var s = NoteNames.name(root, preferFlats: preferFlats) + type.suffix
        if let bass, bass != root {
            s += "/" + NoteNames.name(bass, preferFlats: preferFlats)
        }
        return s
    }
}

public enum BassMode: Int, CaseIterable, Codable, Sendable {
    case off, root, slash

    public var displayName: String {
        switch self {
        case .off: return "OFF"
        case .root: return "ROOT"
        case .slash: return "AUTO SLASH"
        }
    }
}

/// Everything that affects which chord a button produces.
public struct HarmonySettings: Codable, Equatable, Sendable {
    public var key: PitchClass = 0
    public var scale: Scale = .major
    /// Global octave shift, -2 ... +2.
    public var octave: Int = 0
    public var joystickMap: JoystickMap = .standard
    /// 0 = root position, 1-3 = inversions.
    public var inversion: Int = 0
    public var voiceLeading: Bool = false
    public var bassMode: BassMode = .off
    /// Per-button octave offsets, -2 ... +2.
    public var buttonOctaves: [Int] = Array(repeating: 0, count: 7)

    public init() {}

    /// Whether chord names in this key read better with flats.
    public var prefersFlats: Bool {
        // Find the relative major so minor/modal keys spell like their parent.
        let parent = scale.chordParent
        let majorOffset: Int
        switch parent {
        case Scale.minor.intervals, Scale.harmonicMinor.intervals, Scale.melodicMinor.intervals: majorOffset = 3
        case Scale.dorian.intervals: majorOffset = -2
        case Scale.mixolydian.intervals: majorOffset = 5
        case Scale.lydian.intervals: majorOffset = 7
        default: majorOffset = 0
        }
        let relMajor = mod12(key + majorOffset)
        return [1, 3, 5, 8, 10].contains(relMajor)
    }
}

/// Turns button presses and joystick directions into chords and voicings.
public enum ChordBuilder {
    /// The diatonic chord on a scale degree (0-6).
    public static func diatonic(degree: Int, settings: HarmonySettings) -> ChordSpec {
        diatonic(degree: degree, key: settings.key, scale: settings.scale)
    }

    static func diatonic(degree: Int, key: PitchClass, scale: Scale) -> ChordSpec {
        let s = scale.chordParent
        let d = ((degree % 7) + 7) % 7
        let root = s[d]
        let third = mod12(s[(d + 2) % 7] - root)
        let fifth = mod12(s[(d + 4) % 7] - root)
        let type = scale.defaultChordType(degree: d) ?? ChordType.triad(third: third, fifth: fifth)
        return ChordSpec(root: key + root, type: type)
    }

    /// Applies a joystick direction to the diatonic chord of a degree.
    public static func chord(degree: Int, direction: JoyDirection, settings: HarmonySettings) -> ChordSpec {
        let base = diatonic(degree: degree, settings: settings)
        return transform(base, degree: degree, direction: direction, settings: settings)
    }

    static func transform(_ base: ChordSpec, degree: Int, direction: JoyDirection, settings: HarmonySettings) -> ChordSpec {
        let family = base.type.family
        let r = base.root
        func on(_ t: ChordType) -> ChordSpec { ChordSpec(root: r, type: t) }
        func flipped() -> ChordType {
            switch family {
            case .major, .augmented, .suspended: return .minor
            case .minor, .diminished: return .major
            }
        }
        func seventh() -> ChordType {
            switch base.type {
            case .dom7: return .dom7 // blues I/IV/V stay dominant
            default: break
            }
            switch family {
            case .major, .suspended: return .maj7
            case .minor: return .min7
            case .diminished: return .halfDim7
            case .augmented: return .aug7
            }
        }
        func ninth() -> ChordType {
            switch family {
            case .major, .suspended, .augmented: return base.type == .dom7 ? .dom9 : .maj9
            case .minor: return .min9
            case .diminished: return .halfDim7
            }
        }

        if direction == .center { return base }

        switch settings.joystickMap {
        case .standard:
            switch direction {
            case .up: return on(flipped())
            case .upRight: return on(.dom7)
            case .right: return on(seventh())
            case .downRight: return on(ninth())
            case .down: return on(.sus4)
            case .downLeft: return on(family == .major || family == .augmented ? .six : .sus2)
            case .left: return on(family == .diminished ? .minor : .diminished)
            case .upLeft: return on(.augmented)
            case .center: return base
            }
        case .extended:
            switch direction {
            case .up: return on(.halfDim7)
            case .upRight: return on(.dom9)
            case .right: return on(.sus4Dom7)
            case .downRight: return on(.add11)
            case .down: return on(family == .minor || family == .diminished ? .minorAdd9 : .add9)
            case .downLeft: return on(.dom7Sharp9)
            case .left: return on(.min11)
            case .upLeft: return on(family == .minor || family == .diminished ? .min9 : .maj9)
            case .center: return base
            }
        case .chromatic:
            switch direction {
            case .up: return ChordSpec(root: r + 1, type: base.type)
            case .down: return ChordSpec(root: r - 1, type: base.type)
            case .upRight: return on(.minMaj7)
            case .right: return on(.maj13)
            case .downRight: return on(.dom7Flat9)
            case .downLeft: return on(.dom7Alt)
            case .left: return on(.sixNine)
            case .upLeft: return on(.halfDim7)
            case .center: return base
            }
        case .borrow:
            switch direction {
            case .up: return ChordSpec(root: r + 7, type: .dom7) // secondary dominant
            case .upRight: // same degree in the parallel major/minor
                return diatonic(degree: degree, key: settings.key, scale: settings.scale.parallel)
            case .right: return ChordSpec(root: r - 1, type: .major) // flat-side / Neapolitan major
            case .downRight: return ChordSpec(root: r - 1, type: .dim7) // passing diminished
            case .down: return ChordSpec(root: r + 6, type: .dom7) // tritone substitution
            case .downLeft: return ChordSpec(root: r - 2, type: .dom7) // backdoor dominant
            case .left: return on(.major) // borrowed major
            case .upLeft: return ChordSpec(root: r + 7, type: .sus4Dom7)
            case .center: return base
            }
        case .og:
            switch direction {
            case .up: return on(flipped())
            case .upRight: return on(.dom7)
            case .right: return on(seventh())
            case .downRight: return on(.ogNine)
            case .down: return on(.sus4)
            case .downLeft: return on(.sus2)
            case .left: return on(.diminished)
            case .upLeft: return on(.augmented)
            case .center: return base
            }
        }
    }

    /// MIDI note of the chord root before octave shifts. Roots stay within the octave
    /// starting at the key so progressions sit in one comfortable register.
    static func rootMidi(_ spec: ChordSpec, settings: HarmonySettings) -> Int {
        let keyRoot = 48 + settings.key // C3 ... B3
        return keyRoot + mod12(spec.root - settings.key)
    }

    /// Voices a chord into MIDI notes.
    /// - Parameters:
    ///   - previous: the last voicing played, used for voice leading.
    ///   - inversionOverride: inversion to use instead of the global one.
    public static func voicing(
        _ spec: ChordSpec,
        degree: Int,
        settings: HarmonySettings,
        previous: [Int]? = nil,
        inversionOverride: Int? = nil
    ) -> Voicing {
        let octaveShift = 12 * (settings.octave + (settings.buttonOctaves.indices.contains(degree) ? settings.buttonOctaves[degree] : 0))
        let root = rootMidi(spec, settings: settings) + octaveShift
        var notes = spec.type.intervals.map { root + $0 }

        if settings.voiceLeading, let previous, !previous.isEmpty {
            notes = leadVoices(notes, from: previous)
        } else {
            let inv = inversionOverride ?? settings.inversion
            notes = invert(notes, times: inv)
        }

        var bass: Int?
        switch settings.bassMode {
        case .off: break
        case .root: bass = bassNote(spec.bass ?? spec.root, below: notes.min() ?? root)
        case .slash:
            // Auto slash: the bass follows the lowest chord tone, giving smooth inverted bass lines.
            let pc = spec.bass ?? mod12(notes.min() ?? root)
            bass = bassNote(pc, below: notes.min() ?? root)
        }
        if spec.bass != nil, settings.bassMode == .off {
            bass = bassNote(spec.bass!, below: notes.min() ?? root)
        }
        return Voicing(notes: notes.map(clampMidi), bass: bass.map(clampMidi))
    }

    static func clampMidi(_ n: Int) -> Int {
        var n = n
        while n < 12 { n += 12 }
        while n > 115 { n -= 12 }
        return n
    }

    /// The bass pitch class placed one to two octaves below the chord.
    static func bassNote(_ pc: PitchClass, below lowest: Int) -> Int {
        var b = lowest - 12
        b -= mod12(b - pc)
        if lowest - b < 12 { b -= 12 }
        return b
    }

    /// Moves the lowest notes up an octave `times` times.
    public static func invert(_ notes: [Int], times: Int) -> [Int] {
        guard !notes.isEmpty, times > 0 else { return notes }
        var n = notes.sorted()
        for _ in 0..<(times % n.count) {
            let low = n.removeFirst()
            n.append(low + 12)
        }
        return n
    }

    /// Picks the inversion and octave of `notes` closest to the previous voicing.
    static func leadVoices(_ notes: [Int], from previous: [Int]) -> [Int] {
        let target = Double(previous.reduce(0, +)) / Double(previous.count)
        var best = notes
        var bestScore = Double.infinity
        for inv in 0..<notes.count {
            let inverted = invert(notes, times: inv)
            for shift in [-24, -12, 0, 12] {
                let cand = inverted.map { $0 + shift }
                guard let lo = cand.first, let hi = cand.last, lo >= 40, hi <= 88 else { continue }
                let centroid = Double(cand.reduce(0, +)) / Double(cand.count)
                // Prefer small centroid motion, then small top-voice motion.
                let topMove = Double(abs(hi - (previous.max() ?? hi)))
                let score = abs(centroid - target) * 2 + topMove * 0.5
                if score < bestScore { bestScore = score; best = cand }
            }
        }
        return best
    }
}

public struct Voicing: Equatable, Sendable {
    public var notes: [Int]
    public var bass: Int?

    public var allNotes: [Int] { (bass.map { [$0] } ?? []) + notes }
}
