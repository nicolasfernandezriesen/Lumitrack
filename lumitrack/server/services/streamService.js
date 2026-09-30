// Streaming local: URL directa ya resuelta, o yt-dlp si todavía no está. Caché RAM de un audio.

import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ytDlpPath, ffmpegDir, hasLocalFfmpeg } from "../infrastructure/binaries.js";
import * as audioCache from "../infrastructure/audioCache.js";
import * as streamUrlCache from "../infrastructure/streamUrlCache.js";
import { AUDIO_FORMAT, VIDEO_ID_RE, normalizeAudioContentType, watchUrl } from "../infrastructure/youtubeAudio.js";
import * as directUrlService from "./directUrlService.js";

const CONTENT_TYPE = "audio/webm";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Descargas en curso: videoId → { promise, abort }. */
const inflight = new Map();

/** Sirve audio desde caché, desde una URL ya resuelta, o mediante yt-dlp. */
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

  let clientGone = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    directUrlService.releaseDownload();
  };

  res.on("close", () => {
    if (!res.writableEnded) clientGone = true;
    release();
  });

  directUrlService.resolveForPlayback(videoId).then(async (entry) => {
    if (clientGone || res.writableEnded || res.destroyed) return;

    if (entry) {
      const outcome = await proxyDirect(videoId, entry, req, res);
      if (outcome !== "fallback" || clientGone || res.headersSent) return;
    }

    if (!clientGone && !res.headersSent) streamFromYtDlp(videoId, res);
  }).catch((err) => {
    console.error("No se pudo preparar el audio:", err);
    if (!clientGone && !res.headersSent) {
      res.status(500).json({ error: "No se pudo preparar el audio." });
    }
  });
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

/** Reenvía el audio del CDN a medida que llega y lo cachea al completar. */
async function proxyDirect(videoId, entry, req, res) {
  abortInflightExcept(videoId);

  const controller = new AbortController();
  let clientAborted = false;
  let settle = null;
  const donePromise = new Promise((resolve) => {
    settle = resolve;
  });

  const dropInflight = () => {
    const current = inflight.get(videoId);
    if (current && current.promise === donePromise) inflight.delete(videoId);
  };

  inflight.set(videoId, {
    promise: donePromise,
    abort: () => {
      clientAborted = true;
      controller.abort();
    },
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      clientAborted = true;
      controller.abort();
    }
  });

  let upstream;
  try {
    upstream = await fetch(entry.url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://www.youtube.com/",
        Origin: "https://www.youtube.com",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (err) {
    dropInflight();
    settle?.(false);
    if (clientAborted || isAbortError(err)) return "aborted";
    console.error("No se pudo conectar al CDN:", err.message);
    streamUrlCache.remove(videoId);
    return "fallback";
  }

  if (upstream.status !== 200 || !upstream.body) {
    upstream.body?.cancel?.().catch(() => {});
    dropInflight();
    settle?.(false);
    if (!clientAborted) streamUrlCache.remove(videoId);
    return clientAborted ? "aborted" : "fallback";
  }

  const contentType = normalizeAudioContentType(upstream.headers.get("content-type")) || entry.contentType;
  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");

  const chunks = [];
  const collect = new Transform({
    transform(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback(null, chunk);
    },
  });

  let completed = false;
  try {
    await pipeline(Readable.fromWeb(upstream.body), collect, res);
    completed = !clientAborted;
  } catch (err) {
    if (!clientAborted && !isAbortError(err) && err?.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      console.error("Error reenviando el audio:", err.message);
    }
  }

  dropInflight();
  if (completed && chunks.length > 0 && res.writableEnded) {
    audioCache.set(videoId, Buffer.concat(chunks), contentType);
    settle?.(true);
    return "done";
  }

  settle?.(false);
  if (!clientAborted && !res.headersSent && chunks.length === 0) {
    streamUrlCache.remove(videoId);
    return "fallback";
  }
  return "done";
}

/** Transmite yt-dlp y acumula chunks para cachearlos al finalizar. */
function streamFromYtDlp(videoId, res) {
  abortInflightExcept(videoId);

  const args = [
    "-f",
    AUDIO_FORMAT,
    "-o",
    "-",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
  ];

  if (hasLocalFfmpeg()) {
    args.push("--ffmpeg-location", ffmpegDir());
  }

  args.push(watchUrl(videoId));

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
    const current = inflight.get(videoId);
    if (current && current.promise === donePromise) {
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

function isAbortError(err) {
  return err?.name === "AbortError" || err?.code === "ABORT_ERR";
}

/** Mata cualquier descarga que siga en curso, por ejemplo al cerrar la ventana. */
export function abortAllStreams() {
  for (const entry of inflight.values()) {
    entry.abort();
  }
  inflight.clear();
  directUrlService.abortAll();
}
