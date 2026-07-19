import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC, type NativeStemPhase, type NotaBridge } from "../shared/ipc";

// Whether the native demucs binary is bundled cannot change while the app is
// running, so one synchronous lookup is cached for the window's lifetime.
let nativeStemsAvailable: boolean | null = null;

const nota: NotaBridge = {
  openAudioFile: () => ipcRenderer.invoke(IPC.openAudioFile),
  readAudioFile: (absolutePath) =>
    ipcRenderer.invoke(IPC.readAudioFile, absolutePath),
  readProjectAudio: (projectPath, fileName) =>
    ipcRenderer.invoke(IPC.readProjectAudio, projectPath, fileName),
  saveProjectStems: (projectPath, files) =>
    ipcRenderer.invoke(IPC.saveProjectStems, projectPath, files),
  readProjectStems: (projectPath, fileNames) =>
    ipcRenderer.invoke(IPC.readProjectStems, projectPath, fileNames),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  readProjectFile: (projectPath) =>
    ipcRenderer.invoke(IPC.readProjectFile, projectPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (projectPath, json) =>
    ipcRenderer.invoke(IPC.saveProject, projectPath, json),
  saveProjectAs: (json, suggestedName, sourceAudioPath, audioFileName) =>
    ipcRenderer.invoke(
      IPC.saveProjectAs,
      json,
      suggestedName,
      sourceAudioPath,
      audioFileName,
    ),
  importMidiFile: () => ipcRenderer.invoke(IPC.importMidiFile),
  exportMidiFile: (bytes, suggestedName) =>
    ipcRenderer.invoke(IPC.exportMidiFile, bytes, suggestedName),
  setPowerSaveBlocker: (active) =>
    ipcRenderer.invoke(IPC.setPowerSaveBlocker, active),
  whenWindowShown: () => ipcRenderer.invoke(IPC.whenWindowShown),
  consumeOpenPath: () => ipcRenderer.invoke(IPC.consumeOpenPath),
  onOpenProject: (callback) => {
    const listener = (_e: unknown, projectPath: string): void =>
      callback(projectPath);
    ipcRenderer.on(IPC.projectOpened, listener);
    return () => ipcRenderer.removeListener(IPC.projectOpened, listener);
  },
  nativeStemSeparationAvailable: () =>
    (nativeStemsAvailable ??=
      ipcRenderer.sendSync(IPC.nativeStemsAvailable) === true),
  separateStemsNative: (sourcePath, stems, modelId) =>
    ipcRenderer.invoke(IPC.separateStemsNative, sourcePath, stems, modelId),
  cancelNativeStemSeparation: () =>
    ipcRenderer.invoke(IPC.cancelNativeSeparation),
  onNativeStemProgress: (callback) => {
    const listener = (_e: unknown, phase: NativeStemPhase): void =>
      callback(phase);
    ipcRenderer.on(IPC.nativeStemProgress, listener);
    return () => ipcRenderer.removeListener(IPC.nativeStemProgress, listener);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("nota", nota);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.nota = nota;
}
