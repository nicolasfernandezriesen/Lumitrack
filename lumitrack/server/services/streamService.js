// Streaming local con yt-dlp y caché RAM de un único audio.

import { spawn } from "node:child_process";
import { ytDlpPath, ffmpegDir, hasLocalFfmpeg } from "../infrastructure/binaries.js";
import * as audioCache from "../infrastructure/audioCache.js";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const CONTENT_TYPE = "audio/webm";

/** Descargas en curso: videoId → { promise, abort }. */
const inflight = new Map();

/** Sirve audio desde caché o mediante yt-dlp. */
export function streamAudio(videoId, req, res) {
  if (!VIDEO_ID_RE.test(videoId)) {
    res.status(400).json({ error: "videoId inválido" });
    return;
  }

  const cached = audioCache.get(videoId);
  if (cached) {
    serveFromCache(cached, req, res);
    return;
  }

  streamFromYtDlp(videoId, res);
}

/** Verdadero si el videoId ya está en el slot de caché en RAM. */
export function isCached(videoId) {
  return VIDEO_ID_RE.test(videoId) && audioCache.has(videoId);
}

/** Espera la caché en curso y devuelve si quedó disponible. */
export function waitUntilCached(videoId, { timeoutMs = 120_000 } = {}) {
  if (!VIDEO_ID_RE.test(videoId)) {
    return Promise.resolve(false);
  }
  if (audioCache.has(videoId)) {
    return Promise.resolve(true);
  }

  const pending = inflight.get(videoId);
  if (!pending) {
    return Promise.resolve(false);
  }

  return Promise.race([
    pending.promise.then(() => audioCache.has(videoId)),
    new Promise((resolve) => setTimeout(() => resolve(audioCache.has(videoId)), timeoutMs)),
  ]);
}

/** Sirve un buffer ya cacheado, respetando el header Range si viene (para seek). */
function serveFromCache({ buffer, contentType }, req, res) {
  const total = buffer.length;
  const range = req.headers.range;

  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");

  if (!range) {
    res.setHeader("Content-Length", total);
    res.status(200).end(buffer);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : total - 1;
  const chunkStart = Math.max(0, start);
  const chunkEnd = Math.min(total - 1, end);

  res.status(206);
  res.setHeader("Content-Range", `bytes ${chunkStart}-${chunkEnd}/${total}`);
  res.setHeader("Content-Length", chunkEnd - chunkStart + 1);
  res.end(buffer.subarray(chunkStart, chunkEnd + 1));
}

/** Transmite yt-dlp y acumula chunks para cachearlos al finalizar. */
function streamFromYtDlp(videoId, res) {
  abortInflightExcept(videoId);

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const args = [
    "-f",
    "bestaudio",
    "-o",
    "-",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
  ];

  if (hasLocalFfmpeg()) {
    args.push("--ffmpeg-location", ffmpegDir());
  }

  args.push(url);

  const proc = spawn(ytDlpPath(), args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuf = "";
  proc.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });

  res.setHeader("Content-Type", CONTENT_TYPE);
  res.setHeader("Cache-Control", "no-store");

  const chunks = [];
  let clientAborted = false;
  let settle = null;
  const donePromise = new Promise((resolve) => {
    settle = resolve;
  });

  inflight.set(videoId, {
    promise: donePromise,
    abort: () => {
      clientAborted = true;
      if (!proc.killed) proc.kill("SIGKILL");
    },
  });

  proc.stdout.on("data", (chunk) => {
    chunks.push(chunk);
  });
  proc.stdout.pipe(res);

  proc.on("error", (err) => {
    clientAborted = true;
    console.error("No se pudo iniciar yt-dlp:", err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error:
          "yt-dlp no está instalado o no se encuentra. Cerrá la app y volvé a abrirla para reintentar la descarga.",
      });
    }
  });

  proc.on("close", (code) => {
    const entry = inflight.get(videoId);
    if (entry && entry.promise === donePromise) {
      inflight.delete(videoId);
    }

    if (code !== 0 || clientAborted) {
      if (code !== 0 && !clientAborted && !res.headersSent) {
        res.status(502).json({
          error: "yt-dlp falló al extraer el audio.",
          detail: stderrBuf.slice(-500),
        });
      }
      settle?.(false);
      return;
    }

    if (chunks.length > 0) {
      audioCache.set(videoId, Buffer.concat(chunks), CONTENT_TYPE);
      settle?.(true);
      return;
    }

    settle?.(false);
  });

  // No abortar después de enviar toda la respuesta: la descarga debe cachearse.
  res.on("close", () => {
    if (!res.writableEnded) {
      clientAborted = true;
      if (!proc.killed) proc.kill("SIGKILL");
    }
  });
}

/** Cancela descargas en curso de otras canciones (solo 1 slot activo). */
function abortInflightExcept(videoId) {
  for (const [id, entry] of inflight) {
    if (id !== videoId) {
      entry.abort();
      inflight.delete(id);
    }
  }
}

/** Mata cualquier yt-dlp que siga bajando, por ejemplo al cerrar la ventana. */
export function abortAllStreams() {
  for (const entry of inflight.values()) {
    entry.abort();
  }
  inflight.clear();
}
