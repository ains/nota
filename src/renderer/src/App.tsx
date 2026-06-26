import { useEffect, useRef } from "react";
import type { JSX } from "react";
import type { Note } from "@shared/types/project";
import { TransportBar } from "./components/transport/TransportBar";
import { TimeRuler } from "./components/timeline/TimeRuler";
import { LoopLane } from "./components/timeline/LoopLane";
import { Playhead } from "./components/timeline/Playhead";
import { WaveformLane } from "./components/waveform/WaveformLane";
import { PianoRoll } from "./components/pianoroll/PianoRoll";
import { KeysGutter } from "./components/pianoroll/KeysGutter";
import { RollOptionsBar } from "./components/pianoroll/RollOptionsBar";
import { Library } from "./components/library/Library";
import {
  initEngineBindings,
  togglePlay,
  stopTransport,
  openAudioFile,
  openProject,
  saveProject,
  startRecording,
  stopRecording,
  getEngineRef,
} from "./state/appActions";
import { useProjectStore, undo, redo } from "./state/projectStore";
import { useSessionStore } from "./state/sessionStore";
import { formatTime } from "./core/timeline/viewport";

export const GUTTER_W = 56;

const NUDGE_PLAIN_SEC = 0.001;
const NUDGE_SHIFT_SEC = 0.01;
const NUDGE_CMD_SEC = 0.05;

function handleEditKeys(e: KeyboardEvent): boolean {
  const session = useSessionStore.getState();
  if (session.selection.size === 0) return false;
  const project = useProjectStore.getState();

  const nudge = (dSec: number, dMidi: number): void => {
    const updates = new Map<string, Partial<Omit<Note, "id">>>();
    for (const n of project.notes) {
      if (!session.selection.has(n.id)) continue;
      updates.set(n.id, {
        onsetSec: Math.max(0, n.onsetSec + dSec),
        midi: Math.min(127, Math.max(0, n.midi + dMidi)),
      });
    }
    project.updateNotes(updates);
  };

  switch (e.key) {
    case "ArrowLeft":
    case "ArrowRight": {
      const sign = e.key === "ArrowRight" ? 1 : -1;
      const step =
        e.metaKey || e.ctrlKey
          ? NUDGE_CMD_SEC
          : e.shiftKey
            ? NUDGE_SHIFT_SEC
            : NUDGE_PLAIN_SEC;
      nudge(sign * step, 0);
      return true;
    }
    case "ArrowUp":
    case "ArrowDown":
      nudge(0, e.key === "ArrowUp" ? 1 : -1);
      return true;
    case "Delete":
    case "Backspace":
      project.deleteNotes(session.selection);
      session.setSelection(new Set());
      return true;
    case "Escape":
      session.setSelection(new Set());
      return true;
  }
  return false;
}

function NudgeHud(): JSX.Element | null {
  const selection = useSessionStore((s) => s.selection);
  const notes = useProjectStore((s) => s.notes);
  if (selection.size === 0) return null;
  const selected = notes.filter((n) => selection.has(n.id));
  if (selected.length === 0) return null;
  const first = selected.reduce((a, b) => (a.onsetSec < b.onsetSec ? a : b));
  return (
    <div className="nudge-hud">
      {selection.size === 1
        ? `note @ ${formatTime(first.onsetSec)}`
        : `${selection.size} notes, first @ ${formatTime(first.onsetSec)}`}
      <span className="hud-hint">
        {" "}
        ←/→ 1ms · ⇧ 10ms · ⌘ 50ms · ↑/↓ semitone
      </span>
    </div>
  );
}

function RollToggleBar(): JSX.Element {
  const showPianoRoll = useSessionStore((s) => s.showPianoRoll);
  const setShowPianoRoll = useSessionStore((s) => s.setShowPianoRoll);
  return (
    <div className="roll-toggle-bar">
      <button
        className="roll-toggle"
        onClick={() => setShowPianoRoll(!showPianoRoll)}
        title={showPianoRoll ? "Hide piano roll" : "Show piano roll"}
      >
        {showPianoRoll ? "▾" : "▴"} Piano Roll
      </button>
    </div>
  );
}

function App(): JSX.Element {
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const view = useSessionStore((s) => s.view);
  const showPianoRoll = useSessionStore((s) => s.showPianoRoll);

  useEffect(() => {
    initEngineBindings();
  }, []);

  // Track lane width for viewport clamping.
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      useSessionStore
        .getState()
        .setLaneWidth(el.getBoundingClientRect().width - GUTTER_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      )
        return;

      const cmd = e.metaKey || e.ctrlKey;
      // Open dialogs work from either screen; everything else is editor-only.
      if (cmd && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (e.shiftKey) void openProject();
        else void openAudioFile();
        return;
      }
      if (useSessionStore.getState().view !== "editor") return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
        return;
      }
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!cmd && e.key.toLowerCase() === "r") {
        e.preventDefault();
        const engine = getEngineRef();
        if (engine.isRecording) stopRecording(true);
        else startRecording();
        return;
      }
      if (
        e.key === "Escape" &&
        useSessionStore.getState().selection.size === 0
      ) {
        stopTransport();
        return;
      }
      if (handleEditKeys(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (view === "library") {
    return (
      <div className="app">
        <Library />
      </div>
    );
  }

  return (
    <div className="app">
      <TransportBar />
      <div className="timeline-area" ref={lanesRef}>
        <div className="lane-row" style={{ height: 26 }}>
          <div className="gutter-spacer" />
          <TimeRuler />
        </div>
        <div className="lane-row" style={{ height: 24 }}>
          <div className="gutter-spacer" />
          <LoopLane />
        </div>
        <div
          className="lane-row"
          style={showPianoRoll ? { height: 130 } : { flex: 1, minHeight: 0 }}
        >
          <div className="gutter-spacer" />
          <WaveformLane />
        </div>
        <RollToggleBar />
        {showPianoRoll && (
          <>
            <RollOptionsBar />
            <div className="roll-scroll">
              <KeysGutter />
              <PianoRoll />
            </div>
          </>
        )}
        <div className="playhead-clip">
          <Playhead />
        </div>
      </div>
      <NudgeHud />
    </div>
  );
}

export default App;
