import Foundation

/// Where the vocoder's modulator (the "voice") comes from.
public enum VocoderSource: Int32, CaseIterable, Codable, Sendable {
    case mic, track1
    public var displayName: String { self == .mic ? "MIC" : "TRACK 1" }
}

/// Vocoder settings (POD).
public struct VocoderParams: Equatable, Codable, Sendable {
    public var source: VocoderSource = .mic
    /// Carrier band shift, 0.5 ... 2 (formant shift).
    public var formant: Float = 1
    /// Band resonance, 0 ... 1.
    public var q: Float = 0.5
    public var attack: Float = 0.005
    public var release: Float = 0.06
    /// Unvoiced "consonant" noise level, 0 ... 1.
    public var noise: Float = 0.35
    /// Modulator level below which the vocoder is silent, 0 ... 0.1.
    public var gate: Float = 0.01
    public init() {}
}

/// A 12-band channel vocoder: the modulator's spectral envelope shapes the carrier (the held chord).
struct Vocoder {
    static let bands = 12
    private var analysis: [SVF]
    private var synthesis: [SVF]
    private var envelopes: [Float]
    private var centers: [Float]
    private var gateEnv: Float = 0
    private var noiseHP = OnePole()
    private var hfEnv: Float = 0
    private var rng: UInt32 = 0xBEEF
    private var sampleRate: Float = 48000
    private var attackK: Float = 0
    private var releaseK: Float = 0
    private(set) var params = VocoderParams()

    init() {
        analysis = Array(repeating: SVF(), count: Vocoder.bands)
        synthesis = Array(repeating: SVF(), count: Vocoder.bands)
        envelopes = Array(repeating: 0, count: Vocoder.bands)
        // Log-spaced 160 Hz ... 7 kHz.
        centers = (0..<Vocoder.bands).map { 160 * Float(pow(7000.0 / 160.0, Double($0) / Double(Vocoder.bands - 1))) }
    }

    mutating func configure(sampleRate sr: Float) {
        sampleRate = sr
        noiseHP.set(cutoff: 5000, sampleRate: sr)
        set(params)
    }

    mutating func set(_ p: VocoderParams) {
        params = p
        let q = 4 + 14 * clamp(p.q, 0, 1)
        for b in 0..<Vocoder.bands {
            analysis[b].set(cutoff: centers[b], q: q, sampleRate: sampleRate)
            synthesis[b].set(cutoff: min(sampleRate * 0.45, centers[b] * clamp(p.formant, 0.5, 2)), q: q, sampleRate: sampleRate)
        }
        attackK = 1 - Float(exp(-1 / Double(max(0.0005, p.attack) * sampleRate)))
        releaseK = 1 - Float(exp(-1 / Double(max(0.005, p.release) * sampleRate)))
    }

    mutating func reset() {
        for b in 0..<Vocoder.bands { analysis[b].reset(); synthesis[b].reset(); envelopes[b] = 0 }
        gateEnv = 0
        hfEnv = 0
    }

    /// Adds the vocoded signal of `carrier` shaped by `modulator` into `outL`/`outR`.
    mutating func process(carrier: UnsafeMutablePointer<Float>, modulator: UnsafeMutablePointer<Float>, frames: Int,
                          outL: UnsafeMutablePointer<Float>, outR: UnsafeMutablePointer<Float>) {
        let gateK: Float = 1 - Float(exp(-1 / Double(0.02 * sampleRate)))
        let noiseLevel = params.noise
        let gate = params.gate
        for i in 0..<frames {
            let m = modulator[i]
            let c = carrier[i]
            var out: Float = 0
            for b in 0..<Vocoder.bands {
                let level = abs(analysis[b].process(m).band)
                let e = envelopes[b]
                envelopes[b] = e + (level > e ? attackK : releaseK) * (level - e)
                out += synthesis[b].process(c).band * envelopes[b]
            }
            // Consonants: high-passed noise follows the modulator's top end.
            let hf = abs(m - noiseHP.lowpass(m))
            hfEnv += (hf > hfEnv ? attackK : releaseK) * (hf - hfEnv)
            out += whiteNoise(&rng) * hfEnv * noiseLevel * 2
            // Gate
            gateEnv += gateK * (abs(m) - gateEnv)
            let open: Float = gateEnv > gate ? 1 : max(0, gateEnv / max(gate, 1e-5))
            let y = out * 3.5 * open
            outL[i] += y
            outR[i] += y
        }
    }
}
