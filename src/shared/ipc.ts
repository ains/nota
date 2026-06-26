/** Typed IPC contracts shared between main and renderer. */

export interface OpenAudioResult {
  absolutePath: string;
  fileName: string;
  /** Raw file bytes for decodeAudioData (transferred as ArrayBuffer) */
  bytes: ArrayBuffer;
  sha256: string;
}

export interface OpenProjectResult {
  path: string;
  json: string;
}

export const IPC = {
  openAudioFile: "dialog:openAudioFile",
  readAudioFile: "fs:readAudioFile",
  openProject: "dialog:openProject",
  readProjectFile: "fs:readProjectFile",
  saveProject: "fs:saveProject",
  saveProjectAs: "dialog:saveProjectAs",
  relinkAudio: "dialog:relinkAudio",
  importMidiFile: "dialog:importMidiFile",
  exportMidiFile: "dialog:exportMidiFile",
  setPowerSaveBlocker: "power:setBlocker",
  whenWindowShown: "window:whenShown",
} as const;

export interface NotaBridge {
  /** Open file dialog for an audio file; returns null if cancelled. */
  openAudioFile(): Promise<OpenAudioResult | null>;
  /** Read a known audio path (project re-open); null if missing/unreadable. */
  readAudioFile(absolutePath: string): Promise<OpenAudioResult | null>;
  /** Open file dialog for a .nota project; returns null if cancelled. */
  openProject(): Promise<OpenProjectResult | null>;
  /** Read a .nota project at a known path; null if missing/unreadable. */
  readProjectFile(path: string): Promise<string | null>;
  /** Resolve the absolute path of a dropped/selected File (Electron webUtils). */
  getPathForFile(file: File): string;
  /** Write project JSON to a known path. */
  saveProject(path: string, json: string): Promise<void>;
  /** Save-as dialog; returns chosen path or null if cancelled. */
  saveProjectAs(json: string, suggestedName: string): Promise<string | null>;
  /** Relink dialog when the project's audio file is missing. */
  relinkAudio(expectedFileName: string): Promise<OpenAudioResult | null>;
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
}
