/**
 * Take recording. While a take is active it owns a registered MIDI handler
 * (see Engine.registerMidiHandler): each tap, once the transport is playing, is
 * mapped through the shared NoteEventMapper and accumulated into notes. The
 * handler registers after monitoring, so it only captures taps that didn't
 * get claimed first.
 *
 * Framework-free, like the rest of core/engine; the state layer drives it via
 * the thin Engine.startRecording / stopRecording facade.
 */
import type { Transport } from "./Transport";
import {
  TakeRecorder,
  type CapturedNote,
  type NoteEventMapper,
} from "./Recorder";
import type { MidiNoteEvent } from "./MidiService";
import type { MidiHandler } from "./Engine";

export class RecordingSession {
  private recorder = new TakeRecorder();
  private onNote: ((note: CapturedNote) => void) | null = null;
  private unregister: (() => void) | null = null;

  constructor(
    private transport: Transport,
    private mapper: NoteEventMapper,
    private registerMidiHandler: (fn: MidiHandler) => () => void,
  ) {}

  get isActive(): boolean {
    return this.recorder.isActive;
  }

  start(onNote: (note: CapturedNote) => void): void {
    this.onNote = onNote;
    this.recorder.start();
    this.unregister = this.registerMidiHandler((e) => this.onMidi(e));
  }

  /** Returns the finished take; keep=false discards it. */
  stop(keep: boolean): CapturedNote[] {
    if (!this.recorder.isActive) return [];
    const take = this.recorder.stop();
    this.onNote = null;
    this.unregister?.();
    this.unregister = null;
    return keep ? take : [];
  }

  /** Maps the tap and accumulates it; only while the transport is playing. */
  private onMidi(e: MidiNoteEvent): void {
    if (!this.transport.isPlaying) return;
    const mapped = this.mapper.map(e.kind, e.midi, e.velocity, e.perfMs);
    const note = this.recorder.handle(mapped);
    if (note) this.onNote?.(note);
  }
}
