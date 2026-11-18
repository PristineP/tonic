// Web MIDI output: forwards the engine's MIDI stream to a chosen output port.
type Msg = { status: number; data1: number; data2: number; sampleOffset: number }

export class MidiOut {
  private access: MIDIAccess | null = null
  private requested = false
  portId: string | null = null
  enabled = false
  onPortsChanged: (() => void) | null = null

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  }

  async enable(): Promise<boolean> {
    if (!this.supported) return false
    if (!this.access && !this.requested) {
      this.requested = true
      try {
        this.access = await navigator.requestMIDIAccess({ sysex: false })
        this.access.onstatechange = () => this.onPortsChanged?.()
      } catch {
        this.access = null
      }
      this.requested = false
    }
    this.enabled = this.access !== null
    return this.enabled
  }

  get outputs(): { id: string; name: string }[] {
    if (!this.access) return []
    return [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }))
  }

  private port(): MIDIOutput | null {
    if (!this.access) return null
    if (this.portId) {
      const p = this.access.outputs.get(this.portId)
      if (p) return p
    }
    return this.access.outputs.values().next().value ?? null
  }

  send(messages: Msg[], sampleRate: number, audioLatency: number): void {
    if (!this.enabled || !messages.length) return
    const p = this.port()
    if (!p) return
    const now = performance.now() + audioLatency * 1000
    for (const m of messages) {
      p.send([m.status & 0xff, m.data1 & 0x7f, m.data2 & 0x7f], now + (Math.max(0, m.sampleOffset) / sampleRate) * 1000)
    }
  }

  allNotesOff(): void {
    const p = this.port()
    if (!p) return
    for (let ch = 0; ch < 16; ch++) p.send([0xb0 | ch, 123, 0])
  }
}
