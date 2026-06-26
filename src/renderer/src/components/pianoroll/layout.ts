/** Piano roll pitch-axis layout shared by the roll and the keys gutter. */

export const MIDI_LOW = 21; // A0
export const MIDI_HIGH = 108; // C8
export const ROW_H = 9;

export const ROLL_HEIGHT = (MIDI_HIGH - MIDI_LOW + 1) * ROW_H;

export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export function midiToY(midi: number): number {
  return (MIDI_HIGH - midi) * ROW_H;
}

export function yToMidi(y: number): number {
  return Math.max(
    MIDI_LOW,
    Math.min(MIDI_HIGH, MIDI_HIGH - Math.floor(y / ROW_H)),
  );
}
