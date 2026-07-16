import { ipcMain, dialog, powerSaveBlocker, BrowserWindow } from "electron";
import { readFile, writeFile, mkdir, copyFile } from "fs/promises";
import { createHash } from "crypto";
import { basename, join, extname } from "path";
import {
  IPC,
  type OpenAudioResult,
  type SaveProjectAsResult,
  type StemFile,
} from "../shared/ipc";
import {
  PROJECT_FILE_EXT,
  PROJECT_STATE_FILE,
  PROJECT_STEMS_DIR,
} from "../shared/types/project";

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

/** Read a project bundle's state file; null if the path is not a Nota project. */
async function readProjectState(projectDir: string): Promise<string | null> {
  try {
    return await readFile(join(projectDir, PROJECT_STATE_FILE), "utf-8");
  } catch {
    return null;
  }
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
    IPC.readProjectAudio,
    async (
      _e,
      projectPath: string,
      fileName: string,
    ): Promise<OpenAudioResult | null> => {
      try {
        return await loadAudio(join(projectPath, fileName));
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC.saveProjectStems,
    async (_e, projectPath: string, files: StemFile[]): Promise<void> => {
      const stemsDir = join(projectPath, PROJECT_STEMS_DIR);
      await mkdir(stemsDir, { recursive: true });
      await Promise.all(
        files.map((f) =>
          writeFile(join(stemsDir, basename(f.fileName)), Buffer.from(f.bytes)),
        ),
      );
    },
  );

  ipcMain.handle(
    IPC.readProjectStems,
    async (
      _e,
      projectPath: string,
      fileNames: string[],
    ): Promise<StemFile[] | null> => {
      try {
        const stemsDir = join(projectPath, PROJECT_STEMS_DIR);
        return await Promise.all(
          fileNames.map(async (fileName) => {
            const buf = await readFile(join(stemsDir, basename(fileName)));
            const bytes = buf.buffer.slice(
              buf.byteOffset,
              buf.byteOffset + buf.byteLength,
            );
            return { fileName, bytes };
          }),
        );
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC.openProject,
    async (): Promise<{ path: string; json: string } | null> => {
      // On macOS a registered .nota package is selectable as a file; in dev
      // (and on Windows/Linux) the bundle is an ordinary folder, so allow
      // directory selection too.
      const properties: Array<"openFile" | "openDirectory"> =
        process.platform === "darwin"
          ? ["openFile", "openDirectory"]
          : ["openDirectory"];
      const result = await dialog.showOpenDialog({
        title: "Open Project",
        properties,
        filters: PROJECT_FILTERS,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const path = result.filePaths[0];
      const json = await readProjectState(path);
      if (json === null) {
        dialog.showErrorBox(
          "Not a Nota project",
          `"${basename(path)}" is not a Nota project.`,
        );
        return null;
      }
      return { path, json };
    },
  );

  ipcMain.handle(
    IPC.readProjectFile,
    async (_e, projectPath: string): Promise<string | null> =>
      readProjectState(projectPath),
  );

  ipcMain.handle(
    IPC.saveProject,
    async (_e, projectPath: string, json: string): Promise<void> => {
      await writeFile(join(projectPath, PROJECT_STATE_FILE), json, "utf-8");
    },
  );

  ipcMain.handle(
    IPC.saveProjectAs,
    async (
      _e,
      json: string,
      suggestedName: string,
      sourceAudioPath: string,
      audioFileName: string,
    ): Promise<SaveProjectAsResult | null> => {
      const result = await dialog.showSaveDialog({
        title: "Save Project",
        defaultPath: `${suggestedName}.${PROJECT_FILE_EXT}`,
        filters: PROJECT_FILTERS,
      });
      if (result.canceled || !result.filePath) return null;
      // Guarantee the bundle carries the .nota extension even if the user
      // typed a name without it.
      const projectPath =
        extname(result.filePath).toLowerCase() === `.${PROJECT_FILE_EXT}`
          ? result.filePath
          : `${result.filePath}.${PROJECT_FILE_EXT}`;
      await mkdir(projectPath, { recursive: true });
      const audioPath = join(projectPath, audioFileName);
      // Copy the source audio into the bundle (skipped when saving a bundle
      // back onto itself, where source and destination are the same file).
      if (sourceAudioPath !== audioPath) {
        await copyFile(sourceAudioPath, audioPath);
      }
      await writeFile(join(projectPath, PROJECT_STATE_FILE), json, "utf-8");
      return { projectPath, audioPath };
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
