/**
 * Maps live MIDI events onto the audio timeline during recording. This is the
 * single place formula (4) lives:
 *
 *   notePos(t_midi) = pos( ctxAtSpeaker(t_midi) )
 */
import type { ClockSync } from "./ClockSync";
import type { Transport } from "./Transport";

export interface TimedNoteEvent {
  kind: "on" | "off";
  midi: number;
  velocity: number;
  /** Folded position on the audio timeline (seconds) */
  posSec: number;
}

export interface CapturedNote {
  midi: number;
  onsetSec: number;
  durationSec: number;
  velocity: number;
}

const DEFAULT_NOTE_DURATION_SEC = 0.25;

export class NoteEventMapper {
  constructor(
    private clockSync: ClockSync,
    private transport: Transport,
  ) {}

  map(
    kind: "on" | "off",
    midi: number,
    velocity: number,
    perfMs: number,
  ): TimedNoteEvent {
    const ctxAtSpeaker = this.clockSync.ctxTimeAtSpeaker(perfMs);
    return {
      kind,
      midi,
      velocity,
      posSec: this.transport.posAtCtxTime(ctxAtSpeaker),
    };
  }
}

/**
 * Accumulates mapped note-on/off pairs into notes during a take. Allocation
 * here is per-note, not per-event hot-path-critical: a human plays at most
 * tens of notes per second, far below GC-pressure territory.
 */
export class TakeRecorder {
  private open = new Map<number, TimedNoteEvent>();
  private notes: CapturedNote[] = [];
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  get captured(): readonly CapturedNote[] {
    return this.notes;
  }

  start(): void {
    this.open.clear();
    this.notes = [];
    this.active = true;
  }

  /** Returns the finished take. */
  stop(): CapturedNote[] {
    // Close any still-held notes with a default duration.
    for (const on of this.open.values()) {
      this.pushNote(on, on.posSec + DEFAULT_NOTE_DURATION_SEC);
    }
    this.open.clear();
    this.active = false;
    return this.notes;
  }

  handle(e: TimedNoteEvent): CapturedNote | null {
    if (!this.active) return null;
    if (e.kind === "on") {
      const existing = this.open.get(e.midi);
      if (existing) this.pushNote(existing, e.posSec);
      this.open.set(e.midi, e);
      return null;
    }
    const on = this.open.get(e.midi);
    if (!on) return null;
    this.open.delete(e.midi);
    return this.pushNote(on, e.posSec);
  }

  private pushNote(on: TimedNoteEvent, offPosSec: number): CapturedNote {
    const note: CapturedNote = {
      midi: on.midi,
      onsetSec: on.posSec,
      durationSec: Math.max(0.02, offPosSec - on.posSec),
      velocity: on.velocity,
    };
    this.notes.push(note);
    return note;
  }
}
