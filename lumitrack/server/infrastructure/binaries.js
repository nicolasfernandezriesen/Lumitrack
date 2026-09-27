// Prefiere binarios locales y usa el PATH como fallback.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

// En la app empaquetada el proceso principal setea esta variable a una
// carpeta escribible (userData) antes de importar el servidor.
export const BIN_DIR = process.env.LUMITRACK_BIN_DIR
  ? path.resolve(process.env.LUMITRACK_BIN_DIR)
  : path.join(ROOT, "bin");

const IS_WIN = process.platform === "win32";

const LOCAL_YTDLP = path.join(BIN_DIR, IS_WIN ? "yt-dlp.exe" : "yt-dlp");
const LOCAL_FFMPEG = path.join(BIN_DIR, IS_WIN ? "ffmpeg.exe" : "ffmpeg");

export function ytDlpPath() {
  return existsSync(LOCAL_YTDLP) ? LOCAL_YTDLP : "yt-dlp";
}

export function ffmpegPath() {
  return existsSync(LOCAL_FFMPEG) ? LOCAL_FFMPEG : "ffmpeg";
}

export function ffmpegDir() {
  return BIN_DIR;
}

export function hasLocalYtDlp() {
  return existsSync(LOCAL_YTDLP);
}

export function hasLocalFfmpeg() {
  return existsSync(LOCAL_FFMPEG);
}

export const paths = {
  ytDlp: LOCAL_YTDLP,
  ffmpeg: LOCAL_FFMPEG,
};
