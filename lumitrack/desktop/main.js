import { app, BrowserWindow, Menu } from "electron";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  const binaries = binDir();
  process.env.LUMITRACK_BIN_DIR = binaries;
  if (app.isPackaged) process.env.LUMITRACK_SKIP_NPM = "1";
  seedBundledBinaries(binaries);

  const splash = createSplash();
  const setStatus = bindStatus(splash);
  let opened = false;

  splash.on("closed", () => {
    if (!opened) app.quit();
  });

  try {
    setStatus("Preparando Lumitrack…");
    const { runSetup } = await import("../setup.js");
    await runSetup({ onStatus: setStatus });

    const streamService = await import("../server/services/streamService.js");
    abortAllStreams = streamService.abortAllStreams;

    setStatus("Abriendo…");
    const { startServer } = await import("../server/index.js");
    const started = await startServer({ port: 0 });
    server = started.server;

    mainWindow = createMainWindow();
    mainWindow.webContents.on("did-fail-load", (_event, _code, description) => {
      setStatus(`No se pudo abrir la interfaz: ${description}`);
    });
    mainWindow.once("ready-to-show", () => {
      opened = true;
      if (!splash.isDestroyed()) splash.close();
      mainWindow.show();
    });
    await mainWindow.loadURL(started.url);
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "No se pudo iniciar Lumitrack.");
  }
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

function createSplash() {
  const splash = new BrowserWindow({
    width: 480,
    height: 240,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: "Lumitrack",
    backgroundColor: "#08080a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splash.loadFile(path.join(__dirname, "splash.html"));
  return splash;
}

function bindStatus(splash) {
  let ready = false;
  const pending = [];
  const paint = (text) => {
    if (splash.isDestroyed()) return;
    splash.webContents
      .executeJavaScript(`document.getElementById("msg").textContent = ${JSON.stringify(text)}`)
      .catch(() => {});
  };
  splash.webContents.once("did-finish-load", () => {
    ready = true;
    for (const text of pending) paint(text);
  });
  return (text) => {
    if (!ready) pending.push(text);
    else paint(text);
  };
}

function createMainWindow() {
  return new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Lumitrack",
    backgroundColor: "#08080a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}
