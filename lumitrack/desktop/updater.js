import { app, ipcMain, shell } from "electron";
import updater from "electron-updater";

const { autoUpdater } = updater;

const REPO_RELEASES = "https://github.com/nicolasfernandezriesen/Lumitrack/releases";

/**
 * Actualizaciones vía GitHub Releases (latest.yml + NSIS).
 *
 * Flujo:
 * 1. Splash: check en segundo plano.
 * 2. Si hay versión nueva → modal "disponible" (shouldShowUpdateModal).
 * 3. Usuario acepta → download en segundo plano (sigue usando la app).
 * 4. Al terminar → modal de cierre (shouldShowInstallModal) + quitAndInstall.
 *
 * NSIS no puede reemplazar binarios mientras la app corre; la instalación
 * en caliente no es viable. autoInstallOnAppQuit queda como red de seguridad
 * si el proceso se cierra antes del modal de instalación.
 */

/** @typedef {'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'} UpdaterStatus */

/** @typedef {{ title: string, body: string }} ReleaseHighlight */

/**
 * @type {{
 *   status: UpdaterStatus,
 *   version: string | null,
 *   currentVersion: string,
 *   progress: number | null,
 *   error: string | null,
 *   releaseNotes: string | null,
 *   highlights: ReleaseHighlight[],
 *   changelogUrl: string | null,
 *   shouldShowUpdateModal: boolean,
 *   shouldShowInstallModal: boolean,
 * }}
 */
let state = {
  status: "idle",
  version: null,
  currentVersion: app.getVersion(),
  progress: null,
  error: null,
  releaseNotes: null,
  highlights: [],
  changelogUrl: null,
  shouldShowUpdateModal: false,
  shouldShowInstallModal: false,
};

/** @type {import('electron').BrowserWindow | null} */
let targetWindow = null;
let wired = false;

export function getUpdaterState() {
  return {
    ...state,
    currentVersion: app.getVersion(),
    highlights: state.highlights.map((h) => ({ ...h })),
  };
}

/** Points status events at the main window (call once it exists). */
export function attachUpdaterWindow(win) {
  targetWindow = win ?? targetWindow;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("updater:status", getUpdaterState());
  }
  maybeApplyMockUpdate();
}

/** Arranca el chequeo en segundo plano. No descarga ni instala sola. */
export function startBackgroundUpdateCheck(win) {
  if (!app.isPackaged) {
    maybeApplyMockUpdate();
    return;
  }
  if (win) targetWindow = win;
  ensureWired();
  if (state.status === "checking" || state.status === "downloading") return;
  setState({ status: "checking", error: null });
  autoUpdater.checkForUpdates().catch((err) => {
    setState({ status: "error", error: err?.message || String(err) });
  });
}

export function dismissUpdateModal() {
  setState({ shouldShowUpdateModal: false });
}

export function downloadUpdate() {
  if (!app.isPackaged) {
    return mockDownload();
  }
  ensureWired();
  if (state.status !== "available" && state.status !== "error") {
    return Promise.reject(new Error("No hay una actualización lista para descargar"));
  }
  setState({
    status: "downloading",
    progress: 0,
    error: null,
    shouldShowUpdateModal: false,
  });
  return autoUpdater.downloadUpdate();
}

export function installUpdate() {
  if (!app.isPackaged) {
    setState({ shouldShowInstallModal: false });
    app.quit();
    return;
  }
  ensureWired();
  // isSilent=true, isForceRunAfter=true: instalador silencioso y reabre la app.
  autoUpdater.quitAndInstall(true, true);
}

export function openChangelog() {
  const url =
    state.changelogUrl ||
    (state.version ? `${REPO_RELEASES}/tag/v${state.version}` : REPO_RELEASES);
  return shell.openExternal(url);
}

export function bindUpdaterIpc() {
  ensureWired();
  ipcMain.handle("updater:get-state", () => getUpdaterState());
  ipcMain.handle("updater:check", () => {
    startBackgroundUpdateCheck(targetWindow);
    return getUpdaterState();
  });
  ipcMain.handle("updater:dismiss", () => {
    dismissUpdateModal();
    return getUpdaterState();
  });
  ipcMain.handle("updater:download", () => downloadUpdate().then(() => getUpdaterState()));
  ipcMain.handle("updater:install", () => {
    installUpdate();
    return getUpdaterState();
  });
  ipcMain.handle("updater:open-changelog", () => openChangelog().then(() => true));
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
    applyAvailableUpdate(info);
  });

  autoUpdater.on("update-not-available", () => {
    setState({
      status: "not-available",
      version: null,
      progress: null,
      error: null,
      releaseNotes: null,
      highlights: [],
      changelogUrl: null,
      shouldShowUpdateModal: false,
      shouldShowInstallModal: false,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = typeof progress?.percent === "number" ? progress.percent : null;
    setState({ status: "downloading", progress: pct, shouldShowUpdateModal: false });
  });

  autoUpdater.on("update-downloaded", (info) => {
    // Safety net: if the app quits before the install modal finishes, still install.
    autoUpdater.autoInstallOnAppQuit = true;
    setState({
      status: "downloaded",
      version: info?.version ?? state.version,
      progress: 100,
      error: null,
      shouldShowUpdateModal: false,
      shouldShowInstallModal: true,
      changelogUrl:
        state.changelogUrl ||
        (info?.version ? `${REPO_RELEASES}/tag/v${info.version}` : REPO_RELEASES),
    });
  });

  autoUpdater.on("error", (err) => {
    setState({ status: "error", error: err?.message || String(err) });
  });
}

function applyAvailableUpdate(info) {
  const version = info?.version ?? null;
  const releaseNotes = normalizeReleaseNotes(info?.releaseNotes);
  setState({
    status: "available",
    version,
    progress: null,
    error: null,
    releaseNotes,
    highlights: buildHighlights(releaseNotes),
    changelogUrl: version ? `${REPO_RELEASES}/tag/v${version}` : REPO_RELEASES,
    shouldShowUpdateModal: true,
    shouldShowInstallModal: false,
  });
}

function normalizeReleaseNotes(notes) {
  if (!notes) return null;
  if (typeof notes === "string") return notes.trim() || null;
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === "string" ? n : n?.note || ""))
      .filter(Boolean)
      .join("\n")
      .trim() || null;
  }
  return null;
}

/** Turn release notes into up to 3 highlight cards for the modal. */
export function buildHighlights(releaseNotes) {
  const fallback = [
    {
      title: "Novedades de esta versión",
      body: "Mejoras, correcciones y optimizaciones listas para instalar.",
    },
  ];
  if (!releaseNotes) return fallback;

  const lines = releaseNotes
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*•]\s+/, "").trim())
    .filter((line) => line.length > 3);

  if (!lines.length) return fallback;

  return lines.slice(0, 3).map((line) => {
    const sep = line.indexOf(":");
    if (sep > 0 && sep < 48) {
      return {
        title: line.slice(0, sep).trim(),
        body: line.slice(sep + 1).trim() || line,
      };
    }
    const words = line.split(/\s+/);
    const title = words.slice(0, 5).join(" ");
    return {
      title: title.length < line.length ? `${title}…` : title,
      body: line,
    };
  });
}

function maybeApplyMockUpdate() {
  if (app.isPackaged) return;
  if (process.env.LUMITRACK_MOCK_UPDATE !== "1") return;
  if (state.status === "available" || state.status === "downloaded") return;
  applyAvailableUpdate({
    version: "0.3.0",
    releaseNotes: [
      "Mejoras en rendimiento: Renderizado del visualizador más fluido con menor consumo.",
      "Estabilidad: Correcciones menores y mejor manejo de errores de reproducción.",
      "Actualizaciones: Flujo de instalación más claro desde la propia app.",
    ].join("\n"),
  });
}

function mockDownload() {
  setState({
    status: "downloading",
    progress: 0,
    shouldShowUpdateModal: false,
    error: null,
  });
  return new Promise((resolve) => {
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(100, pct + 20);
      setState({ status: "downloading", progress: pct });
      if (pct >= 100) {
        clearInterval(timer);
        setState({
          status: "downloaded",
          progress: 100,
          shouldShowInstallModal: true,
          shouldShowUpdateModal: false,
        });
        resolve();
      }
    }, 200);
  });
}

function setState(patch) {
  state = { ...state, ...patch };
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("updater:status", getUpdaterState());
  }
}
