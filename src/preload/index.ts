import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC, type NotaBridge } from "../shared/ipc";

const nota: NotaBridge = {
  openAudioFile: () => ipcRenderer.invoke(IPC.openAudioFile),
  readAudioFile: (absolutePath) =>
    ipcRenderer.invoke(IPC.readAudioFile, absolutePath),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  readProjectFile: (path) => ipcRenderer.invoke(IPC.readProjectFile, path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (path, json) => ipcRenderer.invoke(IPC.saveProject, path, json),
  saveProjectAs: (json, suggestedName) =>
    ipcRenderer.invoke(IPC.saveProjectAs, json, suggestedName),
  relinkAudio: (expectedFileName) =>
    ipcRenderer.invoke(IPC.relinkAudio, expectedFileName),
  importMidiFile: () => ipcRenderer.invoke(IPC.importMidiFile),
  exportMidiFile: (bytes, suggestedName) =>
    ipcRenderer.invoke(IPC.exportMidiFile, bytes, suggestedName),
  setPowerSaveBlocker: (active) =>
    ipcRenderer.invoke(IPC.setPowerSaveBlocker, active),
  whenWindowShown: () => ipcRenderer.invoke(IPC.whenWindowShown),
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
