import Foundation

public enum ReverbType: Int32, CaseIterable, Codable, Sendable {
    case off, room, hall, plate, spring, ambient
    public var displayName: String { ["OFF", "ROOM", "HALL", "PLATE", "SPRING", "AMBIENT"][Int(rawValue)] }
}

public enum DelayTime: Int32, CaseIterable, Codable, Sendable {
    case off, quarter, eighth, dottedEighth, eighthTriplet, sixteenth
    public var displayName: String { ["OFF", "1/4", "1/8", "1/8.", "1/8T", "1/16"][Int(rawValue)] }
    var beats: Float {
        switch self {
        case .off: return 0
        case .quarter: return 1
        case .eighth: return 0.5
        case .dottedEighth: return 0.75
        case .eighthTriplet: return 1.0 / 3.0
        case .sixteenth: return 0.25
        }
    }
}

public enum ModType: Int32, CaseIterable, Codable, Sendable {
    case off, chorus, wideChorus, flanger, jet
    public var displayName: String { ["OFF", "CHORUS", "WIDE CHO", "FLANGER", "JET FLNG"][Int(rawValue)] }
}

public enum DriveType: Int32, CaseIterable, Codable, Sendable {
    case off, tube, drive, distortion, fuzz
    public var displayName: String { ["OFF", "TUBE", "DRIVE", "DISTORT", "FUZZ"][Int(rawValue)] }
}

public enum LofiType: Int32, CaseIterable, Codable, Sendable {
    case off, lofi, vinyl, tape
    public var displayName: String { ["OFF", "LO-FI", "VINYL", "TAPE"][Int(rawValue)] }
}

public enum TremoloRate: Int32, CaseIterable, Codable, Sendable {
    case off, half, quarter, eighth, sixteenth
    public var displayName: String { ["OFF", "1/2", "1/4", "1/8", "1/16"][Int(rawValue)] }
    var beats: Float {
        switch self {
        case .off: return 0
        case .half: return 2
        case .quarter: return 1
        case .eighth: return 0.5
        case .sixteenth: return 0.25
        }
    }
}

/// Master effect settings (POD).
public struct FXParams: Equatable, Codable, Sendable {
    public var reverb: ReverbType = .room
    public var reverbMix: Float = 0.22
    public var delay: DelayTime = .off
    public var delayFeedback: Float = 0.35
    public var delayMix: Float = 0.25
    public var mod: ModType = .off
    public var tremolo: TremoloRate = .off
    public var tremoloDepth: Float = 0.6
    public var drive: DriveType = .off
    public var lofi: LofiType = .off
    /// 0 = mono, 1 = wide.
    public var spread: Float = 0.6
    public init() {}
}

/// Freeverb-style stereo reverb.
struct Reverb {
    private static let combTuning = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
    private static let allpassTuning = [556, 441, 341, 225]
    private static let stereoSpread = 23

    private var combBuf: [UnsafeMutablePointer<Float>] = []
    private var combLen: [Int] = []
    private var combIdx: [Int] = []
    private var combStore: [Float] = []
    private var apBuf: [UnsafeMutablePointer<Float>] = []
    private var apLen: [Int] = []
    private var apIdx: [Int] = []
    private var feedback: Float = 0.84
    private var damp: Float = 0.2

    init(maxSampleRate: Float) {
        let scale = maxSampleRate / 44100
        for ch in 0..<2 {
            for t in Reverb.combTuning {
                let len = Int(Float(t + ch * Reverb.stereoSpread) * scale) + 1
                let p = UnsafeMutablePointer<Float>.allocate(capacity: len)
                p.initialize(repeating: 0, count: len)
                combBuf.append(p); combLen.append(len); combIdx.append(0); combStore.append(0)
            }
            for t in Reverb.allpassTuning {
                let len = Int(Float(t + ch * Reverb.stereoSpread) * scale) + 1
                let p = UnsafeMutablePointer<Float>.allocate(capacity: len)
                p.initialize(repeating: 0, count: len)
                apBuf.append(p); apLen.append(len); apIdx.append(0)
            }
        }
    }

    /// Recomputes active delay lengths for the current sample rate (buffers are sized for the max).
    mutating func configure(sampleRate: Float) {
        let scale = sampleRate / 44100
        for ch in 0..<2 {
            for (i, t) in Reverb.combTuning.enumerated() {
                let idx = ch * 8 + i
                let cap = Int(Float(t + ch * Reverb.stereoSpread) * scale) + 1
                combLen[idx] = max(1, cap)
                combIdx[idx] = 0
            }
            for (i, t) in Reverb.allpassTuning.enumerated() {
                let idx = ch * 4 + i
                apLen[idx] = max(1, Int(Float(t + ch * Reverb.stereoSpread) * scale) + 1)
                apIdx[idx] = 0
            }
        }
    }

    mutating func set(type: ReverbType) {
        switch type {
        case .off, .room: feedback = 0.78; damp = 0.35
        case .hall: feedback = 0.88; damp = 0.25
        case .plate: feedback = 0.86; damp = 0.08
        case .spring: feedback = 0.82; damp = 0.5
        case .ambient: feedback = 0.94; damp = 0.3
        }
    }

    mutating func clear() {
        for i in 0..<combBuf.count { combBuf[i].update(repeating: 0, count: combLen[i]); combStore[i] = 0 }
        for i in 0..<apBuf.count { apBuf[i].update(repeating: 0, count: apLen[i]) }
    }

    @inline(__always) mutating func process(_ inL: Float, _ inR: Float) -> (Float, Float) {
        let input = (inL + inR) * 0.015
        var out: (Float, Float) = (0, 0)
        for ch in 0..<2 {
            var acc: Float = 0
            for c in 0..<8 {
                let i = ch * 8 + c
                let buf = combBuf[i]
                let idx = combIdx[i]
                let y = buf[idx]
                combStore[i] = y * (1 - damp) + combStore[i] * damp
                buf[idx] = input + combStore[i] * feedback
                combIdx[i] = idx + 1 >= combLen[i] ? 0 : idx + 1
                acc += y
            }
            for a in 0..<4 {
                let i = ch * 4 + a
                let buf = apBuf[i]
                let idx = apIdx[i]
                let b = buf[idx]
                buf[idx] = acc + b * 0.5
                acc = b - acc
                apIdx[i] = idx + 1 >= apLen[i] ? 0 : idx + 1
            }
            if ch == 0 { out.0 = acc } else { out.1 = acc }
        }
        return out
    }
}

/// A simple circular stereo delay line with fractional reads.
struct DelayLine {
    let buf: UnsafeMutablePointer<Float>
    let capacity: Int
    var write = 0

    init(capacity: Int) {
        self.capacity = capacity
        buf = .allocate(capacity: capacity)
        buf.initialize(repeating: 0, count: capacity)
    }

    @inline(__always) mutating func push(_ x: Float) {
        buf[write] = x
        write += 1
        if write >= capacity { write = 0 }
    }

    /// Reads `delay` samples behind the most recent write.
    @inline(__always) func read(_ delay: Float) -> Float {
        let d = min(max(delay, 1), Float(capacity - 2))
        var pos = Float(write) - d
        if pos < 0 { pos += Float(capacity) }
        let i0 = Int(pos)
        let frac = pos - Float(i0)
        let i1 = i0 + 1 >= capacity ? 0 : i0 + 1
        return buf[i0] + (buf[i1] - buf[i0]) * frac
    }

    func clear() { buf.update(repeating: 0, count: capacity) }
}

/// The master effects chain: drive -> lo-fi -> chorus/flanger -> tremolo -> delay -> reverb -> width.
struct EffectsChain {
    var params = FXParams()
    var sampleRate: Float = 48000
    var bpm: Float = 100

    private var reverb: Reverb
    private var delayL: DelayLine
    private var delayR: DelayLine
    private var modL: DelayLine
    private var modR: DelayLine
    private var tapeL: DelayLine
    private var tapeR: DelayLine
    private var lfo: Float = 0
    private var tapeLfo: Float = 0
    private var tremPhase: Double = 0
    private var crushHold: (Float, Float) = (0, 0)
    private var crushCount = 0
    private var rng: UInt32 = 987_654_321
    private var lofiLP = (OnePole(), OnePole())
    private var delayLP = (OnePole(), OnePole())
    private var crackleLP = OnePole()
    private var reverbHP = (OnePole(), OnePole())
    private var springLfo: Float = 0

    init(maxSampleRate: Float) {
        reverb = Reverb(maxSampleRate: maxSampleRate)
        let delayCap = Int(maxSampleRate * 2.6)
        delayL = DelayLine(capacity: delayCap)
        delayR = DelayLine(capacity: delayCap)
        modL = DelayLine(capacity: Int(maxSampleRate * 0.05))
        modR = DelayLine(capacity: Int(maxSampleRate * 0.05))
        tapeL = DelayLine(capacity: Int(maxSampleRate * 0.03))
        tapeR = DelayLine(capacity: Int(maxSampleRate * 0.03))
    }

    mutating func configure(sampleRate: Float) {
        self.sampleRate = sampleRate
        reverb.configure(sampleRate: sampleRate)
        reverb.clear()
        delayL.clear(); delayR.clear(); modL.clear(); modR.clear(); tapeL.clear(); tapeR.clear()
        lofiLP.0.set(cutoff: 4500, sampleRate: sampleRate)
        lofiLP.1.set(cutoff: 4500, sampleRate: sampleRate)
        delayLP.0.set(cutoff: 5000, sampleRate: sampleRate)
        delayLP.1.set(cutoff: 5000, sampleRate: sampleRate)
        crackleLP.set(cutoff: 2500, sampleRate: sampleRate)
        reverbHP.0.set(cutoff: 120, sampleRate: sampleRate)
        reverbHP.1.set(cutoff: 120, sampleRate: sampleRate)
    }

    mutating func set(_ p: FXParams) {
        if p.lofi != params.lofi {
            let fc: Float = p.lofi == .vinyl ? 5500 : (p.lofi == .tape ? 7500 : 4000)
            lofiLP.0.set(cutoff: fc, sampleRate: sampleRate)
            lofiLP.1.set(cutoff: fc, sampleRate: sampleRate)
        }
        if p.reverb != params.reverb { reverb.set(type: p.reverb) }
        if p.delay == .off && params.delay != .off { delayL.clear(); delayR.clear() }
        params = p
    }

    mutating func process(left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, frames: Int,
                          table: UnsafeMutablePointer<Float>) {
        let p = params
        let sr = sampleRate
        let samplesPerBeat = sr * 60 / max(bpm, 20)
        let delaySamples = p.delay.beats * samplesPerBeat
        let tremInc = p.tremolo == .off ? 0 : 1.0 / Double(p.tremolo.beats * samplesPerBeat)
        let lfoRate: Float
        let modBase: Float
        let modDepth: Float
        let modFb: Float
        switch p.mod {
        case .off: lfoRate = 0; modBase = 0; modDepth = 0; modFb = 0
        case .chorus: lfoRate = 0.8; modBase = 0.012; modDepth = 0.003; modFb = 0
        case .wideChorus: lfoRate = 0.5; modBase = 0.018; modDepth = 0.005; modFb = 0
        case .flanger: lfoRate = 0.25; modBase = 0.0015; modDepth = 0.0013; modFb = 0.65
        case .jet: lfoRate = 0.12; modBase = 0.001; modDepth = 0.0009; modFb = 0.85
        }
        let driveGain: Float
        switch p.drive {
        case .off: driveGain = 1
        case .tube: driveGain = 2
        case .drive: driveGain = 4
        case .distortion: driveGain = 12
        case .fuzz: driveGain = 30
        }
        let reverbOn = p.reverb != .off
        let width = p.spread

        for i in 0..<frames {
            var l = left[i]
            var r = right[i]

            // Drive
            if p.drive != .off {
                switch p.drive {
                case .tube:
                    l = (l * driveGain + 0.1) / (1 + abs(l * driveGain + 0.1)) - 0.0909
                    r = (r * driveGain + 0.1) / (1 + abs(r * driveGain + 0.1)) - 0.0909
                case .drive:
                    l = Float(tanh(Double(l * driveGain))) * 0.7
                    r = Float(tanh(Double(r * driveGain))) * 0.7
                case .distortion:
                    l = clamp(l * driveGain, -0.6, 0.6)
                    r = clamp(r * driveGain, -0.6, 0.6)
                case .fuzz:
                    l = (l >= 0 ? 1 : -1) * (1 - Float(exp(-Double(abs(l * driveGain))))) * 0.5
                    r = (r >= 0 ? 1 : -1) * (1 - Float(exp(-Double(abs(r * driveGain))))) * 0.5
                case .off: break
                }
            }

            // Lo-fi family
            switch p.lofi {
            case .off: break
            case .lofi:
                crushCount += 1
                if crushCount >= 4 {
                    crushCount = 0
                    crushHold = ((l * 32).rounded() / 32, (r * 32).rounded() / 32)
                }
                l = lofiLP.0.lowpass(crushHold.0)
                r = lofiLP.1.lowpass(crushHold.1)
            case .vinyl:
                var crackle: Float = 0
                let n = whiteNoise(&rng)
                if abs(n) > 0.9993 { crackle = n * 0.25 }
                let hiss = crackleLP.lowpass(whiteNoise(&rng)) * 0.006
                l = lofiLP.0.lowpass(l) + crackle + hiss
                r = lofiLP.1.lowpass(r) + crackle + hiss
            case .tape:
                tapeLfo += 0.6 / sr
                if tapeLfo >= 1 { tapeLfo -= 1 }
                let wow = (0.004 + 0.0012 * sin01(tapeLfo, table)) * sr
                tapeL.push(l); tapeR.push(r)
                l = Float(tanh(Double(lofiLP.0.lowpass(tapeL.read(wow)) * 1.3)))
                r = Float(tanh(Double(lofiLP.1.lowpass(tapeR.read(wow)) * 1.3)))
            }

            // Chorus / flanger
            if p.mod != .off {
                lfo += lfoRate / sr
                if lfo >= 1 { lfo -= 1 }
                let mL = (modBase + modDepth * sin01(lfo, table)) * sr
                let mR = (modBase + modDepth * sin01(lfo + 0.25, table)) * sr
                let wl = modL.read(mL)
                let wr = modR.read(mR)
                modL.push(l + wl * modFb)
                modR.push(r + wr * modFb)
                l = (l + wl) * 0.7
                r = (r + wr) * 0.7
            }

            // Tremolo (tempo synced)
            if tremInc > 0 {
                tremPhase += tremInc
                if tremPhase >= 1 { tremPhase -= 1 }
                let t = 1 - p.tremoloDepth * (0.5 + 0.5 * sin01(Float(tremPhase), table))
                l *= t
                r *= t
            }

            // Ping-pong delay
            if p.delay != .off {
                let dl = delayL.read(delaySamples)
                let dr = delayR.read(delaySamples)
                delayL.push(l + delayLP.1.lowpass(dr) * p.delayFeedback)
                delayR.push(delayLP.0.lowpass(dl) * p.delayFeedback)
                l += dl * p.delayMix
                r += dr * p.delayMix
            }

            // Reverb
            if reverbOn {
                var inL = reverbHP.0.highpass(l)
                var inR = reverbHP.1.highpass(r)
                if p.reverb == .spring {
                    springLfo += 3.1 / sr
                    if springLfo >= 1 { springLfo -= 1 }
                    let wobble = 1 + 0.15 * sin01(springLfo, table)
                    inL *= wobble; inR *= wobble
                }
                let (wl, wr) = reverb.process(inL, inR)
                l += wl * p.reverbMix * 3
                r += wr * p.reverbMix * 3
            }

            // Stereo width
            let mid = 0.5 * (l + r)
            let side = 0.5 * (l - r) * (0.2 + 1.3 * width)
            left[i] = mid + side
            right[i] = mid - side
        }
    }
}
