## Development

```bash
npm install
npm run dev        # Electron app with HMR
npm run test       # vitest unit tests (scoring engine, peaks, viewport, persistence)
npm run typecheck
npm run lint
npm run build:mac  # or build:win / build:linux
```

### Native stem separation (demucs-rs)

Stem separation has two engines behind one UI: a native CLI built from
[demucs-rs](https://github.com/nikhilunni/demucs-rs) (Rust, much faster), and
a WebGPU WASM fallback that runs in the renderer. At runtime the app uses the
native binary whenever it is present and falls back to WebGPU otherwise.

Release builds always bundle the native CLI — the Release workflow builds it
on each platform before packaging. In development it is optional:

```bash
npm run build:demucs   # needs git + a Rust toolchain (https://rustup.rs)
```

This stages the binary at `resources/demucs/` (gitignored), where both
`npm run dev` and local packaged builds pick it up automatically. Overrides:

- `DEMUCS_RS_REPO` / `DEMUCS_RS_REF` — build from a different repo or tag.
- `NOTA_DEMUCS_CLI=/path/to/demucs` — point the app at an existing binary
  (e.g. from a demucs-rs checkout) without staging anything.

### Releasing (macOS + Windows builds)

Pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds and uploads macOS and Windows installers to a **draft** GitHub Release
for you to review and publish:

```bash
npm version 1.2.3      # bump package.json + create the v1.2.3 tag
git push --follow-tags
```

It needs repository secrets (Settings → Secrets and variables → Actions); the
workflow header documents exactly how to generate each:

macOS signing + notarization (required for the macOS build):

| Secret                 | What it is                                                   |
| ---------------------- | ------------------------------------------------------------ |
| `CSC_LINK`             | Base64 of your _Developer ID Application_ certificate (.p12) |
| `CSC_KEY_PASSWORD`     | Password for that .p12                                       |
| `APPLE_API_KEY_BASE64` | Base64 of your App Store Connect API key (.p8)               |
| `APPLE_API_KEY_ID`     | The API key's 10-char Key ID                                 |
| `APPLE_API_ISSUER`     | The API key Issuer ID (UUID)                                 |
| `APPLE_TEAM_ID`        | Your Apple Developer Team ID                                 |

Windows signing (optional — omit to ship an unsigned installer):

| Secret                     | What it is                                     |
| -------------------------- | ---------------------------------------------- |
| `WINDOWS_CSC_LINK`         | Base64 of your Authenticode certificate (.pfx) |
| `WINDOWS_CSC_KEY_PASSWORD` | Password for that certificate                  |

Local `npm run build:mac` still produces a host-architecture build and skips
notarization — it only runs in CI, where the Apple credentials live.

### Testing without MIDI hardware

In dev mode `window.__nota_dev` exposes the engine, stores and actions, e.g.
generate a click-track WAV, `loadAudioBytes()` it, inject synthetic events through
`engine['handleMidi']({kind:'on', midi, velocity, perfMs})`, and assert the reported
deviations. A constant +30 ms injection must read back as +30 ms. For real-input tests
use a virtual MIDI port (macOS: IAC Driver; Windows: loopMIDI).

### Code map

```
src/main/                 window, Web MIDI permission handlers, throttling flags, file IPC,
                          native demucs CLI runner
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

## Timing architecture

- MIDI event timestamps (`performance.now()` domain) are mapped onto the audio clock
  through a continuously drift-corrected fit of `AudioContext.getOutputTimestamp()`
  samples (`core/engine/ClockSync.ts`). The mapping answers “what was at the **speaker**
  when the key was struck”, so output latency is compensated by construction.
- Recording and practice scoring share the **same** mapping function
  (`core/engine/Recorder.ts`), so systematic errors cancel in relative terms.
- Synth playback is scheduled ahead on the audio clock (lookahead scheduler); audio
  looping uses native sample-accurate `AudioBufferSourceNode` loop points.
- The status bar shows live clock diagnostics (sync source, skew, output delay, cal offset).
