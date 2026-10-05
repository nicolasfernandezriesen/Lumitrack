import { app, BrowserWindow, Menu } from "electron";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachUpdaterWindow,
  bindUpdaterIpc,
  startBackgroundUpdateCheck,
} from "./updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(__dirname, "preload.cjs");

let server = null;
let abortAllStreams = () => {};
let mainWindow = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => focus(mainWindow));
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    abortAllStreams();
    server?.close();
  });
  app.whenReady().then(boot).catch((err) => {
    console.error(err);
    app.exit(1);
  });
}

async function boot() {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId("app.lumitrack.desktop");
  bindUpdaterIpc();
  // Check for updates as soon as the splash is up (packaged builds only).
  startBackgroundUpdateCheck();

  const binaries = binDir();
  process.env.LUMITRACK_BIN_DIR = binaries;
  if (app.isPackaged) process.env.LUMITRACK_SKIP_NPM = "1";
  seedBundledBinaries(binaries);

  const splash = createSplash();
  const splashApi = bindSplash(splash);
  let opened = false;

  splash.on("closed", () => {
    if (!opened) app.quit();
  });

  try {
    splashApi.setStatus("Preparando Lumitrack");
    splashApi.setProgressStage(18);

    const { runSetup } = await import("../setup.js");
    await runSetup({
      onStatus: (msg) => {
        splashApi.setStatus(msg);
        splashApi.setProgressStage(45);
      },
    });

    const streamService = await import("../server/services/streamService.js");
    abortAllStreams = streamService.abortAllStreams;

    splashApi.setStatus("Abriendo");
    splashApi.setProgressStage(70);

    const { startServer } = await import("../server/index.js");
    const started = await startServer({ port: 0 });
    server = started.server;
    splashApi.setProgressStage(88);

    mainWindow = createMainWindow();
    attachUpdaterWindow(mainWindow);

    mainWindow.webContents.on("did-fail-load", (_event, _code, description) => {
      splashApi.setStatus(`No se pudo abrir la interfaz: ${description}`);
    });
    mainWindow.once("ready-to-show", () => {
      opened = true;
      splashApi.completeProgress();
      if (!splash.isDestroyed()) splash.close();
      mainWindow.show();
    });
    await mainWindow.loadURL(started.url);
  } catch (err) {
    console.error(err);
    splashApi.setStatus(err?.message || "No se pudo iniciar Lumitrack.");
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function binDir() {
  if (app.isPackaged) return path.join(app.getPath("userData"), "bin");
  return path.join(app.getAppPath(), "bin");
}

/** Copia yt-dlp/ffmpeg que viajan con el instalador a una carpeta escribible. */
function seedBundledBinaries(targetDir) {
  const bundled = path.join(process.resourcesPath, "bin");
  if (!app.isPackaged || !existsSync(bundled)) return;
  mkdirSync(targetDir, { recursive: true });
  for (const name of readdirSync(bundled)) {
    const src = path.join(bundled, name);
    const dest = path.join(targetDir, name);
    if (!statSync(src).isFile() || existsSync(dest)) continue;
    copyFileSync(src, dest);
  }
}

function focus(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function appIconPath() {
  const packaged = path.join(process.resourcesPath, "icon.png");
  if (app.isPackaged && existsSync(packaged)) return packaged;
  const fromInstaller = path.join(__dirname, "../../installer/build/icon.png");
  if (existsSync(fromInstaller)) return fromInstaller;
  return undefined;
}

function windowOptions(extra = {}) {
  const icon = appIconPath();
  return {
    title: "Lumitrack",
    backgroundColor: "#08080a",
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...extra,
  };
}

function createSplash() {
  const splash = new BrowserWindow(
    windowOptions({
      width: 480,
      height: 300,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
    }),
  );
  splash.loadFile(path.join(__dirname, "splash.html"));
  return splash;
}

function bindSplash(splash) {
  let ready = false;
  const pending = [];

  const run = (expression) => {
    if (splash.isDestroyed()) return;
    splash.webContents.executeJavaScript(expression).catch(() => {});
  };

  const flush = () => {
    for (const fn of pending) fn();
    pending.length = 0;
  };

  const whenReady = (fn) => {
    if (ready) fn();
    else pending.push(fn);
  };

  splash.webContents.once("did-finish-load", async () => {
    // Module script may finish just after navigation; wait until the API exists.
    for (let i = 0; i < 40; i++) {
      if (splash.isDestroyed()) return;
      const ok = await splash.webContents
        .executeJavaScript("Boolean(window.__splash)")
        .catch(() => false);
      if (ok) break;
      await wait(25);
    }
    ready = true;
    flush();
  });

  return {
    setStatus(detail) {
      whenReady(() => {
        run(`window.__splash && window.__splash.setStatus(${JSON.stringify(detail)})`);
      });
    },
    setProgressStage(pct) {
      whenReady(() => {
        run(`window.__splash && window.__splash.setProgressStage(${Number(pct)})`);
      });
    },
    completeProgress() {
      whenReady(() => {
        run(`window.__splash && window.__splash.completeProgress()`);
      });
    },
  };
}

function createMainWindow() {
  return new BrowserWindow(
    windowOptions({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      show: false,
    }),
  );
}
