import type { JSX } from "react";
import { useCanvas } from "../useCanvas";
import {
  MIDI_LOW,
  MIDI_HIGH,
  ROW_H,
  midiToY,
  ROLL_HEIGHT,
  BLACK_KEYS,
} from "./layout";

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function KeysGutter(): JSX.Element {
  const canvasRef = useCanvas((ctx, w) => {
    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
      const y = midiToY(midi);
      const black = BLACK_KEYS.has(midi % 12);
      ctx.fillStyle = black ? "#22242e" : "#e8e8ee";
      ctx.fillRect(0, y, w, ROW_H);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.strokeRect(0, y + 0.5, w, ROW_H);
      if (midi % 12 === 0) {
        ctx.fillStyle = "#555";
        ctx.font = "8px system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(`${NOTE_NAMES[0]}${midi / 12 - 1}`, w - 18, y + ROW_H / 2);
      }
    }
  });

  return (
    <div className="keys-gutter" style={{ height: ROLL_HEIGHT }}>
      <canvas ref={canvasRef} className="lane-canvas" />
    </div>
  );
}
