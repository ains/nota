import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC, type NotaBridge } from "../shared/ipc";

const nota: NotaBridge = {
  openAudioFile: () => ipcRenderer.invoke(IPC.openAudioFile),
  readAudioFile: (absolutePath) =>
    ipcRenderer.invoke(IPC.readAudioFile, absolutePath),
  readProjectAudio: (projectPath, fileName) =>
    ipcRenderer.invoke(IPC.readProjectAudio, projectPath, fileName),
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
