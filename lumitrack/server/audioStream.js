// Versión simple del streaming directo con yt-dlp, sin caché.
import { spawn } from "node:child_process";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Transmite el mejor audio disponible directamente a la respuesta HTTP. */
export function streamAudio(videoId, res) {
  if (!VIDEO_ID_RE.test(videoId)) {
    res.status(400).json({ error: "videoId inválido" });
    return;
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const args = [
    "-f",
    "bestaudio",
    "-o",
    "-",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    url,
  ];

  const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

  let stderrBuf = "";
  proc.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });

  res.setHeader("Content-Type", "audio/webm");
  res.setHeader("Cache-Control", "no-store");

  proc.stdout.pipe(res);

  proc.on("error", (err) => {
    console.error("No se pudo iniciar yt-dlp:", err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error:
          "yt-dlp no está instalado o no se encuentra en el PATH. Ver README.",
      });
    }
  });

  proc.on("close", (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(502).json({
        error: "yt-dlp falló al extraer el audio.",
        detail: stderrBuf.slice(-500),
      });
    }
  });

  // Evita dejar procesos huérfanos cuando el cliente cambia de canción.
  res.on("close", () => {
    if (!proc.killed) proc.kill("SIGKILL");
  });
}
