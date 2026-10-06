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

const HIGHLIGHT_SKIP =
  /^(cambios|changelog|novedades|instalaci[oó]n|installation|release notes|lumitrack(\s+v?\d[\w.-]*)?)$/i;

const MAX_HIGHLIGHTS = 20;

/** Decode common HTML entities without a DOM. */
function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Strip tags / markdown noise and normalize whitespace. */
function toPlainLine(raw) {
  return decodeEntities(String(raw))
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer <li> / markdown bullets (the "Cambios" list). Fall back to plain lines.
 * GitHub / electron-updater often delivers releaseNotes as HTML.
 */
function extractChangeLines(releaseNotes) {
  const htmlItems = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liRe.exec(releaseNotes))) {
    const line = toPlainLine(match[1]);
    if (line) htmlItems.push(line);
  }
  if (htmlItems.length) return htmlItems;

  const withBreaks = releaseNotes
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|li|tr|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "");

  const rawLines = decodeEntities(withBreaks).split(/\r?\n/);
  const bullets = [];
  const plain = [];

  for (const raw of rawLines) {
    const isBullet = /^\s*[-*•]\s+/.test(raw) || /^\s*\d+\.\s+/.test(raw);
    const line = raw
      .replace(/^#+\s*/, "")
      .replace(/^\s*[-*•]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/[*_~`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line.length <= 3 || HIGHLIGHT_SKIP.test(line)) continue;
    if (isBullet) bullets.push(line);
    else plain.push(line);
  }

  return bullets.length ? bullets : plain;
}

function lineToHighlight(line) {
  const sep = line.indexOf(":");
  if (sep > 0 && sep < 48) {
    const title = line.slice(0, sep).trim();
    const body = line.slice(sep + 1).trim();
    if (title && body) return { title, body };
  }
  const words = line.split(/\s+/);
  const title = words.slice(0, 5).join(" ");
  return {
    title: title.length < line.length ? `${title}…` : title,
    body: line,
  };
}

/** Turn release notes into highlight cards for the modal (all list items when possible). */
export function buildHighlights(releaseNotes) {
  const fallback = [
    {
      title: "Novedades de esta versión",
      body: "Mejoras, correcciones y optimizaciones listas para instalar.",
    },
  ];
  if (!releaseNotes) return fallback;

  const lines = extractChangeLines(releaseNotes).filter((line) => !HIGHLIGHT_SKIP.test(line));
  if (!lines.length) return fallback;

  return lines.slice(0, MAX_HIGHLIGHTS).map(lineToHighlight);
}

function maybeApplyMockUpdate() {
  if (app.isPackaged) return;
  if (process.env.LUMITRACK_MOCK_UPDATE !== "1") return;
  if (state.status === "available" || state.status === "downloaded") return;
  applyAvailableUpdate({
    version: "0.5.0",
    releaseNotes: [
      "<h2>Lumitrack v0.5.0</h2>",
      "<p>Playlist con canciones relacionadas y controles anterior/siguiente.</p>",
      "<h3>Cambios</h3>",
      "<ul>",
      "<li><strong>Playlist:</strong> reproducción continua con tracks relacionados.</li>",
      "<li><strong>Portadas peek:</strong> anterior arriba y siguiente abajo detrás de la actual.</li>",
      "<li><strong>Caché dual:</strong> URLs de ventana de playlist y audio con prefetch.</li>",
      "<li><strong>Versión:</strong> empaquetado y etiqueta beta de la UI.</li>",
      "</ul>",
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
