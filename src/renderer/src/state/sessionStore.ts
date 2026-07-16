/**
 * Ephemeral UI/session state: viewport, selection, transport mirror,
 * in-progress drag deltas, and the live recording buffer. Not undoable, and
 * mostly not persisted — the exception is the audio-control mix (volumes/mutes),
 * which is seeded from and saved back to localStorage (see
 * persistence/audioSettings).
 */
import { create } from "zustand";
import type { Note, StemName } from "@shared/types/project";
import { DEFAULT_PLAYBACK_RATE } from "../constants";
import { StemJobState } from "./stemJobState";
import { loadAudioSettings } from "../persistence/audioSettings";
import type { Viewport } from "../core/timeline/viewport";
import type { PeakPyramid } from "../core/audio/peaks";
import type { CapturedNote } from "../core/engine/Recorder";
import type { MidiDeviceInfo } from "../core/engine/MidiService";

/** Top-level screen: the project library, or the transcription editor. */
export type AppView = "library" | "editor";

export interface DragDelta {
  dSec: number;
  dMidi: number;
  /** When set, the drag resizes duration instead of moving. */
  resize?: boolean;
}

/**
 * An ephemeral loop region the user is sketching by dragging across the
 * waveform. It renders in the loop lane in the active style; clicking it
 * saves it as a real region, clicking elsewhere discards it.
 */
export interface PendingRegion {
  startSec: number;
  endSec: number;
}

export interface SessionState {
  view: AppView;
  viewport: Viewport;
  /** Lane width in CSS px, kept up to date by the lanes container */
  laneWidthPx: number;
  peaks: PeakPyramid | null;
  audioLoading: boolean;

  isPlaying: boolean;
  isRecording: boolean;

  selection: Set<string>;
  dragDelta: DragDelta | null;
  /**
   * Notes captured during an in-progress recording. Rendered alongside the
   * document's notes for live feedback, then folded into the project (one undo
   * step) when recording stops. Ephemeral: never undoable or saved.
   */
  uncommittedNotes: CapturedNote[];

  /** Active loop region id (drives the transport loop) */
  activeLoopId: string | null;
  /** Unsaved loop region sketched on the waveform, awaiting save/discard */
  pendingRegion: PendingRegion | null;

  midiDevices: MidiDeviceInfo[];
  activeMidiDeviceId: string | null;
  midiError: string | null;
  audioMuted: boolean;
  synthMuted: boolean;
  /** Music (audio file) playback volume, 0..1 */
  musicVolume: number;
  /** Synth (sampler) playback volume, 0..1 */
  synthVolume: number;
  /** Per-stem playback volumes, 0..1 (shown once stems exist) */
  stemVolumes: Record<StemName, number>;
  stemMutes: Record<StemName, boolean>;
  /** Whether separated stems are loaded into the transport */
  stemsReady: boolean;
  /** State of the stem-separation pipeline */
  stemJobState: StemJobState;
  /** Playback speed multiplier (pitch preserved) */
  playbackRate: number;
  /** Whether the piano roll lane is shown below the waveform */
  showPianoRoll: boolean;
  /** Whether the right-side volume drawer is shown */
  showVolumeDrawer: boolean;

  setView(v: AppView): void;
  setViewport(vp: Viewport): void;
  setLaneWidth(px: number): void;
  setPeaks(p: PeakPyramid | null): void;
  setAudioLoading(b: boolean): void;
  setIsPlaying(b: boolean): void;
  setIsRecording(b: boolean): void;
  setSelection(ids: Set<string>): void;
  setDragDelta(d: DragDelta | null): void;
  setUncommittedNotes(notes: CapturedNote[]): void;
  appendUncommittedNote(note: CapturedNote): void;
  setActiveLoopId(id: string | null): void;
  setPendingRegion(r: PendingRegion | null): void;
  setMidiDevices(devices: MidiDeviceInfo[], activeId: string | null): void;
  setMidiError(error: string | null): void;
  setAudioMuted(b: boolean): void;
  setSynthMuted(b: boolean): void;
  setMusicVolume(v: number): void;
  setSynthVolume(v: number): void;
  setStemVolume(stem: StemName, v: number): void;
  setStemMuted(stem: StemName, muted: boolean): void;
  setStemsReady(b: boolean): void;
  setStemJobState(job: StemJobState): void;
  setPlaybackRate(v: number): void;
  setShowPianoRoll(b: boolean): void;
  setShowVolumeDrawer(b: boolean): void;
}

const audioSettings = loadAudioSettings();

export const useSessionStore = create<SessionState>()((set) => ({
  view: "library",
  viewport: { pxPerSecond: 100, scrollSec: 0 },
  laneWidthPx: 800,
  peaks: null,
  audioLoading: false,

  isPlaying: false,
  isRecording: false,

  selection: new Set<string>(),
  dragDelta: null,
  uncommittedNotes: [],

  activeLoopId: null,
  pendingRegion: null,

  midiDevices: [],
  activeMidiDeviceId: null,
  midiError: null,
  audioMuted: audioSettings.audioMuted,
  synthMuted: audioSettings.synthMuted,
  musicVolume: audioSettings.musicVolume,
  synthVolume: audioSettings.synthVolume,
  stemVolumes: audioSettings.stemVolumes,
  stemMutes: audioSettings.stemMutes,
  stemsReady: false,
  stemJobState: StemJobState.idle(),
  playbackRate: DEFAULT_PLAYBACK_RATE,
  showPianoRoll: false,
  showVolumeDrawer: false,

  setView: (view) => set({ view }),
  setViewport: (viewport) => set({ viewport }),
  setLaneWidth: (laneWidthPx) => set({ laneWidthPx }),
  setPeaks: (peaks) => set({ peaks }),
  setAudioLoading: (audioLoading) => set({ audioLoading }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setSelection: (selection) => set({ selection }),
  setDragDelta: (dragDelta) => set({ dragDelta }),
  setUncommittedNotes: (uncommittedNotes) => set({ uncommittedNotes }),
  appendUncommittedNote: (note) =>
    set((s) => ({ uncommittedNotes: [...s.uncommittedNotes, note] })),
  setActiveLoopId: (activeLoopId) => set({ activeLoopId }),
  setPendingRegion: (pendingRegion) => set({ pendingRegion }),
  setMidiDevices: (midiDevices, activeMidiDeviceId) =>
    set({ midiDevices, activeMidiDeviceId }),
  setMidiError: (midiError) => set({ midiError }),
  setAudioMuted: (audioMuted) => set({ audioMuted }),
  setSynthMuted: (synthMuted) => set({ synthMuted }),
  setMusicVolume: (musicVolume) => set({ musicVolume }),
  setSynthVolume: (synthVolume) => set({ synthVolume }),
  setStemVolume: (stem, v) =>
    set((s) => ({ stemVolumes: { ...s.stemVolumes, [stem]: v } })),
  setStemMuted: (stem, muted) =>
    set((s) => ({ stemMutes: { ...s.stemMutes, [stem]: muted } })),
  setStemsReady: (stemsReady) => set({ stemsReady }),
  setStemJobState: (stemJobState) => set({ stemJobState }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setShowPianoRoll: (showPianoRoll) => set({ showPianoRoll }),
  setShowVolumeDrawer: (showVolumeDrawer) => set({ showVolumeDrawer }),
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
