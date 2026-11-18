# Tonic for the web

The browser version of Tonic. The chord theory, synth engine, looper and device firmware are a
TypeScript port of `TonicCore`; the engine runs in an AudioWorklet.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # ported TonicCore unit tests (vitest)
npm run build    # typecheck + production build in dist/
```

## Layout

```
src/core/      Port of TonicCore: theory, dsp (engine), device (firmware, menus), display (OLED), training
src/app/       Browser host: AudioWorklet, mic (tuner, sampler, vocoder), Web MIDI, persistence, UI
test/          Ported unit tests
```

## Differences from the iOS app

- MIDI goes to a Web MIDI output you choose in Settings (browsers can't publish a virtual port).
- Haptics use the Vibration API where it exists (Android).
- Settings, presets and the last mic sample are kept in localStorage.
- Computer keyboard: `1`–`7` or `A`–`J` play chords, `Q` `W` `E` are Key / Sound / Mode,
  arrow keys move the joystick and `Space` clicks it.
