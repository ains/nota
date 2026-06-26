/**
 * MIDI file import/export. Notes live in absolute seconds; @tonejs/midi
 * converts through its tempo map (default 120 BPM on export, whatever the
 * file declares on import).
 */
import { Midi } from "@tonejs/midi";
import type { Note } from "@shared/types/project";

export function notesToMidiBytes(notes: readonly Note[]): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  track.name = "Nota transcription";
  for (const n of notes) {
    track.addNote({
      midi: n.midi,
      time: n.onsetSec,
      duration: n.durationSec,
      velocity: Math.min(1, Math.max(0, n.velocity / 127)),
    });
  }
  return midi.toArray();
}

export function midiBytesToNotes(bytes: ArrayBuffer): Omit<Note, "id">[] {
  const midi = new Midi(bytes);
  const notes: Omit<Note, "id">[] = [];
  for (const track of midi.tracks) {
    for (const n of track.notes) {
      notes.push({
        midi: n.midi,
        onsetSec: n.time,
        durationSec: Math.max(0.02, n.duration),
        velocity: Math.max(1, Math.round(n.velocity * 127)),
      });
    }
  }
  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return notes;
}
