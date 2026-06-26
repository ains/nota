# Nota

A cross-platform desktop app (Electron + React + TypeScript) for musicians who transcribe
recordings with a MIDI keyboard and practice them with millisecond-level timing feedback.

## Workflow

1. **Open an audio file** (wav/mp3/flac/ogg/m4a) — the waveform appears above a piano roll
   on a shared, zoomable time axis.
2. **Record** a transcription from your MIDI keyboard while the audio plays (`R` to arm).
   Captured notes appear as green ghosts; _Keep Take_ commits them.
3. **Align**: select notes and nudge them onto the waveform transients —
   `←`/`→` = 1 ms, `⇧` = 10 ms, `⌘` = 50 ms, `↑`/`↓` = semitone. Snap is off by design:
   this is free-time alignment against a real recording. The aligned transcription is
   your ground truth.
4. **Practice**: switch to Practice mode and _Start Attempt_. The original audio plays;
   the app scores every note you play against the ground truth — blue = early,
   green = on time, red = late, with per-note ms labels, plus summary stats
   (mean signed offset, σ, % within ±10/20/30 ms) and per-attempt history.
5. **Loop**: drag in the loop lane to create a section; it loops seamlessly and every
   pass is scored independently so you can drill it and watch the trend.

## Timing architecture (why you can trust the numbers)

- MIDI event timestamps (`performance.now()` domain) are mapped onto the audio clock
  through a continuously drift-corrected fit of `AudioContext.getOutputTimestamp()`
  samples (`core/engine/ClockSync.ts`). The mapping answers “what was at the **speaker**
  when the key was struck”, so output latency is compensated by construction.
- Recording and practice scoring share the **same** mapping function
  (`core/engine/Recorder.ts`), so systematic errors cancel in relative terms.
- Residual absolute error (MIDI input latency etc.) is measured by the tap-along
  **calibration wizard** (⏱ Calibrate) and stored per MIDI-device × audio-output pair.
- Synth playback is scheduled ahead on the audio clock (lookahead scheduler); audio
  looping uses native sample-accurate `AudioBufferSourceNode` loop points.
- The status bar shows live clock diagnostics (sync source, skew, output delay, cal offset).

Note: Bluetooth audio has unstable latency — calibration can fix a constant offset but
not jitter. Use wired output for timing practice.

## Keyboard shortcuts

| Key                | Action                                 |
| ------------------ | -------------------------------------- |
| `Space`            | Play / pause                           |
| `Esc`              | Clear selection, then stop             |
| `R`                | Start / stop recording (edit mode)     |
| `⌘O` / `⌘⇧O`       | Open audio / open project              |
| `⌘S` / `⌘⇧S`       | Save / save as (`.nota` JSON)          |
| `⌘Z` / `⌘⇧Z`       | Undo / redo                            |
| `←`/`→` (+`⇧`/`⌘`) | Nudge selection 1 / 10 / 50 ms         |
| `↑`/`↓`            | Transpose selection a semitone         |
| `⌫`                | Delete selection                       |
| `⌘`+wheel          | Zoom (anchored at cursor); wheel = pan |

## Development

```bash
npm install
npm run dev        # Electron app with HMR
npm run test       # vitest unit tests (scoring engine, peaks, viewport, persistence)
npm run typecheck
npm run lint
npm run build:mac  # or build:win / build:linux
```

### Testing without MIDI hardware

In dev mode `window.__nota_dev` exposes the engine, stores and actions, e.g.
generate a click-track WAV, `loadAudioBytes()` it, inject synthetic events through
`engine['handleMidi']({kind:'on', midi, velocity, perfMs})`, and assert the reported
deviations. A constant +30 ms injection must read back as +30 ms. For real-input tests
use a virtual MIDI port (macOS: IAC Driver; Windows: loopMIDI).

### Code map

```
src/main/                 window, Web MIDI permission handlers, throttling flags, file IPC
src/preload/              typed contextBridge (window.nota)
src/shared/               project file types + IPC contracts
src/renderer/src/
  core/engine/            ClockSync, Transport, Scheduler, Sampler, MidiService,
                          Recorder (the one MIDI→timeline mapping), Calibration, Engine
  core/scoring/           pure DP note matcher (chords, repeats, loop seams, octaves) + stats
  core/audio/             waveform min/max peak pyramid (Web Worker)
  core/timeline/          shared viewport math (sec ⇄ px)
  state/                  zustand stores (project doc w/ zundo undo, session, practice)
  persistence/            .nota (de)serialization + versioning
  components/             canvas lanes (ruler, loop, waveform, piano roll), transport,
                          practice panel, calibration dialog
```

## Remaining roadmap

- MIDI file import/export (`@tonejs/midi`)
- App icon, recent-files menu, packaged-build signing/notarization
- Re-test the Web MIDI permission flow in packaged builds on all three platforms
