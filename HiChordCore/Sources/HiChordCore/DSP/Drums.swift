import Foundation

/// Synthesised drum instrument types.
public enum DrumSound: Int32, Sendable {
    case kick, snare, closedHat, openHat, clap, tom, rim, cowbell, shaker
}

/// Parameters for one drum pad in a kit.
public struct DrumPad: Sendable {
    public var sound: DrumSound
    public var tune: Float     // base frequency multiplier
    public var decay: Float    // seconds
    public var tone: Float     // 0...1 sound-specific colour
    public var level: Float

    public init(_ sound: DrumSound, tune: Float = 1, decay: Float, tone: Float = 0.5, level: Float = 1) {
        self.sound = sound; self.tune = tune; self.decay = decay; self.tone = tone; self.level = level
    }
}

/// Drum kits. Pads are ordered: kick, snare, closed hat, open hat, clap, tom, percussion.
public enum DrumKit: Int, CaseIterable, Codable, Sendable {
    case tight, x0x, x9x, lynn, kr78, trap, lofi

    public var displayName: String {
        switch self {
        case .tight: return "TIGHT KIT"
        case .x0x: return "X0X BOX"
        case .x9x: return "X9X BOX"
        case .lynn: return "LYNN KIT"
        case .kr78: return "KR-78"
        case .trap: return "TRAP BOX"
        case .lofi: return "LOFI KIT"
        }
    }

    public static let padNames = ["KICK", "SNARE", "C.HAT", "O.HAT", "CLAP", "TOM", "PERC"]
    /// General MIDI notes for the seven pads.
    public static let gmNotes: [UInt8] = [36, 38, 42, 46, 39, 45, 37]

    public var pads: [DrumPad] {
        switch self {
        case .tight:
            return [DrumPad(.kick, tune: 1.0, decay: 0.28, tone: 0.6), DrumPad(.snare, tune: 1.1, decay: 0.16, tone: 0.6),
                    DrumPad(.closedHat, decay: 0.045, tone: 0.7, level: 0.7), DrumPad(.openHat, decay: 0.3, tone: 0.7, level: 0.6),
                    DrumPad(.clap, decay: 0.14, level: 0.8), DrumPad(.tom, tune: 1.0, decay: 0.25), DrumPad(.rim, decay: 0.04, level: 0.7)]
        case .x0x:
            return [DrumPad(.kick, tune: 0.82, decay: 0.75, tone: 0.2), DrumPad(.snare, tune: 0.95, decay: 0.2, tone: 0.45),
                    DrumPad(.closedHat, decay: 0.05, tone: 0.5, level: 0.65), DrumPad(.openHat, decay: 0.45, tone: 0.5, level: 0.55),
                    DrumPad(.clap, decay: 0.2, level: 0.85), DrumPad(.tom, tune: 0.8, decay: 0.4), DrumPad(.cowbell, decay: 0.25, level: 0.5)]
        case .x9x:
            return [DrumPad(.kick, tune: 1.05, decay: 0.42, tone: 0.8), DrumPad(.snare, tune: 1.0, decay: 0.22, tone: 0.75),
                    DrumPad(.closedHat, decay: 0.06, tone: 0.9, level: 0.7), DrumPad(.openHat, decay: 0.5, tone: 0.9, level: 0.6),
                    DrumPad(.clap, decay: 0.24, level: 0.85), DrumPad(.tom, tune: 1.2, decay: 0.3), DrumPad(.rim, tune: 1.2, decay: 0.05, level: 0.7)]
        case .lynn:
            return [DrumPad(.kick, tune: 1.15, decay: 0.22, tone: 0.9), DrumPad(.snare, tune: 1.25, decay: 0.18, tone: 0.85),
                    DrumPad(.closedHat, decay: 0.035, tone: 1.0, level: 0.65), DrumPad(.openHat, decay: 0.28, tone: 1.0, level: 0.55),
                    DrumPad(.clap, decay: 0.12, level: 0.8), DrumPad(.tom, tune: 1.4, decay: 0.22), DrumPad(.cowbell, tune: 1.1, decay: 0.18, level: 0.5)]
        case .kr78:
            return [DrumPad(.kick, tune: 1.25, decay: 0.16, tone: 0.1), DrumPad(.snare, tune: 1.5, decay: 0.09, tone: 0.3),
                    DrumPad(.closedHat, decay: 0.025, tone: 0.3, level: 0.6), DrumPad(.openHat, decay: 0.18, tone: 0.3, level: 0.5),
                    DrumPad(.clap, decay: 0.08, level: 0.7), DrumPad(.tom, tune: 1.6, decay: 0.16), DrumPad(.shaker, decay: 0.07, level: 0.6)]
        case .trap:
            return [DrumPad(.kick, tune: 0.7, decay: 1.4, tone: 0.3), DrumPad(.snare, tune: 1.1, decay: 0.18, tone: 0.9),
                    DrumPad(.closedHat, decay: 0.03, tone: 0.8, level: 0.6), DrumPad(.openHat, decay: 0.35, tone: 0.8, level: 0.55),
                    DrumPad(.clap, decay: 0.22, level: 0.9), DrumPad(.tom, tune: 0.9, decay: 0.5), DrumPad(.rim, tune: 0.9, decay: 0.04, level: 0.6)]
        case .lofi:
            return [DrumPad(.kick, tune: 0.95, decay: 0.3, tone: 0.3), DrumPad(.snare, tune: 0.85, decay: 0.15, tone: 0.3),
                    DrumPad(.closedHat, decay: 0.04, tone: 0.2, level: 0.55), DrumPad(.openHat, decay: 0.22, tone: 0.2, level: 0.45),
                    DrumPad(.clap, decay: 0.12, level: 0.7), DrumPad(.tom, tune: 0.9, decay: 0.28), DrumPad(.shaker, decay: 0.09, level: 0.55)]
        }
    }
}

/// One sounding drum hit.
struct DrumVoice {
    var active = false
    var owner: Int32 = -1
    var pad: Int32 = 0
    var sound: DrumSound = .kick
    var tune: Float = 1
    var decay: Float = 0.2
    var tone: Float = 0.5
    var level: Float = 1
    var t: Int = 0
    var delay: Int = 0
    var phase: Float = 0
    var phases: (Float, Float, Float, Float, Float, Float) = (0, 0, 0, 0, 0, 0)
    var rng: UInt32 = 12345
    var bp = SVF()
    var hp = OnePole()
    var env: Float = 1
    var choke = false

    mutating func start(_ p: DrumPad, pad: Int, velocity: Float, owner: Int32, delay: Int, seed: UInt32, sampleRate sr: Float) {
        active = true
        self.owner = owner
        self.pad = Int32(pad)
        sound = p.sound
        tune = p.tune
        decay = p.decay
        tone = p.tone
        level = p.level * (0.3 + 0.7 * velocity)
        t = 0
        self.delay = delay
        phase = 0
        phases = (0, 0.13, 0.29, 0.41, 0.57, 0.73)
        rng = seed | 1
        bp.reset()
        hp.z = 0
        env = 1
        choke = false
        switch sound {
        case .closedHat, .openHat:
            bp.set(cutoff: 7000 + 4000 * tone, q: 1.2, sampleRate: sr)
            hp.set(cutoff: 6000, sampleRate: sr)
        case .snare:
            hp.set(cutoff: 1500 + 2500 * tone, sampleRate: sr)
        case .clap:
            bp.set(cutoff: 1100 * tune, q: 2.5, sampleRate: sr)
        case .rim:
            bp.set(cutoff: 1700 * tune, q: 4, sampleRate: sr)
        case .cowbell:
            bp.set(cutoff: 800 * tune, q: 3, sampleRate: sr)
        case .shaker:
            hp.set(cutoff: 5000, sampleRate: sr)
        default:
            break
        }
    }

    mutating func render(frames: Int, sampleRate sr: Float, left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>,
                         table: UnsafeMutablePointer<Float>, gain: Float) {
        guard active else { return }
        var start = 0
        if delay > 0 {
            if delay >= frames { delay -= frames; return }
            start = delay
            delay = 0
        }
        let invSr = 1 / sr
        let ampK = decayCoef(decay, sr)
        let chokeK = decayCoef(0.01, sr)
        let g = level * gain
        for i in start..<frames {
            let time = Float(t) * invSr
            var s: Float = 0
            switch sound {
            case .kick:
                let pitchEnv = Float(exp(-Double(time) / 0.035))
                let f = 48 * tune * (1 + 3.2 * pitchEnv)
                phase += f * invSr
                if phase >= 1 { phase -= 1 }
                s = sin01(phase, table) * env
                // click
                if t < Int(0.004 * sr) { s += whiteNoise(&rng) * 0.35 * tone * (1 - time / 0.004) }
                s = s * 1.4 / (1 + abs(s * 0.4)) // gentle saturation
            case .snare:
                let f = 185 * tune
                phase += f * invSr
                if phase >= 1 { phase -= 1 }
                let body = sin01(phase, table) * Float(exp(-Double(time) / 0.05))
                let noise = hp.highpass(whiteNoise(&rng))
                s = (body * (1 - 0.5 * tone) + noise * (0.5 + 0.5 * tone) * 1.3) * env
            case .closedHat, .openHat:
                let base: Float = 100 * (0.9 + 0.2 * tone)
                let ratios: (Float, Float, Float, Float, Float, Float) = (2, 3, 4.16, 5.43, 6.79, 8.21)
                var sum: Float = 0
                phases.0 += base * ratios.0 * invSr; phases.0 -= phases.0.rounded(.down); sum += phases.0 < 0.5 ? 1 : -1
                phases.1 += base * ratios.1 * invSr; phases.1 -= phases.1.rounded(.down); sum += phases.1 < 0.5 ? 1 : -1
                phases.2 += base * ratios.2 * invSr; phases.2 -= phases.2.rounded(.down); sum += phases.2 < 0.5 ? 1 : -1
                phases.3 += base * ratios.3 * invSr; phases.3 -= phases.3.rounded(.down); sum += phases.3 < 0.5 ? 1 : -1
                phases.4 += base * ratios.4 * invSr; phases.4 -= phases.4.rounded(.down); sum += phases.4 < 0.5 ? 1 : -1
                phases.5 += base * ratios.5 * invSr; phases.5 -= phases.5.rounded(.down); sum += phases.5 < 0.5 ? 1 : -1
                let metal = bp.process(sum * 0.2 + whiteNoise(&rng) * 0.25).band
                s = hp.highpass(metal) * 2.2 * env
            case .clap:
                // Three quick bursts followed by a tail.
                let burst: Float
                if time < 0.03 {
                    let local = time.truncatingRemainder(dividingBy: 0.01)
                    burst = Float(exp(-Double(local) / 0.002))
                } else {
                    burst = env
                }
                s = bp.process(whiteNoise(&rng)).band * burst * 2.4
            case .tom:
                let pitchEnv = Float(exp(-Double(time) / 0.06))
                let f = 110 * tune * (1 + 0.6 * pitchEnv)
                phase += f * invSr
                if phase >= 1 { phase -= 1 }
                s = sin01(phase, table) * env
            case .rim:
                phase += 520 * tune * invSr
                if phase >= 1 { phase -= 1 }
                s = (sin01(phase, table) * 0.6 + bp.process(whiteNoise(&rng)).band * 1.5) * env
            case .cowbell:
                phase += 540 * tune * invSr
                if phase >= 1 { phase -= 1 }
                phases.0 += 800 * tune * invSr
                if phases.0 >= 1 { phases.0 -= 1 }
                let sq = (phase < 0.5 ? 0.5 : -0.5) + (phases.0 < 0.5 ? 0.5 : -0.5)
                s = bp.process(Float(sq)).band * 1.6 * env
            case .shaker:
                let attack = min(1, time / 0.008)
                s = hp.highpass(whiteNoise(&rng)) * env * attack * 0.9
            }
            env *= choke ? chokeK : ampK
            t += 1
            let out = s * g
            left[i] += out
            right[i] += out
            if env < 0.0003 || t > Int(4 * sr) { active = false; break }
        }
    }
}

/// Built-in beat patterns: seven styles with eight variations each.
public enum BeatStyle: Int, CaseIterable, Codable, Sendable {
    case rock, breakbeat, dub, funk, house, dembow, swing

    public var displayName: String {
        switch self {
        case .rock: return "ROCK"
        case .breakbeat: return "BREAK"
        case .dub: return "DUB"
        case .funk: return "FUNK"
        case .house: return "HOUSE"
        case .dembow: return "DEMBOW"
        case .swing: return "SWING"
        }
    }

    /// 0 ... 1 shuffle applied to off-beat 8ths (1 = triplet feel).
    public var swing: Float {
        switch self {
        case .swing: return 1
        case .funk: return 0.25
        case .breakbeat: return 0.15
        default: return 0
        }
    }

    /// Pattern rows are 16 steps per bar. Pad rows: K kick, S snare, H closed hat, O open hat, C clap, T tom, P perc.
    /// "X" accent, "x" normal, "g" ghost.
    var basePatterns: (a: [Character: String], b: [Character: String]) {
        switch self {
        case .rock:
            return (["K": "x.......x.x.....", "S": "....X.......X...", "H": "x.x.x.x.x.x.x.x."],
                    ["K": "x......xx.x.....", "S": "....X.......X..g", "H": "x.x.x.x.x.x.x.o."])
        case .breakbeat:
            return (["K": "x.x.......xx....", "S": "....X..g.g..X..g", "H": "x.x.x.x.x.x.x.x."],
                    ["K": "x......x..x.....", "S": "....X.......X...", "H": "x.xxx.x.x.xxx.x."])
        case .dub:
            return (["K": "........X.......", "P": "........x.......", "H": "x.x.x.x.x.x.x.x."],
                    ["K": "x...x...x...x...", "S": "........X.......", "H": "..x...x...x...x."])
        case .funk:
            return (["K": "x..x..x...x.....", "S": "....X..g.g.gX...", "H": "xxxxxxxxxxxxxxxx"],
                    ["K": "x.....x.x.....x.", "S": "....X..g....X...", "H": "x.x.x.x.x.x.x.o."])
        case .house:
            return (["K": "X...X...X...X...", "C": "....x.......x...", "O": "..x...x...x...x.", "H": "x...x...x...x..."],
                    ["K": "X...X...X...X...", "C": "....x.......x...", "O": "..x...x...x...x.", "P": "xxxxxxxxxxxxxxxx"])
        case .dembow:
            return (["K": "X...X...X...X...", "S": "...x..x....x..x.", "H": "x.x.x.x.x.x.x.x."],
                    ["K": "X...X...X...X...", "S": "...x..x....x..x.", "C": "...x..x....x..x.", "P": "x.xxx.xxx.xxx.xx"])
        case .swing:
            return (["O": "x...x.x.x...x.x.", "H": "....x.......x...", "K": "x.......x......."],
                    ["O": "x...x.x.x...x.x.", "H": "....x.......x...", "S": "......g.......g.", "K": "x.........x....."])
        }
    }
}

/// Flattened pattern table: [style][variation][step][pad] -> velocity (0 = silent).
struct BeatTable {
    static let variations = 8
    static let steps = 16
    static let pads = 7

    let data: UnsafeMutablePointer<Float>

    init() {
        let count = BeatStyle.allCases.count * BeatTable.variations * BeatTable.steps * BeatTable.pads
        data = .allocate(capacity: count)
        data.initialize(repeating: 0, count: count)
        for style in BeatStyle.allCases {
            let (a, b) = style.basePatterns
            for v in 0..<BeatTable.variations {
                var rows = (v % 2 == 0 || v == 7) ? a : b
                switch v {
                case 2: // busier hats
                    if let h = rows["H"], style != .funk { rows["H"] = String(h.map { $0 == "." ? "g" : $0 }) }
                case 3: // ghost snares
                    rows["S"] = BeatTable.overlay(rows["S"] ?? String(repeating: ".", count: 16), "......g.......g.")
                case 4: // open hat lift
                    rows["O"] = BeatTable.overlay(rows["O"] ?? String(repeating: ".", count: 16), "..............x.")
                case 5: // clap layer
                    rows["C"] = BeatTable.overlay(rows["C"] ?? String(repeating: ".", count: 16), "....x.......x...")
                case 6: // syncopated kick
                    rows["K"] = BeatTable.overlay(rows["K"] ?? String(repeating: ".", count: 16), "...........x..x.")
                case 7: // fill on the last beat
                    rows["S"] = BeatTable.overlay(String((rows["S"] ?? String(repeating: ".", count: 16)).prefix(12)) + "....", "............xgxX")
                    rows["T"] = "............x.x."
                default: break
                }
                for (key, row) in rows {
                    guard let pad = BeatTable.padIndex(key) else { continue }
                    for (step, ch) in row.enumerated() where step < BeatTable.steps {
                        var vel: Float
                        switch ch {
                        case "X": vel = 1
                        case "x": vel = 0.78
                        case "g": vel = 0.32
                        case "o": vel = 0.8
                        default: vel = 0
                        }
                        guard vel > 0 else { continue }
                        // "o" in a hat row means open hat
                        let targetPad = (ch == "o" && key == "H") ? 3 : pad
                        data[BeatTable.index(style: style.rawValue, variation: v, step: step, pad: targetPad)] = vel
                    }
                }
            }
        }
    }

    static func overlay(_ base: String, _ add: String) -> String {
        String(zip(base, add).map { $1 == "." ? $0 : $1 })
    }

    static func padIndex(_ key: Character) -> Int? {
        switch key {
        case "K": return 0
        case "S": return 1
        case "H": return 2
        case "O": return 3
        case "C": return 4
        case "T": return 5
        case "P": return 6
        default: return nil
        }
    }

    @inline(__always) static func index(style: Int, variation: Int, step: Int, pad: Int) -> Int {
        ((style * variations + variation) * steps + step) * pads + pad
    }

    @inline(__always) func velocity(style: Int, variation: Int, step: Int, pad: Int) -> Float {
        data[BeatTable.index(style: style, variation: variation, step: step, pad: pad)]
    }
}
