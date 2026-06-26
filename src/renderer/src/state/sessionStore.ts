/**
 * Ephemeral UI/session state: viewport, selection, transport mirror,
 * in-progress drag deltas, take-in-progress notes. Never persisted, never
 * undoable.
 */
import { create } from "zustand";
import type { Note } from "@shared/types/project";
import type { Viewport } from "../core/timeline/viewport";
import type { PeakPyramid } from "../core/audio/peaks";
import type { CapturedNote } from "../core/engine/Recorder";
import type { MidiDeviceInfo } from "../core/engine/MidiService";

export interface DragDelta {
  dSec: number;
  dMidi: number;
  /** When set, the drag resizes duration instead of moving. */
  resize?: boolean;
}

export interface SessionState {
  viewport: Viewport;
  /** Lane width in CSS px, kept up to date by the lanes container */
  laneWidthPx: number;
  peaks: PeakPyramid | null;
  audioLoading: boolean;

  isPlaying: boolean;
  isRecording: boolean;

  selection: Set<string>;
  dragDelta: DragDelta | null;
  /** Uncommitted take notes (ghost rendering during/after recording) */
  takeNotes: CapturedNote[];

  /** Active loop region id (drives the transport loop) */
  activeLoopId: string | null;

  midiDevices: MidiDeviceInfo[];
  activeMidiDeviceId: string | null;
  midiError: string | null;
  audioMuted: boolean;
  synthMuted: boolean;
  /** Master output volume, 0..1 */
  masterVolume: number;
  /** Whether the piano roll lane is shown below the waveform */
  showPianoRoll: boolean;

  setViewport(vp: Viewport): void;
  setLaneWidth(px: number): void;
  setPeaks(p: PeakPyramid | null): void;
  setAudioLoading(b: boolean): void;
  setIsPlaying(b: boolean): void;
  setIsRecording(b: boolean): void;
  setSelection(ids: Set<string>): void;
  setDragDelta(d: DragDelta | null): void;
  setTakeNotes(notes: CapturedNote[]): void;
  appendTakeNote(note: CapturedNote): void;
  setActiveLoopId(id: string | null): void;
  setMidiDevices(devices: MidiDeviceInfo[], activeId: string | null): void;
  setMidiError(error: string | null): void;
  setAudioMuted(b: boolean): void;
  setSynthMuted(b: boolean): void;
  setMasterVolume(v: number): void;
  setShowPianoRoll(b: boolean): void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  viewport: { pxPerSecond: 100, scrollSec: 0 },
  laneWidthPx: 800,
  peaks: null,
  audioLoading: false,

  isPlaying: false,
  isRecording: false,

  selection: new Set<string>(),
  dragDelta: null,
  takeNotes: [],

  activeLoopId: null,

  midiDevices: [],
  activeMidiDeviceId: null,
  midiError: null,
  audioMuted: false,
  synthMuted: false,
  masterVolume: 1,
  showPianoRoll: false,

  setViewport: (viewport) => set({ viewport }),
  setLaneWidth: (laneWidthPx) => set({ laneWidthPx }),
  setPeaks: (peaks) => set({ peaks }),
  setAudioLoading: (audioLoading) => set({ audioLoading }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setSelection: (selection) => set({ selection }),
  setDragDelta: (dragDelta) => set({ dragDelta }),
  setTakeNotes: (takeNotes) => set({ takeNotes }),
  appendTakeNote: (note) => set((s) => ({ takeNotes: [...s.takeNotes, note] })),
  setActiveLoopId: (activeLoopId) => set({ activeLoopId }),
  setMidiDevices: (midiDevices, activeMidiDeviceId) =>
    set({ midiDevices, activeMidiDeviceId }),
  setMidiError: (midiError) => set({ midiError }),
  setAudioMuted: (audioMuted) => set({ audioMuted }),
  setSynthMuted: (synthMuted) => set({ synthMuted }),
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setShowPianoRoll: (showPianoRoll) => set({ showPianoRoll }),
}));

/** Apply an in-progress drag delta to a note for rendering. */
export function noteWithDelta(
  note: Note,
  selected: boolean,
  delta: DragDelta | null,
): Note {
  if (!selected || !delta) return note;
  if (delta.resize) {
    return {
      ...note,
      durationSec: Math.max(0.02, note.durationSec + delta.dSec),
    };
  }
  return {
    ...note,
    onsetSec: note.onsetSec + delta.dSec,
    midi: Math.min(127, Math.max(0, note.midi + delta.dMidi)),
  };
}
