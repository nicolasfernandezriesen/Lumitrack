import { existsSync, mkdirSync, createWriteStream, chmodSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import https from "node:https";
import { paths, hasLocalYtDlp, hasLocalFfmpeg, BIN_DIR } from "./server/infrastructure/binaries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

const YTDLP_URLS = {
  win32: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  darwin: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
  linux: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
};

const FFMPEG_WIN_ZIP =
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

let notify = (msg) => {
  console.log(`[setup] ${msg}`);
};

function log(msg) {
  notify(msg);
}

function download(url, destPath, { redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    https
      .get(url, { headers: { "User-Agent": "lumitrack-setup" } }, (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location &&
          redirects > 0
        ) {
          file.close();
          download(res.headers.location, destPath, { redirects: redirects - 1 })
            .then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
          return;
        }
        const total = Number(res.headers["content-length"] || 0);
        let downloaded = 0;
        let lastPct = -1;
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const pct = Math.floor((downloaded / total) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              lastPct = pct;
              log(`  ${pct}%`);
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          if (total) log("  100%");
          resolve();
        });
      })
      .on("error", reject);
  });
}

async function ensureYtDlp() {
  if (hasLocalYtDlp()) {
    log("yt-dlp listo.");
    return;
  }
  const url = YTDLP_URLS[process.platform];
  if (!url) {
    throw new Error(
      `No hay build de yt-dlp para la plataforma "${process.platform}". Instalalo manualmente.`
    );
  }
  log("Descargando yt-dlp…");
  mkdirSync(BIN_DIR, { recursive: true });
  await download(url, paths.ytDlp);
  if (!IS_WIN) chmodSync(paths.ytDlp, 0o755);
  log("yt-dlp listo.");
}

async function ensureFfmpeg() {
  if (hasLocalFfmpeg()) {
    log("ffmpeg listo.");
    return;
  }

  mkdirSync(BIN_DIR, { recursive: true });

  if (IS_WIN) {
    await ensureFfmpegWindows();
    return;
  }

  log(
    "ffmpeg no está en ./bin. En Linux/Mac instalalo con tu gestor de " +
      "paquetes (ej: sudo apt install ffmpeg, o brew install ffmpeg) y " +
      "volvé a correr la app."
  );
}

async function ensureFfmpegWindows() {
  log("Descargando ffmpeg (build de gyan.dev)…");
  const zipPath = path.join(BIN_DIR, "ffmpeg.zip");
  await download(FFMPEG_WIN_ZIP, zipPath);

  log("Descomprimiendo ffmpeg…");
  const extractDir = path.join(BIN_DIR, "_ffmpeg_extract");
  mkdirSync(extractDir, { recursive: true });
  const result = spawnSync("tar", ["-xf", zipPath, "-C", extractDir], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      "No se pudo descomprimir ffmpeg.zip automáticamente. " +
        `Descomprimilo a mano y copiá ffmpeg.exe a ${BIN_DIR}`
    );
  }

  const found = findFileRecursive(extractDir, "ffmpeg.exe");
  if (!found) {
    throw new Error("No encontré ffmpeg.exe dentro del zip descargado.");
  }
  const { copyFileSync, rmSync } = await import("node:fs");
  copyFileSync(found, paths.ffmpeg);
  rmSync(extractDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  log("ffmpeg listo.");
}

function findFileRecursive(dir, filename) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    } else if (entry.toLowerCase() === filename.toLowerCase()) {
      return full;
    }
  }
  return null;
}

function ensureNpmDeps() {
  if (process.env.LUMITRACK_SKIP_NPM === "1") {
    log("Dependencias embebidas en la app.");
    return;
  }
  const nodeModules = path.join(__dirname, "node_modules");
  if (existsSync(nodeModules)) {
    log("Dependencias de npm ya instaladas, OK.");
    return;
  }
  log("Instalando dependencias de npm (primera vez)…");
  const npmCmd = IS_WIN ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["install", "--no-fund", "--no-audit"], {
    cwd: __dirname,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error("npm install falló. Revisá el log de arriba.");
  }
  log("Dependencias instaladas.");
}

export async function runSetup({ onStatus } = {}) {
  if (onStatus) {
    notify = (msg) => {
      console.log(`[setup] ${msg}`);
      onStatus(msg);
    };
  }
  log("Verificando entorno…");
  ensureNpmDeps();
  await ensureYtDlp();
  await ensureFfmpeg();
  log("Todo listo.");
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  runSetup().catch((err) => {
    console.error("\n[setup] ERROR:", err.message);
    process.exit(1);
  });
}
