const { contextBridge, ipcRenderer } = require("electron");

/**
 * Bridge para el modal de actualización.
 * Renderer: window.lumitrackUpdater.getState() / onStatus(...)
 */
contextBridge.exposeInMainWorld("lumitrackUpdater", {
  getState: () => ipcRenderer.invoke("updater:get-state"),
  check: () => ipcRenderer.invoke("updater:check"),
  dismiss: () => ipcRenderer.invoke("updater:dismiss"),
  download: () => ipcRenderer.invoke("updater:download"),
  install: () => ipcRenderer.invoke("updater:install"),
  openChangelog: () => ipcRenderer.invoke("updater:open-changelog"),
  onStatus: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listen = (_event, state) => handler(state);
    ipcRenderer.on("updater:status", listen);
    return () => ipcRenderer.removeListener("updater:status", listen);
  },
});
