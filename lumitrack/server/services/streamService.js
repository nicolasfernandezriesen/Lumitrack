// Streaming local: URL directa ya resuelta, o yt-dlp si todavía no está.
// Caché RAM multi-slot: historial (3) + actual + prefetch de la siguiente.

import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ytDlpPath, ffmpegDir, hasLocalFfmpeg } from "../infrastructure/binaries.js";
import * as audioCache from "../infrastructure/audioCache.js";
import { createByteAccumulator } from "../infrastructure/byteAccumulator.js";
import * as urlCache from "../infrastructure/urlCache.js";
import { AUDIO_FORMAT, VIDEO_ID_RE, normalizeAudioContentType, watchUrl } from "../infrastructure/youtubeAudio.js";
import * as directUrlService from "./directUrlService.js";

const CONTENT_TYPE = "audio/webm";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Tras acumular este tamaño de la pista actual, arranca el prefetch de la siguiente. */
const EARLY_PREFETCH_BYTES = 256 * 1024;
const PARTIAL_WAIT_MS = 8_000;
const PARTIAL_POLL_MS = 40;

/** Descargas en curso: videoId → { promise, abort, role }. */
const inflight = new Map();

/**
 * Buffers en construcción (permite Range parcial mientras descarga).
 * @type {Map<string, { acc: ReturnType<typeof createByteAccumulator>, expectedLength: number | null, contentType: string }>}
 */
const assembling = new Map();

/** @type {string | null} */
let prefetchTargetId = null;

/** Sirve audio desde caché, desde una URL ya resuelta, o mediante yt-dlp. */
export function streamAudio(videoId, req, res) {
  if (!VIDEO_ID_RE.test(videoId)) {
    res.status(400).json({ error: "videoId inválido" });
    return;
  }

  audioCache.markCurrent(videoId);

  const cached = audioCache.get(videoId);
  if (cached) {
    serveFromCache(cached, req, res);
    maybePrefetchNext();
    return;
  }

  // Reutiliza descarga en curso (prefetch u otra petición) en vez de abrir un segundo fetch.
  if (assembling.has(videoId) || inflight.has(videoId)) {
    const partial = assembling.get(videoId);
    if (req.headers.range && partial) {
      void serveRangeFromAssembling(videoId, partial, req, res);
      return;
    }
    void serveFromAssemblingLive(videoId, req, res);
    return;
  }

  streamAudioFresh(videoId, req, res);
}

/**
 * Declara la ventana de playlist y la pista a prefetchar tras la actual.
 * @param {{ current?: string | null, history?: string[], upcoming?: string[] }} window
 */
export function setPlaylistWindow(window) {
  directUrlService.setPlaylistWindow(window);
  const nextId = Array.isArray(window?.upcoming) ? window.upcoming[0] : null;
  prefetchTargetId = nextId && VIDEO_ID_RE.test(nextId) ? nextId : null;
  audioCache.markNext(prefetchTargetId);
  maybePrefetchNext();
}

/** Verdadero si el videoId ya está en la caché en RAM. */
export function isCached(videoId) {
  return VIDEO_ID_RE.test(videoId) && audioCache.has(videoId);
}

/** Espera la caché en curso (inflight o assembling) y devuelve si quedó disponible. */
export function waitUntilCached(videoId, { timeoutMs = 120_000 } = {}) {
  if (!VIDEO_ID_RE.test(videoId)) {
    return Promise.resolve(false);
  }
  if (audioCache.has(videoId)) {
    return Promise.resolve(true);
  }

  const pending = inflight.get(videoId);
  if (!pending && !assembling.has(videoId)) {
    return Promise.resolve(false);
  }

  const downloadPromise = pending
    ? pending.promise.then(() => audioCache.has(videoId))
    : waitForAssembledBytes(videoId, Number.MAX_SAFE_INTEGER, timeoutMs).then(() => audioCache.has(videoId));

  return Promise.race([
    downloadPromise,
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

/** Espera a que el acumulador tenga al menos `need` bytes o se complete la caché. */
async function waitForAssembledBytes(videoId, need, timeoutMs = PARTIAL_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (audioCache.has(videoId)) return true;
    const entry = assembling.get(videoId);
    if (!entry) return false;
    if (entry.acc.length >= need) return true;
    await sleep(PARTIAL_POLL_MS);
  }
  return audioCache.has(videoId) || (assembling.get(videoId)?.acc.length ?? 0) >= need;
}

/**
 * Adjunta un GET completo a una descarga ya en curso (p. ej. prefetch → play).
 * Evita duplicar CDN/yt-dlp y sirve bytes a medida que llegan.
 */
async function serveFromAssemblingLive(videoId, req, res) {
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });

  const ready = await waitForAssembledBytes(videoId, 1, 30_000);
  if (clientGone || res.writableEnded || res.destroyed) return;

  const cachedNow = audioCache.get(videoId);
  if (cachedNow) {
    serveFromCache(cachedNow, req, res);
    maybePrefetchNext();
    return;
  }

  if (!ready || !assembling.has(videoId)) {
    if (!inflight.has(videoId) && !assembling.has(videoId) && !audioCache.has(videoId)) {
      streamAudioFresh(videoId, req, res);
    }
    return;
  }

  const entry = assembling.get(videoId);
  const pending = inflight.get(videoId);
  if (pending) pending.role = "current";

  res.status(200);
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "bytes");
  if (entry.expectedLength) res.setHeader("Content-Length", entry.expectedLength);

  let sent = 0;
  while (!clientGone && !res.writableEnded && !res.destroyed) {
    const done = audioCache.get(videoId);
    if (done) {
      if (done.buffer.length > sent) {
        res.end(done.buffer.subarray(sent));
      } else if (!res.writableEnded) {
        res.end();
      }
      maybePrefetchNext();
      return;
    }

    const cur = assembling.get(videoId);
    if (!cur) {
      if (!res.writableEnded) res.end();
      return;
    }

    if (cur.acc.length > sent) {
      const slice = Buffer.from(cur.acc.view().subarray(sent));
      sent += slice.length;
      const ok = res.write(slice);
      if (!ok) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
      continue;
    }

    await sleep(PARTIAL_POLL_MS);
  }
}

/** Continúa el arranque de stream cuando no hay assemble reutilizable. */
function streamAudioFresh(videoId, req, res) {
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

  maybePrefetchNext();

  directUrlService.resolveForPlayback(videoId).then(async (entry) => {
    if (clientGone || res.writableEnded || res.destroyed) return;

    if (entry) {
      const outcome = await proxyDirect(videoId, entry, req, res, "current");
      if (outcome === "done") maybePrefetchNext();
      if (outcome !== "fallback" || clientGone || res.headersSent) return;
    }

    if (!clientGone && !res.headersSent) {
      streamFromYtDlp(videoId, res, "current", () => maybePrefetchNext());
    }
  }).catch((err) => {
    console.error("No se pudo preparar el audio:", err);
    if (!clientGone && !res.headersSent) {
      res.status(500).json({ error: "No se pudo preparar el audio." });
    }
  });
}

async function serveRangeFromAssembling(videoId, partial, req, res) {
  const match = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const requestedEnd = match && match[2] ? parseInt(match[2], 10) : null;

  const need = (requestedEnd != null ? requestedEnd : start) + 1;
  const ready = await waitForAssembledBytes(videoId, need);
  const cached = audioCache.get(videoId);
  if (cached) {
    serveFromCache(cached, req, res);
    return;
  }

  const entry = assembling.get(videoId) || partial;
  if (!ready || !entry || entry.acc.length <= start) {
    res.status(416);
    res.setHeader("Content-Range", `bytes */${entry?.expectedLength ?? "*"}`);
    res.end();
    return;
  }

  const available = entry.acc.length;
  const total = entry.expectedLength && entry.expectedLength >= available ? entry.expectedLength : available;
  const end = Math.min(available - 1, requestedEnd != null ? requestedEnd : available - 1);
  const view = entry.acc.view().subarray(start, end + 1);

  res.status(206);
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
  res.setHeader("Content-Length", view.length);
  res.end(Buffer.from(view));
}

/** Tras cachear la actual (o al conocer la siguiente), descarga en segundo plano. */
function maybePrefetchNext() {
  const nextId = prefetchTargetId;
  if (!nextId || !VIDEO_ID_RE.test(nextId)) return;
  if (audioCache.has(nextId) || inflight.has(nextId) || assembling.has(nextId)) return;

  audioCache.markNext(nextId);
  void prefetchAudio(nextId);
}

/** Descarga silenciosa a caché (sin respuesta HTTP al cliente). */
async function prefetchAudio(videoId) {
  if (inflight.has(videoId) || audioCache.has(videoId)) return;

  let entry = urlCache.get(videoId);
  if (!entry) {
    try {
      entry = await directUrlService.resolveUrl(videoId);
    } catch {
      entry = null;
    }
  }

  if (!entry) {
    await prefetchFromYtDlp(videoId);
    return;
  }

  await prefetchFromDirect(videoId, entry);
}

async function prefetchFromDirect(videoId, entry) {
  if (inflight.has(videoId) || audioCache.has(videoId)) return;

  const controller = new AbortController();
  let settle = null;
  const donePromise = new Promise((resolve) => {
    settle = resolve;
  });

  const dropInflight = () => {
    const current = inflight.get(videoId);
    if (current && current.promise === donePromise) inflight.delete(videoId);
  };

  inflight.set(videoId, {
    role: "next",
    promise: donePromise,
    abort: () => controller.abort(),
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
    if (!isAbortError(err)) {
      console.error("Prefetch CDN falló:", err.message);
      urlCache.remove(videoId);
    }
    return;
  }

  if (upstream.status !== 200 || !upstream.body) {
    upstream.body?.cancel?.().catch(() => {});
    dropInflight();
    settle?.(false);
    urlCache.remove(videoId);
    return;
  }

  const contentType = normalizeAudioContentType(upstream.headers.get("content-type")) || entry.contentType;
  const expectedLength = parseContentLength(upstream.headers.get("content-length"));
  const acc = createByteAccumulator(expectedLength || undefined);
  assembling.set(videoId, { acc, expectedLength, contentType });

  try {
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      if (prefetchTargetId !== videoId && audioCache.getCurrentId() !== videoId) {
        controller.abort();
        break;
      }
      acc.push(chunk);
    }
  } catch (err) {
    if (!isAbortError(err)) {
      console.error("Error en prefetch de audio:", err.message);
    }
  }

  dropInflight();
  assembling.delete(videoId);
  if (acc.length > 0 && (prefetchTargetId === videoId || audioCache.getCurrentId() === videoId)) {
    const role = audioCache.getCurrentId() === videoId ? "current" : "next";
    audioCache.set(videoId, acc.take(), contentType, role);
    settle?.(true);
    return;
  }
  settle?.(false);
}

function prefetchFromYtDlp(videoId) {
  return new Promise((resolve) => {
    if (inflight.has(videoId) || audioCache.has(videoId)) {
      resolve(false);
      return;
    }

    const args = ["-f", AUDIO_FORMAT, "-o", "-", "--no-playlist", "--quiet", "--no-warnings"];
    if (hasLocalFfmpeg()) args.push("--ffmpeg-location", ffmpegDir());
    args.push(watchUrl(videoId));

    const proc = spawn(ytDlpPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const acc = createByteAccumulator();
    assembling.set(videoId, { acc, expectedLength: null, contentType: CONTENT_TYPE });
    let settle = null;
    const donePromise = new Promise((r) => {
      settle = r;
    });

    inflight.set(videoId, {
      role: "next",
      promise: donePromise,
      abort: () => {
        if (!proc.killed) proc.kill("SIGKILL");
      },
    });

    proc.stdout.on("data", (chunk) => acc.push(chunk));
    proc.on("error", () => {
      inflight.delete(videoId);
      assembling.delete(videoId);
      settle?.(false);
      resolve(false);
    });
    proc.on("close", (code) => {
      const current = inflight.get(videoId);
      if (current && current.promise === donePromise) inflight.delete(videoId);
      assembling.delete(videoId);

      if (code === 0 && acc.length > 0 && (prefetchTargetId === videoId || audioCache.getCurrentId() === videoId)) {
        const role = audioCache.getCurrentId() === videoId ? "current" : "next";
        audioCache.set(videoId, acc.take(), CONTENT_TYPE, role);
        settle?.(true);
        resolve(true);
        return;
      }
      settle?.(false);
      resolve(false);
    });
  });
}

/** Reenvía el audio del CDN a medida que llega y lo cachea al completar. */
async function proxyDirect(videoId, entry, req, res, role = "current") {
  abortInflightExcept(videoId, { keepPrefetch: prefetchTargetId });

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
    role,
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
    urlCache.remove(videoId);
    return "fallback";
  }

  if (upstream.status !== 200 || !upstream.body) {
    upstream.body?.cancel?.().catch(() => {});
    dropInflight();
    settle?.(false);
    if (!clientAborted) urlCache.remove(videoId);
    return clientAborted ? "aborted" : "fallback";
  }

  const contentType = normalizeAudioContentType(upstream.headers.get("content-type")) || entry.contentType;
  const expectedLength = parseContentLength(upstream.headers.get("content-length"));
  const acc = createByteAccumulator(expectedLength || undefined);
  assembling.set(videoId, { acc, expectedLength, contentType });

  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "bytes");
  if (expectedLength) res.setHeader("Content-Length", expectedLength);

  let earlyPrefetchArmed = false;
  const collect = new Transform({
    transform(chunk, _encoding, callback) {
      acc.push(chunk);
      if (!earlyPrefetchArmed && acc.length >= EARLY_PREFETCH_BYTES) {
        earlyPrefetchArmed = true;
        maybePrefetchNext();
      }
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
  assembling.delete(videoId);
  if (completed && acc.length > 0 && res.writableEnded) {
    audioCache.set(videoId, acc.take(), contentType, role);
    settle?.(true);
    return "done";
  }

  settle?.(false);
  if (!clientAborted && !res.headersSent && acc.length === 0) {
    urlCache.remove(videoId);
    return "fallback";
  }
  return "done";
}

/** Transmite yt-dlp y acumula chunks para cachearlos al finalizar. */
function streamFromYtDlp(videoId, res, role = "current", onCached) {
  abortInflightExcept(videoId, { keepPrefetch: prefetchTargetId });

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

  const acc = createByteAccumulator();
  assembling.set(videoId, { acc, expectedLength: null, contentType: CONTENT_TYPE });

  res.setHeader("Content-Type", CONTENT_TYPE);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "bytes");

  let clientAborted = false;
  let earlyPrefetchArmed = false;
  let settle = null;
  const donePromise = new Promise((resolve) => {
    settle = resolve;
  });

  inflight.set(videoId, {
    role,
    promise: donePromise,
    abort: () => {
      clientAborted = true;
      if (!proc.killed) proc.kill("SIGKILL");
    },
  });

  proc.stdout.on("data", (chunk) => {
    acc.push(chunk);
    if (!earlyPrefetchArmed && acc.length >= EARLY_PREFETCH_BYTES) {
      earlyPrefetchArmed = true;
      maybePrefetchNext();
    }
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
    assembling.delete(videoId);

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

    if (acc.length > 0) {
      audioCache.set(videoId, acc.take(), CONTENT_TYPE, role);
      settle?.(true);
      onCached?.();
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

/**
 * Cancela descargas en curso de otras canciones.
 * Conserva la actual y, si aplica, el prefetch de la siguiente.
 */
function abortInflightExcept(videoId, { keepPrefetch = null } = {}) {
  for (const [id, entry] of inflight) {
    if (id === videoId) continue;
    if (keepPrefetch && id === keepPrefetch && entry.role === "next") continue;
    entry.abort();
    inflight.delete(id);
  }
}

function parseContentLength(value) {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err) {
  return err?.name === "AbortError" || err?.code === "ABORT_ERR";
}

/** Mata cualquier descarga que siga en curso, por ejemplo al cerrar la ventana. */
export function abortAllStreams() {
  prefetchTargetId = null;
  for (const entry of inflight.values()) {
    entry.abort();
  }
  inflight.clear();
  assembling.clear();
  directUrlService.abortAll();
}
