import Foundation

/// Chord Rush: a rhythm game. Chords scroll toward a hit line in time with a backing beat;
/// press the matching chord key on the downbeat.
public struct ChordRush: Sendable {
    public struct Song: Sendable {
        public let name: String
        /// Scale degrees (0-6), one per bar.
        public let degrees: [Int]
        public let style: BeatStyle
    }

    public enum Judgement: Equatable, Sendable {
        case perfect, good, miss
        public var points: Int { self == .perfect ? 100 : (self == .good ? 50 : 0) }
        public var label: String { self == .perfect ? "PERFECT" : (self == .good ? "GOOD" : "MISS") }
    }

    public enum Phase: Equatable, Sendable { case idle, waiting, playing, done }

    public static let songs: [Song] = [
        Song(name: "POP 1-5-6-4", degrees: [0, 4, 5, 3, 0, 4, 5, 3], style: .rock),
        Song(name: "DOO-WOP", degrees: [0, 5, 3, 4, 0, 5, 3, 4], style: .swing),
        Song(name: "CANON", degrees: [0, 4, 5, 2, 3, 0, 3, 4], style: .breakbeat),
        Song(name: "JAZZ 2-5-1", degrees: [1, 4, 0, 0, 1, 4, 0, 5], style: .swing),
        Song(name: "EPIC 6-4-1-5", degrees: [5, 3, 0, 4, 5, 3, 0, 4], style: .house),
        Song(name: "12 BAR BLUES", degrees: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], style: .funk),
    ]

    /// Beats per chord.
    public static let beatsPerChord: Double = 4
    public static let perfectWindow: Double = 0.15
    public static let goodWindow: Double = 0.4

    public var songIndex = 0
    public private(set) var phase: Phase = .idle
    public private(set) var startBeat: Double = 0
    public private(set) var results: [Judgement?] = []
    public private(set) var score = 0
    public private(set) var combo = 0
    public private(set) var bestCombo = 0
    public private(set) var lastJudgement: Judgement?

    public init() {}

    public var song: Song { ChordRush.songs[songIndex % ChordRush.songs.count] }

    public func targetBeat(_ i: Int) -> Double { startBeat + Double(i) * ChordRush.beatsPerChord }

    /// Arms the game; call `begin(atBeat:)` once the backing beat is running.
    public mutating func arm() {
        phase = .waiting
        results = Array(repeating: nil, count: song.degrees.count)
        score = 0
        combo = 0
        bestCombo = 0
        lastJudgement = nil
    }

    /// Starts the song with one bar of lead-in after `beat`.
    public mutating func begin(atBeat beat: Double) {
        guard phase == .waiting else { return }
        startBeat = ((beat / ChordRush.beatsPerChord).rounded(.down) + 2) * ChordRush.beatsPerChord
        phase = .playing
    }

    public mutating func stop() { phase = .idle }

    /// Judges a key press. Returns nil when the press is not near any chord.
    @discardableResult
    public mutating func press(degree: Int, atBeat beat: Double) -> Judgement? {
        guard phase == .playing else { return nil }
        let i = Int(((beat - startBeat) / ChordRush.beatsPerChord).rounded())
        guard results.indices.contains(i), results[i] == nil else { return nil }
        let dt = abs(beat - targetBeat(i))
        guard dt <= ChordRush.goodWindow else { return nil }
        let j: Judgement = degree != song.degrees[i] ? .miss : (dt <= ChordRush.perfectWindow ? .perfect : .good)
        record(i, j)
        return j
    }

    /// Marks chords that passed without a press as misses and ends the song. Returns new misses.
    @discardableResult
    public mutating func advance(toBeat beat: Double) -> Int {
        guard phase == .playing else { return 0 }
        var missed = 0
        for i in results.indices where results[i] == nil && beat > targetBeat(i) + ChordRush.goodWindow {
            record(i, .miss)
            missed += 1
        }
        if beat > targetBeat(results.count - 1) + ChordRush.beatsPerChord * 0.5 { phase = .done }
        return missed
    }

    private mutating func record(_ i: Int, _ j: Judgement) {
        results[i] = j
        lastJudgement = j
        score += j.points + (j == .miss ? 0 : min(combo, 10) * 5)
        combo = j == .miss ? 0 : combo + 1
        bestCombo = max(bestCombo, combo)
    }

    public var maxScore: Int {
        let n = song.degrees.count
        return (0..<n).reduce(0) { $0 + 100 + min($1, 10) * 5 }
    }

    public var grade: String {
        let pct = maxScore > 0 ? Double(score) / Double(maxScore) : 0
        switch pct {
        case 0.95...: return "S"
        case 0.85...: return "A"
        case 0.7...: return "B"
        case 0.5...: return "C"
        default: return "D"
        }
    }
}
