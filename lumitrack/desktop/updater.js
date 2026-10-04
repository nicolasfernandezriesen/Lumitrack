import { app, ipcMain } from "electron";
import updater from "electron-updater";

const { autoUpdater } = updater;

/**
 * Actualizaciones vía GitHub Releases (latest.yml + NSIS).
 *
 * Flujo previsto (UI todavía no):
 * 1. Al abrir la app empaquetada, check en segundo plano.
 * 2. Si hay versión nueva, el renderer recibe "updater:status".
 * 3. El modal futuro llama download → install; sin confirmación no se instala.
 */

/** @typedef {'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'} UpdaterStatus */

/** @type {{ status: UpdaterStatus, version: string | null, progress: number | null, error: string | null }} */
let state = {
  status: "idle",
  version: null,
  progress: null,
  error: null,
};

/** @type {import('electron').BrowserWindow | null} */
let targetWindow = null;
let wired = false;

export function getUpdaterState() {
  return { ...state };
}

/** Arranca el chequeo en segundo plano. No descarga ni instala sola. */
export function startBackgroundUpdateCheck(win) {
  if (!app.isPackaged) return;
  targetWindow = win ?? targetWindow;
  ensureWired();
  if (state.status === "checking" || state.status === "downloading") return;
  setState({ status: "checking", error: null });
  autoUpdater.checkForUpdates().catch((err) => {
    setState({ status: "error", error: err?.message || String(err) });
  });
}

export function downloadUpdate() {
  if (!app.isPackaged) return Promise.reject(new Error("Solo en la app instalada"));
  ensureWired();
  if (state.status !== "available" && state.status !== "error") {
    return Promise.reject(new Error("No hay una actualización lista para descargar"));
  }
  setState({ status: "downloading", progress: 0, error: null });
  return autoUpdater.downloadUpdate();
}

export function installUpdate() {
  if (!app.isPackaged) return;
  ensureWired();
  // isSilent=false, isForceRunAfter=true: reinstala y vuelve a abrir.
  autoUpdater.quitAndInstall(false, true);
}

export function bindUpdaterIpc() {
  ensureWired();
  ipcMain.handle("updater:get-state", () => getUpdaterState());
  ipcMain.handle("updater:check", () => {
    startBackgroundUpdateCheck(targetWindow);
    return getUpdaterState();
  });
  ipcMain.handle("updater:download", () => downloadUpdate().then(() => getUpdaterState()));
  ipcMain.handle("updater:install", () => {
    installUpdate();
    return getUpdaterState();
  });
}

function ensureWired() {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    setState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info) => {
    setState({
      status: "available",
      version: info?.version ?? null,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    setState({ status: "not-available", version: null, progress: null, error: null });
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = typeof progress?.percent === "number" ? progress.percent : null;
    setState({ status: "downloading", progress: pct });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setState({
      status: "downloaded",
      version: info?.version ?? state.version,
      progress: 100,
      error: null,
    });
  });

  autoUpdater.on("error", (err) => {
    setState({ status: "error", error: err?.message || String(err) });
  });
}

function setState(patch) {
  state = { ...state, ...patch };
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("updater:status", getUpdaterState());
  }
}
