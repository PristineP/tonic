import { describe, expect, it } from 'vitest'
import { Device, DeviceHost, FunctionKey, HapticKind, Screen } from '../src/core/device/device'
import { PlayMode, decodeDeviceSettings, defaultDeviceSettings } from '../src/core/device/deviceSettings'
import { EngineCommand } from '../src/core/dsp/engineTypes'
import { SoundLibrary } from '../src/core/dsp/synthParams'
import { ReverbType } from '../src/core/dsp/effects'
import { VocoderSource } from '../src/core/dsp/vocoder'
import { JoyDirection, JoystickMap } from '../src/core/theory/joystick'
import { Scale } from '../src/core/theory/music'
import { RushPhase } from '../src/core/training/chordRush'
import { OLEDFrame } from '../src/core/display/oledFrame'

class MockHost implements DeviceHost {
  commands: EngineCommand[] = []
  micActive = false
  captureRequests = 0
  send(command: EngineCommand): void { this.commands.push(command) }
  haptic(_kind: HapticKind): void {}
  setMicrophoneActive(active: boolean): void { this.micActive = active }
  captureSample(): void { this.captureRequests += 1 }
  settingsDidChange(): void {}

  get lastPress(): { id: number; notes: number[] } | null {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      const c = this.commands[i]
      if (c.type === 'press') return { id: c.id, notes: [...c.notes] }
    }
    return null
  }
}

function makeDevice(): [Device, MockHost] {
  const d = new Device()
  const h = new MockHost()
  d.host = h
  d.syncEngine()
  d.tick(10)
  return [d, h]
}

describe('Device', () => {
  it('plays chords and follows the joystick', () => {
    const [d, h] = makeDevice()
    d.pressButton(0)
    expect(d.displayChord).toBe('C')
    expect(h.lastPress?.notes).toEqual([48, 52, 55])
    d.setJoystick(JoyDirection.right)
    expect(d.displayChord).toBe('Cmaj7')
    expect(h.lastPress?.notes).toEqual([48, 52, 55, 59])
    d.setJoystick(JoyDirection.center)
    expect(d.displayChord).toBe('C')
    d.releaseButton(0)
    expect(h.commands[h.commands.length - 1]).toMatchObject({ type: 'release', id: 0 })
    // Swiping on a key overrides the joystick for that key.
    d.pressButton(5)
    d.swipeButton(5, JoyDirection.up)
    expect(d.displayChord).toBe('A')
  })

  it('key menu changes key and closes', () => {
    const [d] = makeDevice()
    d.pressFunction(FunctionKey.key)
    d.releaseFunction(FunctionKey.key)
    expect(d.screen).toBe(Screen.keyMenu)
    d.setJoystick(JoyDirection.right); d.setJoystick(JoyDirection.center)
    d.setJoystick(JoyDirection.right); d.setJoystick(JoyDirection.center)
    expect(d.settings.harmony.key).toBe(2)
    d.setJoystick(JoyDirection.up); d.setJoystick(JoyDirection.center)
    expect(d.settings.harmony.octave).toBe(1)
    d.pressButton(0)
    expect(d.displayChord).toBe('D')
    d.releaseButton(0)
    d.pressFunction(FunctionKey.key)
    d.releaseFunction(FunctionKey.key)
    expect(d.screen).toBe(Screen.home)
    // Menus time out.
    d.pressFunction(FunctionKey.sound); d.releaseFunction(FunctionKey.sound)
    d.tick(30)
    expect(d.screen).toBe(Screen.home)
  })

  it('edits list items', () => {
    const [d] = makeDevice()
    d.pressFunction(FunctionKey.key); d.releaseFunction(FunctionKey.key)
    d.clickJoystick()
    expect(d.screen).toBe(Screen.keyList)
    d.setJoystick(JoyDirection.right); d.setJoystick(JoyDirection.center) // scale -> minor
    expect(d.settings.harmony.scale).toBe(Scale.minor)
    d.setJoystick(JoyDirection.down); d.setJoystick(JoyDirection.center)
    d.setJoystick(JoyDirection.right); d.setJoystick(JoyDirection.center) // joystick map -> extended
    expect(d.settings.harmony.joystickMap).toBe(JoystickMap.extended)
    d.clickJoystick()
    expect(d.screen).toBe(Screen.home)
  })

  it('handles function-key combos', () => {
    const [d] = makeDevice()
    d.pressFunction(FunctionKey.sound)
    d.pressButton(3)
    d.releaseButton(3)
    d.releaseFunction(FunctionKey.sound)
    expect(d.settings.soundName).toBe(SoundLibrary.quickSelect[3])
    expect(d.screen).toBe(Screen.home)
    d.pressFunction(FunctionKey.mode)
    d.pressButton(4)
    d.releaseButton(4)
    d.releaseFunction(FunctionKey.mode)
    expect(d.settings.mode).toBe(PlayMode.arp)
    d.pressFunction(FunctionKey.key)
    d.pressButton(2)
    d.releaseButton(2)
    d.releaseFunction(FunctionKey.key)
    expect(d.settings.harmony.buttonOctaves[2]).toBe(1)
  })

  it('switches modes and uses the mic', () => {
    const [d, h] = makeDevice()
    d.setMode(PlayMode.tuner)
    expect(h.micActive).toBe(true)
    d.setMode(PlayMode.mic)
    d.pressButton(0)
    expect(h.captureRequests).toBe(1)
    d.sampleCaptured(true, 61)
    expect(d.settings.soundName).toBe('MIC SAMPLE')
    expect(d.settings.mode).toBe(PlayMode.play)
    expect(h.micActive).toBe(false)
  })

  it('sequencer records steps', () => {
    const [d, h] = makeDevice()
    d.setMode(PlayMode.sequencer)
    for (const b of [0, 4, 5, 3]) { d.pressButton(b); d.releaseButton(b) }
    expect(d.seqNames).toEqual(['C', 'G', 'Am', 'F'])
    d.clickJoystick()
    expect(h.commands.some(c => c.type === 'seqPlay' && c.on === true)).toBe(true)
  })

  it('ear trainer asks questions', () => {
    const [d, h] = makeDevice()
    d.setMode(PlayMode.earTrainer)
    expect(h.commands.some(c => c.type === 'preview')).toBe(true)
  })

  it('plays slash chords', () => {
    const [d, h] = makeDevice()
    d.update(s => { s.slashChords = true })
    d.pressButton(0)
    d.pressButton(2)
    expect(d.displayChord).toBe('C/E')
    expect(h.lastPress?.id).toBe(0)
    d.releaseButton(2)
    expect(d.displayChord).toBe('C')
  })

  it('vocoder mode toggles engine and microphone', () => {
    const [d, h] = makeDevice()
    d.setMode(PlayMode.vocoder)
    expect(h.micActive).toBe(true)
    expect(h.commands.some(c => c.type === 'vocoder' && c.on === true)).toBe(true)
    d.update(s => { s.vocoder.source = VocoderSource.track1 })
    expect(h.micActive).toBe(false) // track-1 modulator needs no microphone
    d.pressButton(0)
    expect(d.displayChord).toBe('C')
    d.releaseButton(0)
    d.setMode(PlayMode.play)
    const lastVocoder = [...h.commands].reverse().find(c => c.type === 'vocoder')
    expect(lastVocoder).toMatchObject({ type: 'vocoder', on: false })
  })

  it('runs a Chord Rush game', () => {
    const [d, h] = makeDevice()
    d.setMode(PlayMode.chordRush)
    d.setJoystick(JoyDirection.right); d.setJoystick(JoyDirection.center)
    expect(d.settings.rushSong).toBe(1)
    d.setJoystick(JoyDirection.left); d.setJoystick(JoyDirection.center)
    d.clickJoystick()
    expect(d.rush.phase).toBe(RushPhase.waiting)
    expect(h.commands.some(c => c.type === 'beat' && c.on === true)).toBe(true)
    // Simulate the engine clock: 100 BPM, beat 0 at t = 10.
    const at = (beat: number) => {
      d.status = { ...d.status, beatOn: true, tempo: 100, beat }
      d.tick(10 + beat * 0.6)
    }
    at(0.1)
    expect(d.rush.phase).toBe(RushPhase.playing)
    const song = d.rush.song
    song.degrees.forEach((degree, i) => {
      if (i === 2) {
        at(d.rush.targetBeat(i) - 0.5)
        expect(d.render().pixels.some(p => p !== 0)).toBe(true)
      }
      at(d.rush.targetBeat(i))
      d.pressButton(degree)
      d.releaseButton(degree)
      at(d.rush.targetBeat(i) + 1)
    })
    at(d.rush.targetBeat(song.degrees.length - 1) + 4)
    expect(d.rush.phase).toBe(RushPhase.done)
    expect(d.rush.grade).toBe('S')
    expect(d.settings.rushBest[0]).toBe(d.rush.score)
    expect(h.commands.some(c => c.type === 'beat' && c.on === false)).toBe(true)
  })

  it('round-trips settings and decodes tolerantly', () => {
    const s = defaultDeviceSettings()
    s.harmony.key = 7
    s.fx.reverb = ReverbType.hall
    s.mode = PlayMode.arp
    const data = JSON.stringify(s)
    expect(decodeDeviceSettings(JSON.parse(data))).toEqual(s)
    const decoded = decodeDeviceSettings(JSON.parse('{"bpm": 133, "unknownKey": 1}'))
    expect(decoded.bpm).toBe(133)
    expect(decoded.soundName).toBe(defaultDeviceSettings().soundName)
    // Malformed button octaves are repaired to seven entries.
    const fixed = decodeDeviceSettings({ harmony: { buttonOctaves: [1, 2] } })
    expect(fixed.harmony.buttonOctaves).toHaveLength(7)
  })

  it('renders every screen', () => {
    const [d] = makeDevice()
    const frames: [string, OLEDFrame][] = []
    d.battery = 0.7
    for (const mode of PlayMode.allCases) {
      d.setMode(mode)
      d.tick(d.now + 5)
      if (PlayMode.playsChords(mode) || mode === PlayMode.lead || mode === PlayMode.drums) {
        d.pressButton(1)
        d.setJoystick(JoyDirection.right)
      }
      frames.push([`mode-${PlayMode.displayName(mode)}`, d.render()])
      d.setJoystick(JoyDirection.center)
      d.releaseButton(1)
    }
    d.setMode(PlayMode.play)
    d.tick(d.now + 5)
    for (const f of FunctionKey.allCases) {
      d.pressFunction(f); d.releaseFunction(f)
      frames.push([`menu-${FunctionKey.name(f)}`, d.render()])
      d.clickJoystick()
      frames.push([`list-${FunctionKey.name(f)}`, d.render()])
      d.clickJoystick()
    }
    d.loopNext()
    frames.push(['message', d.render()])
    for (const [name, frame] of frames) {
      let lit = 0
      for (const p of frame.pixels) if (p !== 0) lit++
      expect(lit, name).toBeGreaterThan(30)
    }
  })
})
