import AVFoundation
import TonicCore
import os

/// Hosts `TonicEngine` inside AVAudioEngine and keeps it running through
/// interruptions, route changes and media-server resets.
@MainActor
final class AudioController {
    let core = TonicEngine(sampleRate: 48000)
    private var engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private(set) var isRunning = false
    /// Whether the microphone category is currently required.
    private(set) var wantsInput = false
    private var observers: [NSObjectProtocol] = []
    private let log = Logger(subsystem: "com.pristinep.tonic", category: "audio")

    /// Called after the engine (re)starts so settings can be re-sent.
    var onRestart: (() -> Void)?

    init() {
        observeSession()
    }

    // MARK: Lifecycle

    func start() {
        do {
            try configureSession()
            try buildGraphIfNeeded()
            if !engine.isRunning {
                try engine.start()
            }
            isRunning = true
        } catch {
            isRunning = false
            log.error("Audio start failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Stops audio to save power (e.g. when backgrounded with nothing playing).
    func suspend() {
        engine.pause()
        isRunning = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// Switches the session between playback-only and play-and-record.
    func setInputEnabled(_ enabled: Bool) {
        guard enabled != wantsInput else { return }
        wantsInput = enabled
        do {
            try configureSession()
        } catch {
            log.error("Session change failed: \(error.localizedDescription, privacy: .public)")
        }
        // A category change can reconfigure the hardware; make sure we are still running.
        if !engine.isRunning { restart() }
    }

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        if wantsInput {
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
        } else {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        }
        try? session.setPreferredSampleRate(48000)
        try? session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
    }

    private func buildGraphIfNeeded() throws {
        let rate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        let sampleRate = rate > 0 ? rate : AVAudioSession.sharedInstance().sampleRate
        if let source, source.outputFormat(forBus: 0).sampleRate == sampleRate { return }

        if let source {
            engine.stop()
            engine.disconnectNodeOutput(source)
            engine.detach(source)
            self.source = nil
        }
        // Safe: the source node is detached, so nothing is rendering.
        core.configure(sampleRate: sampleRate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else {
            throw NSError(domain: "Tonic", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported audio format"])
        }
        let node = AudioController.makeSourceNode(format: format, core: core)
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 1
        source = node
        engine.prepare()
    }

    /// Built outside the main actor: the render block runs on the real-time audio thread.
    nonisolated private static func makeSourceNode(format: AVAudioFormat, core: TonicEngine) -> AVAudioSourceNode {
        AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard buffers.count >= 2,
                  let left = buffers[0].mData?.assumingMemoryBound(to: Float.self),
                  let right = buffers[1].mData?.assumingMemoryBound(to: Float.self) else {
                for buffer in buffers {
                    if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                }
                return noErr
            }
            core.render(left: left, right: right, frames: Int(frameCount))
            return noErr
        }
    }

    private func restart() {
        engine.stop()
        do {
            try configureSession()
            try buildGraphIfNeeded()
            try engine.start()
            isRunning = true
            onRestart?()
        } catch {
            isRunning = false
            log.error("Audio restart failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Rebuilds everything after the media server resets.
    private func rebuildAfterReset() {
        source = nil
        engine = AVAudioEngine()
        observeEngine()
        restart()
    }

    // MARK: Notifications

    private func observeSession() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let typeValue = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            MainActor.assumeIsolated {
                guard let self, let typeValue, let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
                switch type {
                case .began:
                    self.isRunning = false
                case .ended:
                    self.restart()
                @unknown default:
                    break
                }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuildAfterReset() }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.isRunning, !self.engine.isRunning else { return }
                self.restart()
            }
        })
        observeEngine()
    }

    private var engineObserver: NSObjectProtocol?

    private func observeEngine() {
        if let engineObserver { NotificationCenter.default.removeObserver(engineObserver) }
        engineObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.log.info("Audio configuration changed; restarting")
                self.restart()
            }
        }
    }
}
