const { contextBridge, ipcRenderer } = require("electron");

/**
 * Bridge para el modal de actualización (aún no hay UI).
 * En el renderer: window.lumitrackUpdater.getState() / onStatus(...)
 * Cuando shouldShowUpdateModal === true, la vista principal puede abrir el modal.
 */
contextBridge.exposeInMainWorld("lumitrackUpdater", {
  getState: () => ipcRenderer.invoke("updater:get-state"),
  check: () => ipcRenderer.invoke("updater:check"),
  download: () => ipcRenderer.invoke("updater:download"),
  install: () => ipcRenderer.invoke("updater:install"),
  onStatus: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listen = (_event, state) => handler(state);
    ipcRenderer.on("updater:status", listen);
    return () => ipcRenderer.removeListener("updater:status", listen);
  },
});
