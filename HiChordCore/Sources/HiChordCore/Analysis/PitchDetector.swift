import Foundation

/// YIN fundamental-frequency estimator, used by the tuner and to find the root of mic samples.
public struct PitchDetector {
    public struct Result: Equatable, Sendable {
        public var frequency: Double
        /// 0 ... 1, higher is more certain.
        public var confidence: Double
        public var midi: Double { 69 + 12 * log2(frequency / 440) }
        public var nearestNote: Int { Int(midi.rounded()) }
        public var cents: Double { (midi - Double(nearestNote)) * 100 }
    }

    public let sampleRate: Double
    public let minFrequency: Double
    public let maxFrequency: Double
    public var threshold: Double = 0.12

    public init(sampleRate: Double, minFrequency: Double = 50, maxFrequency: Double = 1500) {
        self.sampleRate = sampleRate
        self.minFrequency = minFrequency
        self.maxFrequency = maxFrequency
    }

    /// Analyses a block of mono samples. Needs at least two periods of the lowest frequency.
    public func detect(_ x: [Float]) -> Result? {
        let maxLag = min(Int(sampleRate / minFrequency), x.count / 2)
        let minLag = max(2, Int(sampleRate / maxFrequency))
        guard maxLag > minLag + 2 else { return nil }

        // Reject silence.
        var energy: Float = 0
        for v in x { energy += v * v }
        guard energy / Float(x.count) > 1e-6 else { return nil }

        let window = x.count - maxLag
        var diff = [Double](repeating: 0, count: maxLag + 1)
        x.withUnsafeBufferPointer { p in
            for lag in 1...maxLag {
                var sum: Double = 0
                for i in 0..<window {
                    let d = Double(p[i] - p[i + lag])
                    sum += d * d
                }
                diff[lag] = sum
            }
        }
        // Cumulative mean normalised difference.
        var cmnd = [Double](repeating: 1, count: maxLag + 1)
        var running: Double = 0
        for lag in 1...maxLag {
            running += diff[lag]
            cmnd[lag] = running > 0 ? diff[lag] * Double(lag) / running : 1
        }
        var tau = -1
        var lag = minLag
        while lag <= maxLag {
            if cmnd[lag] < threshold {
                while lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag] { lag += 1 }
                tau = lag
                break
            }
            lag += 1
        }
        if tau < 0 {
            // Fall back to the global minimum if it is reasonably clear.
            var best = minLag
            for l in minLag...maxLag where cmnd[l] < cmnd[best] { best = l }
            guard cmnd[best] < 0.35 else { return nil }
            tau = best
        }
        // Parabolic interpolation around the minimum.
        var refined = Double(tau)
        if tau > 1 && tau < maxLag {
            let a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1]
            let denom = a - 2 * b + c
            if abs(denom) > 1e-12 { refined += 0.5 * (a - c) / denom }
        }
        let f = sampleRate / refined
        guard f >= minFrequency * 0.9 && f <= maxFrequency * 1.1 else { return nil }
        return Result(frequency: f, confidence: max(0, min(1, 1 - cmnd[tau])))
    }
}
