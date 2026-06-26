/**
 * Piano sampler built on smplr's SplendidGrandPiano. Two jobs:
 *  - live monitoring of MIDI input (noteOn/noteOff "now")
 *  - sample-accurately scheduled playback of transcription notes at explicit
 *    AudioContext times (the Scheduler's output)
 *
 * Samples are cached in CacheStorage after first load, so the app works
 * offline after one run with network access.
 */
import { SplendidGrandPiano, CacheStorage } from "smplr";

export class Sampler {
  private piano: SplendidGrandPiano;
  private ready = false;
  private loadPromise: Promise<void>;
  /** stop functions for scheduled (non-live) voices, keyed for cancellation */
  private scheduled = new Map<string, (time?: number) => void>();

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.piano = SplendidGrandPiano(ctx, {
      storage: CacheStorage("nota-soundfont"),
      destination,
    });
    this.loadPromise = this.piano.load.then(() => {
      this.ready = true;
    });
  }

  get isReady(): boolean {
    return this.ready;
  }

  whenReady(): Promise<void> {
    return this.loadPromise;
  }

  /** Live monitoring: sound a note immediately. */
  liveNoteOn(midi: number, velocity: number): void {
    if (!this.ready) return;
    this.piano.start({ note: midi, velocity, stopId: `live-${midi}` });
  }

  liveNoteOff(midi: number): void {
    if (!this.ready) return;
    this.piano.stop({ stopId: `live-${midi}` });
  }

  /**
   * Schedule a note at an exact context time. `key` identifies the voice so a
   * pending future note can be cancelled (loop change, transport stop).
   */
  scheduleNote(
    key: string,
    midi: number,
    velocity: number,
    ctxOn: number,
    durationSec: number,
  ): void {
    if (!this.ready) return;
    const stop = this.piano.start({
      note: midi,
      velocity,
      time: ctxOn,
      duration: durationSec,
      onEnded: () => this.scheduled.delete(key),
    });
    this.scheduled.set(key, stop);
  }

  /** Cancel every scheduled (not-yet-ended) voice — loop edit or stop. */
  cancelAllScheduled(): void {
    for (const stop of this.scheduled.values()) {
      try {
        stop();
      } catch {
        // voice may have ended between map read and call
      }
    }
    this.scheduled.clear();
  }

  hasScheduled(key: string): boolean {
    return this.scheduled.has(key);
  }

  setVolume(volume0to127: number): void {
    this.piano.output.volume = volume0to127;
  }
}
