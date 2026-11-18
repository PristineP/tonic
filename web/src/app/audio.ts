// Main-thread side of the audio engine: owns the AudioContext, the worklet node and the mic stream.
import type { EngineCommand } from '../core/dsp/engineTypes'
import type { FromWorklet, ToWorklet } from './worklet'
import workletUrl from './worklet.ts?worker&url'

export class AudioHost {
  ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private pending: EngineCommand[] = []
  private flushQueued = false
  private startPromise: Promise<void> | null = null
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  onTick: ((m: FromWorklet) => void) | null = null
  /// Called after the engine (re)starts so the device can resend its state.
  onStart: (() => void) | null = null

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000
  }

  get running(): boolean {
    return this.ctx?.state === 'running'
  }

  /// Must be called from a user gesture the first time (browser autoplay rules).
  start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume()
      return this.startPromise ?? Promise.resolve()
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    void ctx.resume()
    this.startPromise = (async () => {
      await ctx.audioWorklet.addModule(workletUrl)
      const node = new AudioWorkletNode(ctx, 'tonic', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 1,
        channelCountMode: 'explicit',
      })
      node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.onTick?.(e.data)
      node.connect(ctx.destination)
      this.node = node
      if (this.micSource) this.micSource.connect(node)
      this.onStart?.()
      this.flush()
    })()
    return this.startPromise
  }

  suspend(): void {
    void this.ctx?.suspend()
  }

  send(cmd: EngineCommand): void {
    this.pending.push(cmd)
    if (!this.flushQueued) {
      this.flushQueued = true
      queueMicrotask(() => this.flush())
    }
  }

  private flush(): void {
    this.flushQueued = false
    if (!this.node || this.pending.length === 0) return
    this.post({ t: 'cmd', cmds: this.pending })
    this.pending = []
  }

  private post(m: ToWorklet, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(m, transfer)
  }

  loadSample(slot: number, data: Float32Array): void {
    const copy = data.slice()
    this.post({ t: 'sample', slot, data: copy }, [copy.buffer])
  }

  get micActive(): boolean {
    return this.micStream !== null
  }

  /// Opens the microphone and routes it into the engine (vocoder) and back to the main thread (tuner, sampler).
  async startMic(): Promise<boolean> {
    if (this.micStream) return true
    if (!navigator.mediaDevices?.getUserMedia) return false
    try {
      await this.start()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      this.micStream = stream
      this.micSource = this.ctx!.createMediaStreamSource(stream)
      if (this.node) this.micSource.connect(this.node)
      this.post({ t: 'listen', on: true })
      return true
    } catch {
      return false
    }
  }

  stopMic(): void {
    this.post({ t: 'listen', on: false })
    this.micSource?.disconnect()
    this.micSource = null
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
  }
}
