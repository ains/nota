import { describe, it, expect } from "vitest";
import {
  notesToMidiBytes,
  midiBytesToNotes,
} from "@renderer/persistence/midiFile";
import type { Note } from "@shared/types/project";

const notes: Note[] = [
  { id: "a", midi: 60, onsetSec: 0.5, durationSec: 0.25, velocity: 90 },
  { id: "b", midi: 64, onsetSec: 1.0, durationSec: 0.5, velocity: 64 },
  { id: "c", midi: 67, onsetSec: 1.7321, durationSec: 0.1, velocity: 127 },
];

describe("MIDI file round-trip", () => {
  it("preserves pitch, onset, duration and velocity within MIDI resolution", () => {
    const bytes = notesToMidiBytes(notes);
    const back = midiBytesToNotes(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    expect(back).toHaveLength(3);
    back.forEach((n, i) => {
      expect(n.midi).toBe(notes[i].midi);
      // PPQ-quantized: tolerate ~1 tick at 480 PPQ / 120 BPM ≈ 1.04ms
      expect(Math.abs(n.onsetSec - notes[i].onsetSec)).toBeLessThan(0.002);
      expect(Math.abs(n.durationSec - notes[i].durationSec)).toBeLessThan(
        0.002,
      );
      expect(Math.abs(n.velocity - notes[i].velocity)).toBeLessThanOrEqual(1);
    });
  });

  it("returns notes sorted by onset", () => {
    const shuffled: Note[] = [notes[2], notes[0], notes[1]];
    const bytes = notesToMidiBytes(shuffled);
    const back = midiBytesToNotes(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    for (let i = 1; i < back.length; i++) {
      expect(back[i].onsetSec).toBeGreaterThanOrEqual(back[i - 1].onsetSec);
    }
  });
});
