import { contextBridge, ipcRenderer } from "electron";
import type { GroveAPI } from "../shared/types";
const invoke =
  (name: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`grove:${name}`, ...args);
const on = (name: string) => (callback: (value: any) => void) => {
  const listener = (_event: unknown, value: any) => callback(value);
  ipcRenderer.on(`grove:${name}`, listener);
  return () => ipcRenderer.removeListener(`grove:${name}`, listener);
};
const api: GroveAPI = {
  settings: invoke("settings"),
  saveSettings: invoke("saveSettings"),
  addProject: invoke("addProject"),
  updateProject: invoke("updateProject"),
  relocateProject: invoke("relocateProject"),
  removeProject: invoke("removeProject"),
  reorderProjects: invoke("reorderProjects"),
  listFiles: invoke("listFiles"),
  readFile: invoke("readFile"),
  writeFile: invoke("writeFile"),
  createFile: invoke("createFile"),
  moveFile: invoke("moveFile"),
  trashFile: invoke("trashFile"),
  search: invoke("search"),
  gitStatus: invoke("gitStatus"),
  gitDiff: invoke("gitDiff"),
  gitStage: invoke("gitStage"),
  gitCommit: invoke("gitCommit"),
  terminalCreate: invoke("terminalCreate"),
  terminalList: invoke("terminalList"),
  terminalAttach: invoke("terminalAttach"),
  terminalWrite: invoke("terminalWrite"),
  terminalResize: invoke("terminalResize"),
  terminalClose: invoke("terminalClose"),
  finishQuit: (id, success) =>
    ipcRenderer.send("grove:finishQuit", id, success),
  onPrepareQuit: on("prepareQuit"),
  setDirty: (dirty) => ipcRenderer.send("grove:dirty", dirty),
  onFileChange: on("fileChange"),
  onTerminalData: on("terminalData"),
  onTerminalExit: on("terminalExit"),
  onMenu: on("menu"),
};
contextBridge.exposeInMainWorld("grove", api);
