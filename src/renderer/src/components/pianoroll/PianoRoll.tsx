import { useRef, useState } from "react";
import type { JSX } from "react";
import type { Note } from "@shared/types/project";
import { useSessionStore, noteWithDelta } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import { secToPx, pxToSec } from "../../core/timeline/viewport";
import { useCanvas } from "../useCanvas";
import { useTimelineWheel } from "../timeline/useTimelineWheel";

import {
  MIDI_LOW,
  MIDI_HIGH,
  ROW_H,
  ROLL_HEIGHT,
  BLACK_KEYS,
  midiToY,
  yToMidi,
} from "./layout";

const RESIZE_GRIP_PX = 6;

// Monochrome notation: committed notes are filled ink heads; selected notes are
// drawn as open (outlined) heads — quarter vs. half note — and takes are pencil.
const NOTE_COLOR = "#15140f";
const TAKE_GHOST_COLOR = "#15140f";

type DragState =
  | { kind: "move" | "resize"; startX: number; startY: number; moved: boolean }
  | {
      kind: "marquee";
      startX: number;
      startY: number;
      curX: number;
      curY: number;
    }
  | null;

export function PianoRoll(): JSX.Element {
  const viewport = useSessionStore((s) => s.viewport);
  const selection = useSessionStore((s) => s.selection);
  const dragDelta = useSessionStore((s) => s.dragDelta);
  const takeNotes = useSessionStore((s) => s.takeNotes);
  const notes = useProjectStore((s) => s.notes);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useTimelineWheel(containerRef);
  const [drag, setDrag] = useState<DragState>(null);

  const canvasRef = useCanvas((ctx, w, h) => {
    // Row stripes + octave lines
    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
      const y = midiToY(midi);
      if (y > h) continue;
      ctx.fillStyle = BLACK_KEYS.has(midi % 12)
        ? "rgba(21,20,15,0.05)"
        : "rgba(0,0,0,0)";
      ctx.fillRect(0, y, w, ROW_H);
      if (midi % 12 === 0) {
        ctx.strokeStyle = "rgba(21,20,15,0.18)";
        ctx.beginPath();
        ctx.moveTo(0, y + ROW_H);
        ctx.lineTo(w, y + ROW_H);
        ctx.stroke();
      }
    }

    const drawNote = (
      n: Note,
      fill: string,
      opts?: { hollow?: boolean; alpha?: number },
    ): void => {
      const x = secToPx(viewport, n.onsetSec);
      const wPx = Math.max(n.durationSec * viewport.pxPerSecond, 3);
      if (x + wPx < 0 || x > w) return;
      const y = midiToY(n.midi);
      ctx.globalAlpha = opts?.alpha ?? 1;
      if (opts?.hollow) {
        ctx.strokeStyle = fill;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 1, wPx - 1, ROW_H - 2);
      } else {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y + 1, wPx, ROW_H - 2);
      }
      ctx.globalAlpha = 1;
    };

    // Committed notes
    for (const note of notes) {
      const selected = selection.has(note.id);
      const rendered = noteWithDelta(note, selected, dragDelta);
      drawNote(rendered, NOTE_COLOR, { hollow: selected });
    }

    // Uncommitted take notes (ghosts)
    for (const t of takeNotes) {
      drawNote(
        {
          id: "",
          midi: t.midi,
          onsetSec: t.onsetSec,
          durationSec: t.durationSec,
          velocity: t.velocity,
        },
        TAKE_GHOST_COLOR,
        { hollow: true, alpha: 0.4 },
      );
    }

    // Marquee
    if (drag?.kind === "marquee") {
      ctx.strokeStyle = "rgba(21,20,15,0.7)";
      ctx.fillStyle = "rgba(21,20,15,0.06)";
      const x = Math.min(drag.startX, drag.curX);
      const y = Math.min(drag.startY, drag.curY);
      const mw = Math.abs(drag.curX - drag.startX);
      const mh = Math.abs(drag.curY - drag.startY);
      ctx.fillRect(x, y, mw, mh);
      ctx.strokeRect(x + 0.5, y + 0.5, mw, mh);
    }
  });

  const hitTest = (
    x: number,
    y: number,
  ): { note: Note; resize: boolean } | null => {
    const sec = pxToSec(viewport, x);
    const midi = yToMidi(y);
    // Iterate from the end so most recently added wins overlapping hits.
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.midi !== midi) continue;
      const x0 = secToPx(viewport, n.onsetSec);
      const x1 = secToPx(viewport, n.onsetSec + n.durationSec);
      const xEnd = Math.max(x1, x0 + 3);
      if (x >= x0 && x <= xEnd) {
        return {
          note: n,
          resize: x >= xEnd - RESIZE_GRIP_PX && xEnd - x0 > RESIZE_GRIP_PX * 2,
        };
      }
      void sec;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const session = useSessionStore.getState();
    const hit = hitTest(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (hit) {
      let next = new Set(session.selection);
      if (e.shiftKey) {
        if (next.has(hit.note.id)) next.delete(hit.note.id);
        else next.add(hit.note.id);
      } else if (!next.has(hit.note.id)) {
        next = new Set([hit.note.id]);
      }
      session.setSelection(next);
      setDrag({
        kind: hit.resize ? "resize" : "move",
        startX: x,
        startY: y,
        moved: false,
      });
    } else {
      if (!e.shiftKey) session.setSelection(new Set());
      setDrag({ kind: "marquee", startX: x, startY: y, curX: x, curY: y });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const session = useSessionStore.getState();

    if (drag.kind === "marquee") {
      setDrag({ ...drag, curX: x, curY: y });
      return;
    }

    const dSec = (x - drag.startX) / viewport.pxPerSecond;
    if (drag.kind === "resize") {
      session.setDragDelta({ dSec, dMidi: 0, resize: true });
    } else {
      const dMidi = yToMidi(y) - yToMidi(drag.startY);
      session.setDragDelta({ dSec, dMidi });
    }
    if (!drag.moved) setDrag({ ...drag, moved: true });
  };

  const onPointerUp = (): void => {
    if (!drag) return;
    const session = useSessionStore.getState();

    if (drag.kind === "marquee") {
      const t0 = pxToSec(viewport, Math.min(drag.startX, drag.curX));
      const t1 = pxToSec(viewport, Math.max(drag.startX, drag.curX));
      const mHi = yToMidi(Math.min(drag.startY, drag.curY));
      const mLo = yToMidi(Math.max(drag.startY, drag.curY));
      const next = new Set(session.selection);
      for (const n of notes) {
        if (
          n.onsetSec + n.durationSec >= t0 &&
          n.onsetSec <= t1 &&
          n.midi >= mLo &&
          n.midi <= mHi
        ) {
          next.add(n.id);
        }
      }
      session.setSelection(next);
    } else if (drag.moved && session.dragDelta) {
      // Commit the drag as a single undo step.
      const delta = session.dragDelta;
      const updates = new Map<string, Partial<Omit<Note, "id">>>();
      for (const n of notes) {
        if (!session.selection.has(n.id)) continue;
        const moved = noteWithDelta(n, true, delta);
        updates.set(n.id, {
          onsetSec: moved.onsetSec,
          durationSec: moved.durationSec,
          midi: moved.midi,
        });
      }
      useProjectStore.getState().updateNotes(updates);
    }
    session.setDragDelta(null);
    setDrag(null);
  };

  return (
    <div
      ref={containerRef}
      className="pianoroll-lane"
      style={{ height: ROLL_HEIGHT }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} className="lane-canvas" />
    </div>
  );
}
