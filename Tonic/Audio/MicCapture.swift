import AVFoundation
import TonicCore
import os

/// Microphone input for the tuner and the sampler. Runs its own AVAudioEngine so the
/// main synth graph never depends on an input device being present.
@MainActor
final class MicCapture {
    enum CaptureResult {
        case success(samples: [Float], sampleRate: Double)
        case failure
    }

    /// Latest tuner reading (main thread).
    var onPitch: ((PitchDetector.Result?) -> Void)?
    /// Input level 0...1 (main thread).
    var onLevel: ((Float) -> Void)?

    private var engine: AVAudioEngine?
    private let buffer = SampleRing()
    private var analysisTimer: Timer?
    private var captureCompletion: ((CaptureResult) -> Void)?
    private var captureDeadline: Date?
    private let log = Logger(subsystem: "com.pristinep.tonic", category: "mic")
    private(set) var isActive = false
    /// Engine that receives microphone audio for the vocoder.
    var modulator: TonicEngine?

    static let captureSeconds = 1.6

    /// Requests permission if needed. Calls back on the main thread.
    func requestPermission(_ done: @escaping (Bool) -> Void) {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: done(true)
        case .denied: done(false)
        default:
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async { done(granted) }
            }
        }
    }

    func start() {
        guard !isActive else { return }
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            log.error("No microphone input available")
            return
        }
        buffer.reset(sampleRate: format.sampleRate)
        MicCapture.installTap(on: input, format: format, ring: buffer, modulator: modulator)
        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            log.error("Mic start failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        self.engine = engine
        isActive = true
        analysisTimer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.analyse() }
        }
    }

    func stop() {
        analysisTimer?.invalidate()
        analysisTimer = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        isActive = false
        if let completion = captureCompletion {
            captureCompletion = nil
            completion(.failure)
        }
    }

    /// Records `captureSeconds` of audio, trims silence and normalises it.
    func capture(_ completion: @escaping (CaptureResult) -> Void) {
        guard isActive else { completion(.failure); return }
        buffer.beginRecording()
        captureCompletion = completion
        captureDeadline = Date().addingTimeInterval(MicCapture.captureSeconds)
    }

    nonisolated private static func installTap(on input: AVAudioInputNode, format: AVAudioFormat, ring: SampleRing,
                                               modulator: TonicEngine?) {
        input.installTap(onBus: 0, bufferSize: 512, format: format) { pcm, _ in
            guard let data = pcm.floatChannelData else { return }
            let count = Int(pcm.frameLength)
            ring.append(data[0], count: count)
            modulator?.pushModulator(data[0], count: count)
        }
    }

    private func analyse() {
        let (recent, rate) = buffer.recent(4096)
        var peak: Float = 0
        for v in recent.suffix(1024) { peak = max(peak, abs(v)) }
        onLevel?(peak)
        if let deadline = captureDeadline, Date() >= deadline {
            captureDeadline = nil
            let recorded = buffer.endRecording()
            let completion = captureCompletion
            captureCompletion = nil
            if let processed = MicCapture.process(recorded) {
                completion?(.success(samples: processed, sampleRate: rate))
            } else {
                completion?(.failure)
            }
            return
        }
        guard onPitch != nil, recent.count >= 4096 else { return }
        let detector = PitchDetector(sampleRate: rate, minFrequency: 40, maxFrequency: 1600)
        onPitch?(detector.detect(recent))
    }

    /// Trims leading silence, keeps up to ~1.4 s, normalises and fades the tail. Nil if silent.
    nonisolated static func process(_ x: [Float]) -> [Float]? {
        guard let peak = x.map(abs).max(), peak > 0.01 else { return nil }
        let threshold = peak * 0.08
        guard let start = x.firstIndex(where: { abs($0) > threshold }) else { return nil }
        let begin = max(0, start - 64)
        var out = Array(x[begin...])
        let gain = 0.9 / peak
        for i in out.indices { out[i] *= gain }
        let fade = min(out.count, 960)
        for i in 0..<fade {
            out[out.count - fade + i] *= Float(fade - i) / Float(fade)
        }
        return out
    }
}

/// Thread-safe ring for microphone samples, written on the audio tap thread.
final class SampleRing: @unchecked Sendable {
    private let lock = NSLock()
    private var ring = [Float](repeating: 0, count: 16384)
    private var write = 0
    private var filled = 0
    private var recording: [Float]?
    private var rate: Double = 48000

    func reset(sampleRate: Double) {
        lock.lock(); defer { lock.unlock() }
        rate = sampleRate
        write = 0
        filled = 0
        recording = nil
    }

    func append(_ p: UnsafePointer<Float>, count: Int) {
        lock.lock(); defer { lock.unlock() }
        for i in 0..<count {
            ring[write] = p[i]
            write = (write + 1) % ring.count
        }
        filled = min(ring.count, filled + count)
        if let recorded = recording?.count, recorded < Int(rate * 3) {
            recording?.append(contentsOf: UnsafeBufferPointer(start: p, count: count))
        }
    }

    func recent(_ n: Int) -> ([Float], Double) {
        lock.lock(); defer { lock.unlock() }
        let count = min(n, filled)
        var out = [Float](repeating: 0, count: count)
        for i in 0..<count {
            out[i] = ring[(write - count + i + ring.count) % ring.count]
        }
        return (out, rate)
    }

    func beginRecording() {
        lock.lock(); defer { lock.unlock() }
        recording = []
        recording?.reserveCapacity(Int(rate * 2))
    }

    func endRecording() -> [Float] {
        lock.lock(); defer { lock.unlock() }
        let r = recording ?? []
        recording = nil
        return r
    }
}
