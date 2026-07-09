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
import { saveAudioSettings } from "../persistence/audioSettings";
import {
  startStemSeparation,
  StemSeparationCancelled,
  STEM_MODEL_ID,
  type StemSeparationJob,
} from "../core/stems/stemSeparator";
import { encodeWavPcm16 } from "../core/stems/wav";
import {
  STEM_NAMES,
  type StemName,
  type StoredStems,
} from "@shared/types/project";
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

  // Apply the persisted audio-control mix (seeded into the session store from
  // localStorage) to the engine on boot.
  const session = useSessionStore.getState();
  engine.transport.setSynthMuted(session.synthMuted);
  engine.transport.setAudioMuted(session.audioMuted);
  engine.transport.setMusicVolume(session.musicVolume);
  engine.transport.setSynthVolume(session.synthVolume);
  engine.transport.setRate(session.playbackRate);
  STEM_NAMES.forEach((stem, i) => {
    engine.transport.setStemVolume(i, session.stemVolumes[stem]);
    engine.transport.setStemMuted(i, session.stemMutes[stem]);
  });

  // Persist the audio-control mix whenever it changes so it carries across
  // restarts. Writes on each change (including rapid slider drags), but the
  // payload is a tiny JSON blob and localStorage.setItem is synchronous.
  useSessionStore.subscribe((s, prev) => {
    if (
      s.musicVolume !== prev.musicVolume ||
      s.synthVolume !== prev.synthVolume ||
      s.audioMuted !== prev.audioMuted ||
      s.synthMuted !== prev.synthMuted ||
      s.stemVolumes !== prev.stemVolumes ||
      s.stemMutes !== prev.stemMutes
    ) {
      saveAudioSettings({
        musicVolume: s.musicVolume,
        synthVolume: s.synthVolume,
        audioMuted: s.audioMuted,
        synthMuted: s.synthMuted,
        stemVolumes: s.stemVolumes,
        stemMutes: s.stemMutes,
      });
    }
  });

  // Keep the playback scheduler's note list in sync with the document.
  engine.scheduler.setNotes(useProjectStore.getState().notes);
  useProjectStore.subscribe((s, prev) => {
    if (s.notes !== prev.notes) engine.scheduler.setNotes(s.notes);
  });

  engine.midi.onDevicesChanged(() => syncMidiDevices());
  engine.midi.onActiveDeviceDisconnected(() => {
    // Recorded notes are already in the document; just end the session.
    if (engine.isRecording) stopRecording();
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
  // path is a bundle directory (e.g. ".../Yesterday.nota"); show its name
  // without the extension. Split on both separators so Windows paths work.
  const base = path.split(/[/\\]/).pop() ?? "project";
  const name = base.replace(/\.[^.]+$/, "") || base;
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
  // New audio invalidates any stems that are loaded or being separated.
  cancelStemSeparation();
  session.setStemsReady(false);
  session.setStemJob({ phase: "idle" });
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

  // The audio lives inside the bundle beside the state file; load that copy.
  const audioFile = await window.nota.readProjectAudio(
    path,
    data.audio.fileName,
  );
  if (!audioFile) {
    console.error(
      `Project bundle is missing its audio file "${data.audio.fileName}".`,
    );
    return;
  }

  useProjectStore.getState().loadProject({
    audio: { ...data.audio, absolutePath: audioFile.absolutePath },
    notes: data.notes,
    loopRegions: data.loopRegions,
    stems: data.stems ?? null,
    projectPath: path,
  });
  clearHistory();
  useSessionStore.getState().setActiveLoopId(null);
  await loadAudioIntoApp(audioFile, false);
  if (data.stems) await loadStemsFromBundle(path, data.stems);
  // loadAudioIntoApp(asNewProject=false) already set the audio ref and a
  // fit-to-window viewport; restore the saved view over it.
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
  if (engine.isRecording) stopRecording();
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
    stems: p.stems ?? undefined,
  });
  if (p.projectPath && !saveAs) {
    await window.nota.saveProject(p.projectPath, json);
    p.markSaved(p.projectPath);
    recordRecent(p.projectPath, p.audio.fileName);
  } else {
    const suggested = p.audio.fileName.replace(/\.[^.]+$/, "");
    // saveProjectAs creates the bundle and copies the current audio into it;
    // markSaved then repoints the audio ref at that bundled copy.
    const result = await window.nota.saveProjectAs(
      json,
      suggested,
      p.audio.absolutePath,
      p.audio.fileName,
    );
    if (result) {
      p.markSaved(result.projectPath, result.audioPath);
      recordRecent(result.projectPath, p.audio.fileName);
      // saveProjectAs only copies the audio; write the stems (still loaded in
      // the transport) into the new bundle too.
      if (p.stems) await writeLoadedStemsToBundle(result.projectPath, p.stems);
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

// --- stem separation ---

/** The in-flight separation job; null when none is running. */
let activeStemJob: StemSeparationJob | null = null;

function stemWavFiles(
  stems: StoredStems,
  buffers: AudioBuffer[],
): { fileName: string; bytes: ArrayBuffer }[] {
  return STEM_NAMES.map((name, i) => ({
    fileName: stems.fileNames[name],
    bytes: encodeWavPcm16(
      [buffers[i].getChannelData(0), buffers[i].getChannelData(1)],
      buffers[i].sampleRate,
    ),
  }));
}

/** Re-encode the loaded stems into another bundle (used by save-as). */
async function writeLoadedStemsToBundle(
  projectPath: string,
  stems: StoredStems,
): Promise<void> {
  const buffers = engine.transport.getStemBuffers();
  if (!buffers) return;
  await window.nota.saveProjectStems(projectPath, stemWavFiles(stems, buffers));
}

/** Read a project's stem files, decode them, and hand them to the transport. */
async function loadStemsFromBundle(
  projectPath: string,
  stems: StoredStems,
): Promise<void> {
  const files = await window.nota.readProjectStems(
    projectPath,
    STEM_NAMES.map((name) => stems.fileNames[name]),
  );
  if (!files) {
    console.error("Project bundle is missing its stem files; ignoring stems.");
    return;
  }
  const buffers = await Promise.all(
    files.map((f) => engine.transport.ctx.decodeAudioData(f.bytes)),
  );
  // Bail if another project/audio was loaded while we were decoding.
  if (useProjectStore.getState().projectPath !== projectPath) return;
  await engine.transport.setStems(buffers);
  useSessionStore.getState().setStemsReady(true);
}

/**
 * Separate the project audio into the four Demucs stems, store them in the
 * project bundle, and switch playback over to them. Requires a saved project
 * (the stems live in the bundle). Progress is reported via session.stemJob.
 */
export async function separateStems(): Promise<void> {
  const session = useSessionStore.getState();
  const p = useProjectStore.getState();
  const buffer = engine.transport.audioBuffer;
  if (!buffer || !p.projectPath || !p.audio || activeStemJob) return;
  const projectPath = p.projectPath;
  const sourceSha256 = p.audio.sha256;

  void window.nota.setPowerSaveBlocker(true);
  session.setStemJob({ phase: "downloading", progress: null });
  try {
    const job = startStemSeparation(buffer, (prog) => {
      useSessionStore
        .getState()
        .setStemJob(
          prog.phase === "download"
            ? { phase: "downloading", progress: prog.progress }
            : { phase: "separating", progress: prog.progress },
        );
    });
    activeStemJob = job;
    const separated = await job.promise;

    useSessionStore.getState().setStemJob({ phase: "saving" });
    // Fix the order to STEM_NAMES regardless of what the model reported.
    const ordered = STEM_NAMES.map(
      (name) => separated.find((s) => s.name === name)!,
    );
    const sampleRate = buffer.sampleRate;
    const buffers = ordered.map((s) => {
      const b = engine.transport.ctx.createBuffer(2, s.left.length, sampleRate);
      b.copyToChannel(s.left, 0);
      b.copyToChannel(s.right, 1);
      return b;
    });
    const stored: StoredStems = {
      modelId: STEM_MODEL_ID,
      sourceSha256,
      fileNames: Object.fromEntries(
        STEM_NAMES.map((name) => [name, `${name}.wav`]),
      ) as StoredStems["fileNames"],
    };
    await window.nota.saveProjectStems(
      projectPath,
      stemWavFiles(stored, buffers),
    );

    // Bail before touching live state if the project changed mid-separation
    // (the stems were still written to their own bundle).
    const current = useProjectStore.getState();
    if (
      current.projectPath !== projectPath ||
      engine.transport.audioBuffer !== buffer
    ) {
      useSessionStore.getState().setStemJob({ phase: "idle" });
      return;
    }
    current.setStems(stored);
    await saveProject();
    await engine.transport.setStems(buffers);
    useSessionStore.getState().setStemsReady(true);
    useSessionStore.getState().setStemJob({ phase: "idle" });
  } catch (err) {
    if (err instanceof StemSeparationCancelled) {
      useSessionStore.getState().setStemJob({ phase: "idle" });
    } else {
      console.error("Stem separation failed:", err);
      useSessionStore.getState().setStemJob({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    activeStemJob = null;
    void window.nota.setPowerSaveBlocker(false);
  }
}

/** Cancel an in-flight separation (no-op when none is running). */
export function cancelStemSeparation(): void {
  activeStemJob?.cancel();
}

export function setStemVolume(stem: StemName, volume: number): void {
  engine.transport.setStemVolume(STEM_NAMES.indexOf(stem), volume);
  useSessionStore.getState().setStemVolume(stem, volume);
}

export function setStemMuted(stem: StemName, muted: boolean): void {
  engine.transport.setStemMuted(STEM_NAMES.indexOf(stem), muted);
  useSessionStore.getState().setStemMuted(stem, muted);
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
  if (engine.isRecording) stopRecording();
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
  engine.transport.setSynthMuted(muted);
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

/** Change playback speed (pitch preserved). */
export function setPlaybackRate(rate: number): void {
  engine.transport.setRate(rate);
  useSessionStore.getState().setPlaybackRate(rate);
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

/**
 * Sketch an unsaved loop region (e.g. dragged across the waveform). It renders
 * in the loop lane and drives the transport loop for preview, but is not saved
 * to the project until {@link commitPendingRegion}. Supersedes any active loop.
 */
export function setPendingRegion(startSec: number, endSec: number): void {
  const session = useSessionStore.getState();
  session.setActiveLoopId(null);
  session.setPendingRegion({ startSec, endSec });
  engine.transport.setLoop({ start: startSec, end: endSec });
  engine.transport.seek(startSec);
}

/** Save the pending region as a real project section and activate it. */
export function commitPendingRegion(): void {
  const session = useSessionStore.getState();
  const pending = session.pendingRegion;
  if (!pending) return;
  session.setPendingRegion(null);
  const region = useProjectStore
    .getState()
    .addLoopRegion(pending.startSec, pending.endSec);
  setActiveLoop(region.id);
}

/** Drop the pending region and clear its preview loop. */
export function discardPendingRegion(): void {
  const session = useSessionStore.getState();
  if (!session.pendingRegion) return;
  session.setPendingRegion(null);
  engine.transport.setLoop(null);
}

// --- recording ---

export function startRecording(): void {
  const session = useSessionStore.getState();
  // Captured notes accumulate in the session's uncommittedNotes buffer: they
  // render alongside committed notes for live feedback but stay out of the
  // undoable document, then fold into the project as one undo step on stop.
  session.setUncommittedNotes([]);
  engine.startRecording((note) =>
    useSessionStore.getState().appendUncommittedNote(note),
  );
  session.setIsRecording(true);
  if (!engine.transport.isPlaying) void engine.transport.play();
}

export function stopRecording(): void {
  engine.stopRecording();
  const session = useSessionStore.getState();
  const captured = session.uncommittedNotes;
  if (captured.length > 0) useProjectStore.getState().addNotes(captured);
  session.setUncommittedNotes([]);
  session.setIsRecording(false);
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
