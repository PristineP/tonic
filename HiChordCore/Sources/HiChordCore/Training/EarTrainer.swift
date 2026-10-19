import Foundation

/// Ear-training game: HiChord plays the key's tonic for reference, then a mystery
/// note or chord; the player answers with the matching chord button.
public struct EarTrainer: Sendable {
    public enum Level: Int, CaseIterable, Codable, Sendable {
        case notes, intervals, triads, sevenths, inversions, altered

        public var displayName: String {
            switch self {
            case .notes: return "LV1 NOTES"
            case .intervals: return "LV2 INTERV"
            case .triads: return "LV3 CHORDS"
            case .sevenths: return "LV4 7THS"
            case .inversions: return "LV5 INVERT"
            case .altered: return "LV6 COLOR"
            }
        }
    }

    public struct Question: Equatable, Sendable {
        /// The degree (0-6) that answers the question.
        public var answer: Int
        /// Notes to play as the reference (tonic).
        public var reference: [Int]
        /// Notes to play as the question.
        public var prompt: [Int]
        /// Whether `prompt` should be played one note at a time.
        public var melodic: Bool
    }

    public var level: Level = .notes
    public private(set) var score = 0
    public private(set) var attempts = 0
    public private(set) var streak = 0
    public private(set) var current: Question?
    private var rng: UInt64

    public init(seed: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000)) {
        rng = seed | 1
    }

    private mutating func random(_ n: Int) -> Int {
        rng ^= rng << 13
        rng ^= rng >> 7
        rng ^= rng << 17
        return Int(rng % UInt64(max(n, 1)))
    }

    public mutating func next(settings: HarmonySettings) -> Question {
        var degree = random(7)
        if let previous = current?.answer, degree == previous { degree = (degree + 1 + random(6)) % 7 }
        var s = settings
        s.voiceLeading = false
        s.bassMode = .off
        s.octave = 0
        s.buttonOctaves = Array(repeating: 0, count: 7)
        s.inversion = 0
        let tonic = ChordBuilder.voicing(ChordBuilder.diatonic(degree: 0, settings: s), degree: 0, settings: s).notes
        let keyRoot = 60 + s.key - (s.key > 6 ? 12 : 0)
        let q: Question
        switch level {
        case .notes:
            let note = keyRoot + s.scale.chordParent[degree]
            q = Question(answer: degree, reference: tonic, prompt: [note], melodic: false)
        case .intervals:
            let note = keyRoot + s.scale.chordParent[degree]
            q = Question(answer: degree, reference: [keyRoot], prompt: [keyRoot, note], melodic: true)
        case .triads:
            let v = ChordBuilder.voicing(ChordBuilder.diatonic(degree: degree, settings: s), degree: degree, settings: s)
            q = Question(answer: degree, reference: tonic, prompt: v.notes, melodic: false)
        case .sevenths:
            let spec = ChordBuilder.chord(degree: degree, direction: .right, settings: s)
            let v = ChordBuilder.voicing(spec, degree: degree, settings: s)
            q = Question(answer: degree, reference: tonic, prompt: v.notes, melodic: false)
        case .inversions:
            let v = ChordBuilder.voicing(ChordBuilder.diatonic(degree: degree, settings: s), degree: degree, settings: s,
                                         inversionOverride: 1 + random(2))
            q = Question(answer: degree, reference: tonic, prompt: v.notes, melodic: false)
        case .altered:
            let dirs: [JoyDirection] = [.upRight, .right, .downRight, .down, .downLeft]
            let spec = ChordBuilder.chord(degree: degree, direction: dirs[random(dirs.count)], settings: s)
            let v = ChordBuilder.voicing(spec, degree: degree, settings: s)
            q = Question(answer: degree, reference: tonic, prompt: v.notes, melodic: false)
        }
        current = q
        return q
    }

    /// Returns whether the answer was correct. A wrong answer keeps the question.
    @discardableResult
    public mutating func answer(_ degree: Int) -> Bool {
        guard let q = current else { return false }
        attempts += 1
        if degree == q.answer {
            score += 1
            streak += 1
            return true
        }
        streak = 0
        return false
    }

    public mutating func reset() {
        score = 0
        attempts = 0
        streak = 0
        current = nil
    }
}
