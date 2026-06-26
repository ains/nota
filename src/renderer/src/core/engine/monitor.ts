/**
 * Live monitoring: sound the player's MIDI input immediately so they hear
 * themselves. Owns a registered MIDI handler (see Engine.registerMidiHandler)
 * for the engine's whole lifetime. It runs first and never consumes the event,
 * so the player hears every tap even if a later handler claims it.
 *
 * Framework-free, like the rest of core/engine; the state layer toggles it via
 * the thin Engine.setMonitoring facade.
 */
import type { Sampler } from "./Sampler";
import type { MidiNoteEvent } from "./MidiService";
import type { MidiHandler } from "./Engine";

export class Monitor {
  private enabled = true;

  constructor(
    private sampler: Sampler,
    registerMidiHandler: (fn: MidiHandler) => () => void,
  ) {
    registerMidiHandler((e) => this.onMidi(e));
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Sound the tap live; never consumes, so routing continues unimpeded. */
  private onMidi(e: MidiNoteEvent): void {
    if (!this.enabled) return;
    if (e.kind === "on") this.sampler.liveNoteOn(e.midi, e.velocity);
    else this.sampler.liveNoteOff(e.midi);
  }
}
