# Heptad for iPhone & iPad

Heptad is a pocket chord synthesizer for iPhone and iPad. Seven chord keys play every diatonic chord of a key, a joystick bends each chord into 7ths, 9ths, sus and altered voicings, and a looper, drum machine, arpeggiator and vocoder sit around it. The instrument has a matte slate-navy body, a pixel OLED, a volume/filter wheel, teal, amber and coral function keys (Key, Sound, Mode), a touch joystick and a looper panel.

## Features

- **Seven chord keys** for the seven diatonic chords of any of 12 keys and 10 scales (major, minor, harmonic/melodic minor, pentatonics, blues, Dorian, Mixolydian, Lydian).
- **Eight-way joystick** with five maps (Default, Extended, Chromatic, Borrow, Classic): 7ths, 9ths, sus, altered dominants, secondary dominants, tritone subs, modal interchange. Swipe on a held key to bend just that chord.
- Inversions, voice leading, root and auto-slash bass, two-button slash chords, per-key octaves.
- **15 modes**: Play, Strum, Lead, Drone, Arp, Repeat, Sequencer (16 steps), Drums, Beat (7 styles × 8 variations), Chord Rush (rhythm game, 6 songs), Ear Trainer (6 levels), Tuner, Mic sampler, Vocoder (12-band, mic or loop track 1 as the voice), Mixer.
- **28 sounds** from a real-time synth engine: band-limited analog waveforms, supersaw, 2-op FM, Karplus-Strong strings, drawbar organ, formant voices, noise, plus your own mic sample.
- **Effects**: room/hall/plate/spring/ambient reverb, tempo-synced ping-pong delay, chorus/flanger, tremolo, tube/drive/distortion/fuzz, lo-fi/vinyl/tape, stereo spread, filter wheel.
- **Six-track looper**: bar mode with count-in, or free mode; mute, re-record, clear, per-track levels.
- **Virtual MIDI output** ("Heptad"): loop tracks on channels 1–6, drums on 10.
- Seven synthesised drum kits. Background audio. Haptics. VoiceOver labels. Settings and four presets are saved.

## Project layout

```
Heptad.xcodeproj      Xcode project (iOS 17+, iPhone & iPad)
Heptad/               SwiftUI app: device views, audio host, MIDI, mic
HeptadCore/           Swift package: theory, DSP engine, sequencing, device firmware, OLED
Config/Info.plist      App Info.plist
.github/workflows/     CI: core tests, device + simulator builds, screenshots
```

`HeptadCore` has no Apple-only dependencies. The chord theory, audio engine, looper, menus and OLED rendering are all unit-tested (`swift test --package-path HeptadCore`). They also run on Linux.

The audio thread never locks or allocates. The UI sends commands through a wait-free SPSC queue, and all voices and buffers are preallocated.

## Building

1. Open `Heptad.xcodeproj` in Xcode 16 or later.
2. Select the **Heptad** target → *Signing & Capabilities* → choose your team. Change the bundle identifier (`com.pristinep.heptad`) if needed.
3. Run on an iPhone or iPad. Use a real device for the best latency.

Before an App Store submission, check the version and build numbers (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`) and review the privacy manifest in `Heptad/PrivacyInfo.xcprivacy`.

## Installing on your iPhone

See [TESTFLIGHT.md](TESTFLIGHT.md): add four repository secrets once, then run the **TestFlight** workflow and install the build from the TestFlight app.

## Controls

| Control | Action |
|---|---|
| Chord key | Play the chord (I–IV bottom row, V–VII top row) |
| Joystick / swipe on key | Change chord quality while held |
| Joystick tap | Record next loop track / finish recording |
| Key (teal) | Key menu: ←→ key, ↑↓ octave, click for harmony setup. Key + chord key = that chord key's octave |
| Sound (amber) | Sound menu: ←→ sound, ↑ effects. Sound + chord key = quick sound |
| Mode (coral) | Mode menu: ←→ mode, ↑ setup (tap Mode on BPM to tap tempo). Mode + chord key = quick mode |
| Wheel | Volume, or filter |
