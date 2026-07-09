/** Typed IPC contracts shared between main and renderer. */

export interface OpenAudioResult {
  absolutePath: string;
  fileName: string;
  /** Raw file bytes for decodeAudioData (transferred as ArrayBuffer) */
  bytes: ArrayBuffer;
  sha256: string;
}

export interface OpenProjectResult {
  /** Absolute path of the project bundle directory. */
  path: string;
  /** Contents of the bundle's state file. */
  json: string;
}

export interface SaveProjectAsResult {
  /** Absolute path of the newly created project bundle directory. */
  projectPath: string;
  /** Absolute path of the audio copy inside the bundle. */
  audioPath: string;
}

export const IPC = {
  openAudioFile: "dialog:openAudioFile",
  readAudioFile: "fs:readAudioFile",
  readProjectAudio: "fs:readProjectAudio",
  openProject: "dialog:openProject",
  readProjectFile: "fs:readProjectFile",
  saveProject: "fs:saveProject",
  saveProjectAs: "dialog:saveProjectAs",
  importMidiFile: "dialog:importMidiFile",
  exportMidiFile: "dialog:exportMidiFile",
  setPowerSaveBlocker: "power:setBlocker",
  whenWindowShown: "window:whenShown",
  consumeOpenPath: "app:consumeOpenPath",
  projectOpened: "project:opened",
} as const;

export interface NotaBridge {
  /** Open file dialog for an audio file; returns null if cancelled. */
  openAudioFile(): Promise<OpenAudioResult | null>;
  /** Read a known audio path (new project from drop); null if unreadable. */
  readAudioFile(absolutePath: string): Promise<OpenAudioResult | null>;
  /** Read the audio copy bundled inside a project; null if missing. */
  readProjectAudio(
    projectPath: string,
    fileName: string,
  ): Promise<OpenAudioResult | null>;
  /** Open dialog for a project bundle; returns null if cancelled/invalid. */
  openProject(): Promise<OpenProjectResult | null>;
  /** Read a project bundle's state file at a known path; null if unreadable. */
  readProjectFile(projectPath: string): Promise<string | null>;
  /** Resolve the absolute path of a dropped/selected File (Electron webUtils). */
  getPathForFile(file: File): string;
  /** Write the state file into an existing project bundle. */
  saveProject(projectPath: string, json: string): Promise<void>;
  /**
   * Save-as dialog: create a new project bundle, copy the source audio into
   * it, and write the state file. Returns the new paths, or null if cancelled.
   */
  saveProjectAs(
    json: string,
    suggestedName: string,
    sourceAudioPath: string,
    audioFileName: string,
  ): Promise<SaveProjectAsResult | null>;
  /** Open dialog for a .mid file; returns raw bytes or null if cancelled. */
  importMidiFile(): Promise<ArrayBuffer | null>;
  /** Save dialog for a .mid file; returns chosen path or null if cancelled. */
  exportMidiFile(
    bytes: Uint8Array,
    suggestedName: string,
  ): Promise<string | null>;
  /** Keep the system awake while the transport is rolling. */
  setPowerSaveBlocker(active: boolean): Promise<void>;
  /**
   * Resolves once this renderer's BrowserWindow has been shown (immediately
   * if it already is). MidiService gates its first requestMIDIAccess() on
   * this so the request cannot race Chromium's MIDI bring-up at app launch.
   */
  whenWindowShown(): Promise<void>;
  /**
   * Drain any project paths queued from a macOS Finder open before the window
   * was ready (cold launch). Also marks the renderer ready so later opens are
   * pushed live via {@link onOpenProject}.
   */
  consumeOpenPath(): Promise<string[]>;
  /** Subscribe to project bundles opened from Finder while running. Returns an unsubscribe fn. */
  onOpenProject(callback: (projectPath: string) => void): () => void;
}
