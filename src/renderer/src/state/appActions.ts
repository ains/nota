/**
 * Controller layer: the only place that wires the timing engine to the
 * stores. React components call these actions; they never touch the engine
 * directly.
 */
import { getEngine } from "../core/engine/Engine";
import { buildPeaksAsync } from "../core/audio/buildPeaks";
import { zoomAt, clampScroll } from "../core/timeline/viewport";
import {
  serializeProject,
  deserializeProject,
} from "../persistence/projectFile";
import { notesToMidiBytes, midiBytesToNotes } from "../persistence/midiFile";
import {
  addRecentProject,
  removeRecentProject,
} from "../persistence/recentProjects";
import { useProjectStore, clearHistory } from "./projectStore";
import { useSessionStore } from "./sessionStore";

const engine = getEngine();

let bindingsInitialized = false;

export function initEngineBindings(): void {
  // React StrictMode double-invokes mount effects in dev; bind once.
  if (bindingsInitialized) return;
  bindingsInitialized = true;

  void engine.init().then(() => syncMidiDevices());

  engine.transport.onChange(() => {
    useSessionStore.getState().setIsPlaying(engine.transport.isPlaying);
  });

  const session = useSessionStore.getState();
  engine.scheduler.setMuted(session.synthMuted);
  engine.transport.setMusicVolume(session.musicVolume);
  engine.transport.setSynthVolume(session.synthVolume);

  // Keep the playback scheduler's note list in sync with the document.
  engine.scheduler.setNotes(useProjectStore.getState().notes);
  useProjectStore.subscribe((s, prev) => {
    if (s.notes !== prev.notes) engine.scheduler.setNotes(s.notes);
  });

  engine.midi.onDevicesChanged(() => syncMidiDevices());
  engine.midi.onActiveDeviceDisconnected(() => {
    // Preserve an in-flight take rather than losing it to a dead device.
    if (engine.isRecording) stopRecording(true);
    engine.transport.pause();
  });
}

function syncMidiDevices(): void {
  useSessionStore
    .getState()
    .setMidiDevices(engine.midi.devices, engine.midi.activeDeviceId);
  // A late-resolving MIDI request can succeed after init() reported an error;
  // device readiness wins.
  useSessionStore
    .getState()
    .setMidiError(engine.midi.isReady ? null : engine.midiError);
}

export async function retryMidi(): Promise<void> {
  await engine.retryMidi();
  syncMidiDevices();
}

export function selectMidiDevice(id: string | null): void {
  engine.midi.selectDevice(id);
  syncMidiDevices();
}

// --- audio / project files ---

/** Record a saved project in the library of recently opened projects. */
function recordRecent(path: string, audioFileName: string): void {
  const name =
    path
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "project";
  addRecentProject({ path, name, audioFileName });
}

export async function openAudioFile(): Promise<void> {
  const result = await window.nota.openAudioFile();
  if (!result) return;
  await loadAudioIntoApp(result, true);
  useSessionStore.getState().setView("editor");
}

/** Create a new project from a dropped/selected audio File (library screen). */
export async function createProjectFromAudioFile(file: File): Promise<void> {
  const path = window.nota.getPathForFile(file);
  if (!path) return;
  const audio = await window.nota.readAudioFile(path);
  if (!audio) return;
  try {
    await loadAudioIntoApp(audio, true);
  } catch (err) {
    console.error("Failed to load dropped audio:", err);
    return;
  }
  useSessionStore.getState().setView("editor");
}

async function loadAudioIntoApp(
  file: {
    absolutePath: string;
    fileName: string;
    bytes: ArrayBuffer;
    sha256: string;
  },
  asNewProject: boolean,
): Promise<void> {
  const session = useSessionStore.getState();
  session.setAudioLoading(true);
  session.setPeaks(null);
  try {
    const buffer = await engine.transport.loadAudio(file.bytes);
    const audioRef = {
      fileName: file.fileName,
      absolutePath: file.absolutePath,
      sha256: file.sha256,
      durationSec: buffer.duration,
    };
    if (asNewProject) {
      useProjectStore.getState().newProject(audioRef);
      clearHistory();
      useSessionStore.getState().setActiveLoopId(null);
      engine.transport.setLoop(null);
    } else {
      useProjectStore.getState().setAudio(audioRef);
    }
    // Fit the whole file in view.
    const widthPx = useSessionStore.getState().laneWidthPx;
    useSessionStore.getState().setViewport({
      pxPerSecond: Math.max(2, widthPx / Math.max(buffer.duration, 1)),
      scrollSec: 0,
    });
    const peaks = await buildPeaksAsync(buffer);
    useSessionStore.getState().setPeaks(peaks);
  } finally {
    useSessionStore.getState().setAudioLoading(false);
  }
}

export async function openProject(): Promise<void> {
  const result = await window.nota.openProject();
  if (!result) return;
  await loadProjectFromFile(result.path, result.json);
}

/** Open a previously saved project by path (library screen). */
export async function openProjectByPath(path: string): Promise<void> {
  const json = await window.nota.readProjectFile(path);
  if (json === null) {
    // File moved or deleted: drop it from the library.
    removeRecentProject(path);
    return;
  }
  await loadProjectFromFile(path, json);
}

async function loadProjectFromFile(path: string, json: string): Promise<void> {
  let data;
  try {
    data = deserializeProject(json);
  } catch (err) {
    console.error("Failed to parse project:", err);
    return;
  }

  let audioFile = await window.nota.readAudioFile(data.audio.absolutePath);
  if (!audioFile) {
    audioFile = await window.nota.relinkAudio(data.audio.fileName);
    if (!audioFile) return;
  }
  if (audioFile.sha256 !== data.audio.sha256) {
    console.warn(
      "Audio file content differs from the one this project was created with.",
    );
  }

  useProjectStore.getState().loadProject({
    audio: { ...data.audio, absolutePath: audioFile.absolutePath },
    notes: data.notes,
    loopRegions: data.loopRegions,
    projectPath: path,
  });
  clearHistory();
  useSessionStore.getState().setActiveLoopId(null);
  await loadAudioIntoApp(audioFile, false);
  // loadAudioIntoApp(asNewProject=false) already set the (possibly relinked)
  // audio ref and a fit-to-window viewport; restore the saved view over it.
  if (data.view) {
    const session = useSessionStore.getState();
    const { pxPerSecond, scrollSec, playheadSec } = data.view;
    const restored = clampScroll(
      { pxPerSecond, scrollSec },
      data.audio.durationSec,
      session.laneWidthPx,
    );
    session.setViewport(restored);
    engine.transport.seek(playheadSec);
  }
  useProjectStore.getState().markSaved(path);
  recordRecent(path, data.audio.fileName);
  useSessionStore.getState().setView("editor");
}

/**
 * Return to the project library, persisting work first: a project with a path
 * is auto-saved (capturing edits and the current view — zoom, scroll, playhead);
 * an unsaved project prompts a save-as dialog (cancelling discards it). Saving
 * happens before stopping so the saved playhead is the current position.
 */
export async function backToLibrary(): Promise<void> {
  if (engine.isRecording) stopRecording(false);
  const p = useProjectStore.getState();
  if (p.audio) await saveProject();
  engine.transport.stop();
  useSessionStore.getState().setView("library");
}

export async function saveProject(saveAs = false): Promise<void> {
  const p = useProjectStore.getState();
  if (!p.audio) return;
  const { viewport } = useSessionStore.getState();
  const json = serializeProject({
    audio: p.audio,
    notes: p.notes,
    loopRegions: p.loopRegions,
    view: {
      pxPerSecond: viewport.pxPerSecond,
      scrollSec: viewport.scrollSec,
      playheadSec: engine.transport.position,
    },
  });
  if (p.projectPath && !saveAs) {
    await window.nota.saveProject(p.projectPath, json);
    p.markSaved(p.projectPath);
    recordRecent(p.projectPath, p.audio.fileName);
  } else {
    const suggested = p.audio.fileName.replace(/\.[^.]+$/, "");
    const path = await window.nota.saveProjectAs(json, suggested);
    if (path) {
      p.markSaved(path);
      recordRecent(path, p.audio.fileName);
    }
  }
}

export async function importMidi(): Promise<void> {
  const bytes = await window.nota.importMidiFile();
  if (!bytes) return;
  const notes = midiBytesToNotes(bytes);
  if (notes.length > 0) useProjectStore.getState().addNotes(notes);
}

export async function exportMidi(): Promise<void> {
  const p = useProjectStore.getState();
  if (p.notes.length === 0) return;
  const suggested = p.audio
    ? p.audio.fileName.replace(/\.[^.]+$/, "")
    : "transcription";
  await window.nota.exportMidiFile(notesToMidiBytes(p.notes), suggested);
}

// --- transport ---

export function togglePlay(): void {
  if (engine.transport.isPlaying) {
    engine.transport.pause();
  } else {
    void engine.transport.play();
  }
}

export function stopTransport(): void {
  if (engine.isRecording) stopRecording(true);
  engine.transport.stop();
}

export function seek(sec: number): void {
  engine.transport.seek(sec);
}

export function setAudioMuted(muted: boolean): void {
  engine.transport.setAudioMuted(muted);
  useSessionStore.getState().setAudioMuted(muted);
}

export function setSynthMuted(muted: boolean): void {
  engine.scheduler.setMuted(muted);
  useSessionStore.getState().setSynthMuted(muted);
}

export function setMusicVolume(volume: number): void {
  engine.transport.setMusicVolume(volume);
  useSessionStore.getState().setMusicVolume(volume);
}

export function setSynthVolume(volume: number): void {
  engine.transport.setSynthVolume(volume);
  useSessionStore.getState().setSynthVolume(volume);
}

/** Zoom to an absolute pxPerSecond, keeping the centre of the view fixed. */
export function setZoom(pxPerSecond: number): void {
  const session = useSessionStore.getState();
  const width = session.laneWidthPx;
  const factor = pxPerSecond / session.viewport.pxPerSecond;
  const zoomed = zoomAt(session.viewport, width / 2, factor);
  const duration = useProjectStore.getState().audio?.durationSec ?? 60;
  session.setViewport(clampScroll(zoomed, duration, width));
}

// --- loop regions ---

export function setActiveLoop(regionId: string | null): void {
  const session = useSessionStore.getState();
  session.setActiveLoopId(regionId);
  const region = useProjectStore
    .getState()
    .loopRegions.find((r) => r.id === regionId);
  engine.transport.setLoop(
    region ? { start: region.startSec, end: region.endSec } : null,
  );
}

/** Re-apply the active loop to the transport after a region edit. */
export function refreshActiveLoop(): void {
  setActiveLoop(useSessionStore.getState().activeLoopId);
}

// --- recording ---

export function startRecording(): void {
  const session = useSessionStore.getState();
  session.setTakeNotes([]);
  engine.startRecording((note) =>
    useSessionStore.getState().appendTakeNote(note),
  );
  session.setIsRecording(true);
  if (!engine.transport.isPlaying) void engine.transport.play();
}

export function stopRecording(keep: boolean): void {
  engine.stopRecording(keep);
  const session = useSessionStore.getState();
  session.setIsRecording(false);
  if (!keep) session.setTakeNotes([]);
}

/** Commit the captured take into the project as one undo step. */
export function commitTake(): void {
  const take = useSessionStore.getState().takeNotes;
  if (take.length === 0) return;
  useProjectStore.getState().addNotes(
    take.map((n) => ({
      midi: n.midi,
      onsetSec: n.onsetSec,
      durationSec: n.durationSec,
      velocity: n.velocity,
    })),
  );
  useSessionStore.getState().setTakeNotes([]);
}

export function discardTake(): void {
  useSessionStore.getState().setTakeNotes([]);
}

export function getEngineRef(): ReturnType<typeof getEngine> {
  return engine;
}

// Dev-only hook for end-to-end testing without dialogs or MIDI hardware
// (e.g. load a generated click track, inject notes, drive the transport).
if (import.meta.env.DEV) {
  Object.assign(window as object, {
    __nota_dev: {
      engine,
      useProjectStore,
      useSessionStore,
      actions: {
        setActiveLoop,
        togglePlay,
        stopTransport,
      },
      async loadAudioBytes(
        bytes: ArrayBuffer,
        fileName = "dev.wav",
      ): Promise<void> {
        await loadAudioIntoApp(
          { absolutePath: `/dev/${fileName}`, fileName, bytes, sha256: "dev" },
          true,
        );
      },
    },
  });
}
