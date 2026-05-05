const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pier", {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  addProject: (input) => ipcRenderer.invoke("projects:add", input),
  updateProject: (id, patch) => ipcRenderer.invoke("projects:update", id, patch),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  reorderProjects: (orderedIds) => ipcRenderer.invoke("projects:reorder", orderedIds),

  addService: (projectId, input) => ipcRenderer.invoke("services:add", projectId, input),
  updateService: (projectId, serviceId, patch) => ipcRenderer.invoke("services:update", projectId, serviceId, patch),
  removeService: (projectId, serviceId) => ipcRenderer.invoke("services:remove", projectId, serviceId),
  startService: (projectId, serviceId, options) => ipcRenderer.invoke("services:start", projectId, serviceId, options),
  stopService: (projectId, serviceId) => ipcRenderer.invoke("services:stop", projectId, serviceId),
  restartService: (projectId, serviceId, options) => ipcRenderer.invoke("services:restart", projectId, serviceId, options),
  setPrimaryService: (projectId, serviceId) => ipcRenderer.invoke("services:setPrimary", projectId, serviceId),

  startProject: (id, options) => ipcRenderer.invoke("projects:start", id, options),
  stopProject: (id) => ipcRenderer.invoke("projects:stop", id),
  restartProject: (id, options) => ipcRenderer.invoke("projects:restart", id, options),

  spawnTerminal: (projectId, options) => ipcRenderer.invoke("terminals:spawn", projectId, options),
  closeTerminal: (projectId, name) => ipcRenderer.invoke("terminals:close", projectId, name),
  readTerminal: (projectId, name, lines) => ipcRenderer.invoke("terminals:read", projectId, name, lines),
  renameTerminal: (projectId, oldName, newName) => ipcRenderer.invoke("terminals:rename", projectId, oldName, newName),
  sendTerminalInput: (projectId, name, parts) => ipcRenderer.invoke("terminals:input", projectId, name, parts),
  reclaimService: (projectId, serviceId) => ipcRenderer.invoke("services:reclaim", projectId, serviceId),

  readServiceLogs: (projectId, serviceId, lines) => ipcRenderer.invoke("services:logs", projectId, serviceId, lines),
  clearServiceLogs: (projectId, serviceId) => ipcRenderer.invoke("services:clearLogs", projectId, serviceId),
  copyServiceLogs: (projectId, serviceId, lines) => ipcRenderer.invoke("services:copyLogs", projectId, serviceId, lines),
  copyAllLogs: (projectId, lines) => ipcRenderer.invoke("projects:copyAllLogs", projectId, lines),

  openProject: (id) => ipcRenderer.invoke("projects:open", id),
  openService: (projectId, serviceId) => ipcRenderer.invoke("services:open", projectId, serviceId),
  revealProjectFolder: (id) => ipcRenderer.invoke("projects:reveal", id),

  copyAttachCommand: (projectId, windowName) => ipcRenderer.invoke("projects:copyAttach", projectId, windowName),

  chooseFolder: () => ipcRenderer.invoke("projects:chooseFolder"),

  onProjectsChanged: (callback) => {
    ipcRenderer.on("projects-changed", callback);
    return () => ipcRenderer.removeListener("projects-changed", callback);
  },
  onToast: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("toast", wrapped);
    return () => ipcRenderer.removeListener("toast", wrapped);
  }
});
