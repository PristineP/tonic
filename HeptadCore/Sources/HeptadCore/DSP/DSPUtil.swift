import Foundation

/// Shared lookup tables and small DSP helpers. Everything here is allocation-free once built.
enum DSP {
    static let sineTableSize = 4096
    /// One cycle of a sine plus two guard points, so lookups never need to wrap
    /// (even when float rounding lands exactly on the end of the table).
    static let sineTable: UnsafeMutablePointer<Float> = {
        let p = UnsafeMutablePointer<Float>.allocate(capacity: sineTableSize + 2)
        for i in 0...(sineTableSize + 1) {
            p[i] = Float(sin(2.0 * Double.pi * Double(i) / Double(sineTableSize)))
        }
        return p
    }()
}

/// sin(2π x) via table lookup with linear interpolation.
@inline(__always) func sin01(_ x: Float, _ table: UnsafeMutablePointer<Float>) -> Float {
    let f = x - x.rounded(.down)
    let pos = f * Float(DSP.sineTableSize)
    let i = Int(pos)
    let frac = pos - Float(i)
    let a = table[i]
    return a + (table[i + 1] - a) * frac
}

/// PolyBLEP residual for band-limited discontinuities.
@inline(__always) func polyBlep(_ t: Float, _ dt: Float) -> Float {
    if t < dt {
        let x = t / dt
        return x + x - x * x - 1
    } else if t > 1 - dt {
        let x = (t - 1) / dt
        return x * x + x + x + 1
    }
    return 0
}

/// Fast xorshift noise in -1 ... 1.
@inline(__always) func whiteNoise(_ state: inout UInt32) -> Float {
    state ^= state << 13
    state ^= state >> 17
    state ^= state << 5
    return Float(Int32(bitPattern: state)) * (1.0 / 2147483648.0)
}

/// Topology-preserving-transform state variable filter (Zavalishin).
struct SVF {
    var ic1: Float = 0
    var ic2: Float = 0
    var a1: Float = 0
    var a2: Float = 0
    var a3: Float = 0
    var k: Float = 2

    /// - Parameters:
    ///   - cutoff: Hz
    ///   - q: resonance 0 ... 1 (0 = no peak, 1 = near self-oscillation)
    @inline(__always) mutating func set(cutoff: Float, resonance: Float, sampleRate: Float) {
        let fc = min(max(cutoff, 20), sampleRate * 0.45)
        let g = Float(tan(Double.pi * Double(fc) / Double(sampleRate)))
        k = 2 - 1.95 * min(max(resonance, 0), 1)
        a1 = 1 / (1 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
    }

    /// Sets the filter from an explicit Q value (for band-pass use).
    @inline(__always) mutating func set(cutoff: Float, q: Float, sampleRate: Float) {
        let fc = min(max(cutoff, 20), sampleRate * 0.45)
        let g = Float(tan(Double.pi * Double(fc) / Double(sampleRate)))
        k = 1 / max(q, 0.05)
        a1 = 1 / (1 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
    }

    /// Processes one sample and returns (low, band, high).
    @inline(__always) mutating func process(_ v0: Float) -> (low: Float, band: Float, high: Float) {
        let v3 = v0 - ic2
        let v1 = a1 * ic1 + a2 * v3
        let v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        return (v2, v1, v0 - k * v1 - v2)
    }

    @inline(__always) mutating func lowpass(_ x: Float) -> Float { process(x).low }

    mutating func reset() { ic1 = 0; ic2 = 0 }
}

/// One-pole smoother / filter.
struct OnePole {
    var z: Float = 0
    var a: Float = 0.5

    mutating func set(cutoff: Float, sampleRate: Float) {
        a = 1 - Float(exp(-2.0 * Double.pi * Double(cutoff) / Double(sampleRate)))
    }

    @inline(__always) mutating func lowpass(_ x: Float) -> Float {
        z += a * (x - z)
        return z
    }

    @inline(__always) mutating func highpass(_ x: Float) -> Float {
        z += a * (x - z)
        return x - z
    }
}

@inline(__always) func clamp(_ x: Float, _ lo: Float, _ hi: Float) -> Float { min(max(x, lo), hi) }

/// exp-based coefficient that decays to 1% (−40 dB) in `seconds`.
@inline(__always) func decayCoef(_ seconds: Float, _ sampleRate: Float) -> Float {
    Float(exp(-4.6 / Double(max(seconds, 0.0005) * sampleRate)))
}

@inline(__always) func midiToHz(_ note: Float) -> Float {
    440 * Float(pow(2.0, Double(note - 69) / 12))
}
