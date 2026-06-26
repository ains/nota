import { ipcMain, dialog, powerSaveBlocker, BrowserWindow } from "electron";
import { readFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { basename } from "path";
import { IPC, type OpenAudioResult } from "../shared/ipc";
import { PROJECT_FILE_EXT } from "../shared/types/project";

const AUDIO_FILTERS = [
  {
    name: "Audio",
    extensions: ["wav", "mp3", "flac", "ogg", "m4a", "aac", "aiff", "aif"],
  },
];
const PROJECT_FILTERS = [
  { name: "Nota Project", extensions: [PROJECT_FILE_EXT] },
];

async function loadAudio(absolutePath: string): Promise<OpenAudioResult> {
  const buf = await readFile(absolutePath);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  // Slice to a standalone ArrayBuffer so structured clone transfers cleanly.
  const bytes = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  );
  return { absolutePath, fileName: basename(absolutePath), bytes, sha256 };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC.openAudioFile,
    async (): Promise<OpenAudioResult | null> => {
      const result = await dialog.showOpenDialog({
        title: "Open Audio File",
        properties: ["openFile"],
        filters: AUDIO_FILTERS,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return loadAudio(result.filePaths[0]);
    },
  );

  ipcMain.handle(
    IPC.readAudioFile,
    async (_e, absolutePath: string): Promise<OpenAudioResult | null> => {
      try {
        return await loadAudio(absolutePath);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC.openProject,
    async (): Promise<{ path: string; json: string } | null> => {
      const result = await dialog.showOpenDialog({
        title: "Open Project",
        properties: ["openFile"],
        filters: PROJECT_FILTERS,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const path = result.filePaths[0];
      const json = await readFile(path, "utf-8");
      return { path, json };
    },
  );

  ipcMain.handle(
    IPC.readProjectFile,
    async (_e, path: string): Promise<string | null> => {
      try {
        return await readFile(path, "utf-8");
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC.saveProject,
    async (_e, path: string, json: string): Promise<void> => {
      await writeFile(path, json, "utf-8");
    },
  );

  ipcMain.handle(
    IPC.saveProjectAs,
    async (_e, json: string, suggestedName: string): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: "Save Project",
        defaultPath: `${suggestedName}.${PROJECT_FILE_EXT}`,
        filters: PROJECT_FILTERS,
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, json, "utf-8");
      return result.filePath;
    },
  );

  ipcMain.handle(
    IPC.relinkAudio,
    async (_e, expectedFileName: string): Promise<OpenAudioResult | null> => {
      const result = await dialog.showOpenDialog({
        title: `Locate "${expectedFileName}"`,
        properties: ["openFile"],
        filters: AUDIO_FILTERS,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return loadAudio(result.filePaths[0]);
    },
  );

  ipcMain.handle(IPC.importMidiFile, async (): Promise<ArrayBuffer | null> => {
    const result = await dialog.showOpenDialog({
      title: "Import MIDI File",
      properties: ["openFile"],
      filters: [{ name: "MIDI", extensions: ["mid", "midi"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const buf = await readFile(result.filePaths[0]);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle(
    IPC.exportMidiFile,
    async (
      _e,
      bytes: Uint8Array,
      suggestedName: string,
    ): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: "Export MIDI File",
        defaultPath: `${suggestedName}.mid`,
        filters: [{ name: "MIDI", extensions: ["mid"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, Buffer.from(bytes));
      return result.filePath;
    },
  );

  // Lets the renderer defer its first requestMIDIAccess() until the window is
  // actually on screen (see MidiService). Resolving on 'closed' as well keeps
  // a window that is destroyed before ever being shown from stalling callers.
  ipcMain.handle(IPC.whenWindowShown, (e): Promise<void> | undefined => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isVisible()) return;
    return new Promise((resolve) => {
      win.once("show", () => resolve());
      win.once("closed", () => resolve());
    });
  });

  let blockerId: number | null = null;
  ipcMain.handle(
    IPC.setPowerSaveBlocker,
    async (_e, active: boolean): Promise<void> => {
      if (active && blockerId === null) {
        blockerId = powerSaveBlocker.start("prevent-app-suspension");
      } else if (!active && blockerId !== null) {
        powerSaveBlocker.stop(blockerId);
        blockerId = null;
      }
    },
  );
}
