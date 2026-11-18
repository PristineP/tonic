/// <reference lib="webworker" />
// AudioWorklet processor: runs the Tonic engine on the audio thread.
import { Engine } from '../core/dsp/engine'
import type { EngineCommand } from '../core/dsp/engineTypes'

// Minimal AudioWorkletGlobalScope declarations (kept local so the DOM lib stays clean).
declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

export type ToWorklet =
  | { t: 'cmd'; cmds: EngineCommand[] }
  | { t: 'sample'; slot: number; data: Float32Array }
  | { t: 'listen'; on: boolean }

export type FromWorklet = {
  t: 'tick'
  status: unknown
  scope: Float32Array
  midi: { status: number; data1: number; data2: number; sampleOffset: number }[]
  time: number
  /// Recent mic samples since the last tick (only while listening).
  mic: Float32Array | null
}

const BLOCK = 128
const TICK_FRAMES = 1024 // ~21 ms at 48 kHz

class TonicProcessor extends AudioWorkletProcessor {
  private engine = new Engine()
  private left = new Float32Array(BLOCK)
  private right = new Float32Array(BLOCK)
  private sinceTick = 0
  private scope = new Float32Array(512)
  private listening = false
  private micBuf = new Float32Array(8192)
  private micCount = 0
  private frameCounter = 0

  constructor() {
    super()
    this.engine.configure(sampleRate)
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => {
      const m = e.data
      switch (m.t) {
        case 'cmd':
          for (const c of m.cmds) this.engine.send(c)
          break
        case 'sample': {
          const buf = this.engine.sampleBuffer(m.slot)
          buf.set(m.data.subarray(0, Math.min(m.data.length, buf.length)))
          break
        }
        case 'listen':
          this.listening = m.on
          this.micCount = 0
          break
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const frames = out[0]?.length ?? BLOCK
    if (this.left.length < frames) {
      this.left = new Float32Array(frames)
      this.right = new Float32Array(frames)
    }
    const mic = inputs[0]?.[0]
    if (mic && mic.length) {
      this.engine.pushModulator(mic)
      if (this.listening) {
        const n = Math.min(mic.length, this.micBuf.length - this.micCount)
        this.micBuf.set(mic.subarray(0, n), this.micCount)
        this.micCount += n
      }
    }
    const l = this.left.subarray(0, frames)
    const r = this.right.subarray(0, frames)
    this.engine.render(l, r, frames)
    out[0]?.set(l)
    if (out[1]) out[1].set(r)
    this.frameCounter += frames
    this.sinceTick += frames
    if (this.sinceTick >= TICK_FRAMES) {
      this.sinceTick = 0
      this.engine.copyScope(this.scope)
      const midi = this.engine.drainMidi()
      const micOut = this.listening && this.micCount > 0 ? this.micBuf.slice(0, this.micCount) : null
      this.micCount = 0
      const msg: FromWorklet = {
        t: 'tick',
        status: { ...this.engine.status, tracks: [...(this.engine.status.tracks as number[])] },
        scope: this.scope.slice(),
        midi,
        time: this.frameCounter / sampleRate,
        mic: micOut,
      }
      this.port.postMessage(msg)
    }
    return true
  }
}

registerProcessor('tonic', TonicProcessor)
