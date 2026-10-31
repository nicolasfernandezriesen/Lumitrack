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
const MAX_SECTION_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_SECTION_CACHE_ENTRIES = 3;

/** Descargas en curso: videoId → { promise, abort, role }. */
const inflight = new Map();

/**
 * Buffers en construcción (permite Range parcial mientras descarga).
 * @type {Map<string, { acc: ReturnType<typeof createByteAccumulator>, expectedLength: number | null, contentType: string }>}
 */
const assembling = new Map();
/** @type {Map<string, { start: number, end: number, buffer: Buffer }>} */
const sectionCache = new Map();
let sectionCacheBytes = 0;

/** @type {string | null} */
let prefetchTargetId = null;

/** Sirve audio desde caché, desde una URL ya resuelta, o mediante yt-dlp. */
export function streamAudio(videoId, req, res) {
  if (!VIDEO_ID_RE.test(videoId)) {
    res.status(400).json({ error: "videoId inválido" });
    return;
  }

  audioCache.markCurrent(videoId);

  if (req.query.start !== undefined || req.query.end !== undefined) {
    const startValue = req.query.start;
    const endValue = req.query.end;
    const start = typeof startValue === "string" ? Number(startValue) : NaN;
    const end = typeof endValue === "string" ? Number(endValue) : NaN;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      res.status(400).json({ error: "Rango de seek inválido." });
      return;
    }

    streamSection(videoId, start, end, res);
    return;
  }

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

/** Pide a yt-dlp/ffmpeg un stream nuevo que comienza en la posición solicitada. */
function streamSection(videoId, start, end, res) {
  const cachedSection = sectionCache.get(videoId);
  if (cachedSection && cachedSection.start === start && cachedSection.end === end) {
    sectionCache.delete(videoId);
    sectionCache.set(videoId, cachedSection);
    res.setHeader("Content-Type", CONTENT_TYPE);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", cachedSection.buffer.length);
    res.end(cachedSection.buffer);
    return;
  }

  const args = [
    "-f",
    AUDIO_FORMAT,
    "--download-sections",
    `*${start}-${end}`,
    "--force-keyframes-at-cuts",
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

  let proc;
  try {
    proc = spawn(ytDlpPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    console.error("No se pudo iniciar seek de audio:", err.message);
    res.status(500).json({ error: "No se pudo iniciar el adelanto del audio." });
    return;
  }

  let stderrBuf = "";
  let acc = createByteAccumulator();
  let cacheable = true;
  let clientAborted = false;
  proc.stderr.on("data", (chunk) => {
    stderrBuf = (stderrBuf + chunk.toString()).slice(-2_000);
  });

  res.setHeader("Content-Type", CONTENT_TYPE);
  res.setHeader("Cache-Control", "no-store");
  proc.stdout.on("data", (chunk) => {
    if (clientAborted) return;
    if (cacheable) {
      if (acc.length + chunk.length <= MAX_SECTION_CACHE_BYTES) {
        acc.push(chunk);
      } else {
        acc = null;
        cacheable = false;
      }
    }
    // No pausar yt-dlp por la contrapresión del reproductor: continuar llenando la caché.
    res.write(chunk);
  });

  proc.on("error", (err) => {
    console.error("No se pudo iniciar yt-dlp para seek:", err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: "No se pudo iniciar yt-dlp para adelantar el audio.",
      });
    } else if (!res.destroyed) {
      res.destroy(err);
    }
  });

  proc.on("close", (code) => {
    if (clientAborted || res.destroyed || res.writableEnded) return;
    if (code === 0) {
      if (cacheable && acc.length > 0) {
        cacheSection(videoId, start, end, acc.take());
      }
      if (!res.writableEnded) res.end();
      return;
    }

    console.error("yt-dlp no pudo generar el segmento de audio:", stderrBuf.slice(-500));
    if (!res.headersSent) {
      res.status(502).json({
        error: "No se pudo cargar el audio desde la posición solicitada.",
        detail: stderrBuf.slice(-500),
      });
    } else {
      res.destroy();
    }
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      clientAborted = true;
      acc = null;
      if (!proc.killed) proc.kill("SIGKILL");
    }
  });
}

function cacheSection(videoId, start, end, buffer) {
  const previous = sectionCache.get(videoId);
  if (previous) {
    sectionCacheBytes -= previous.buffer.length;
    sectionCache.delete(videoId);
  }
  while (
    sectionCache.size > 0 &&
    (sectionCache.size >= MAX_SECTION_CACHE_ENTRIES ||
      sectionCacheBytes + buffer.length > MAX_SECTION_CACHE_BYTES)
  ) {
    const oldestId = sectionCache.keys().next().value;
    sectionCacheBytes -= sectionCache.get(oldestId).buffer.length;
    sectionCache.delete(oldestId);
  }
  if (buffer.length > MAX_SECTION_CACHE_BYTES) return;
  sectionCache.set(videoId, { start, end, buffer });
  sectionCacheBytes += buffer.length;
}

/**
 * Declara la ventana de playlist y la pista a prefetchar tras la actual.
 * @param {{ current?: string | null, history?: string[], upcoming?: string[] }} window
 */
export function setPlaylistWindow(window) {
  directUrlService.setPlaylistWindow(window);
  const nextId = Array.isArray(window?.upcoming) ? window.upcoming[0] : null;
  const previousNextId = audioCache.getNextId();
  prefetchTargetId = nextId && VIDEO_ID_RE.test(nextId) ? nextId : null;
  if (previousNextId && previousNextId !== prefetchTargetId) {
    cancelPrefetch(previousNextId);
  }
  audioCache.markNext(prefetchTargetId);
  maybePrefetchNext();
}

/** Verdadero si el videoId ya está en la caché en RAM. */
export function isCached(videoId) {
  return VIDEO_ID_RE.test(videoId) && audioCache.has(videoId);
}

/** Devuelve el segmento cacheado que cubre una posición absoluta de la pista. */
export function getCachedSection(videoId, seconds) {
  if (!VIDEO_ID_RE.test(videoId) || !Number.isFinite(seconds)) return null;
  const section = sectionCache.get(videoId);
  if (!section || seconds < section.start || seconds > section.end) return null;
  sectionCache.delete(videoId);
  sectionCache.set(videoId, section);
  return { start: section.start, end: section.end };
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

function cancelPrefetch(videoId) {
  const pending = inflight.get(videoId);
  if (pending?.role === "next") {
    pending.abort();
    if (inflight.get(videoId) === pending) inflight.delete(videoId);
  }
  assembling.delete(videoId);
  audioCache.discardNext(videoId);
}

/** Descarga silenciosa a caché (sin respuesta HTTP al cliente). */
async function prefetchAudio(videoId) {
  if (prefetchTargetId !== videoId || inflight.has(videoId) || audioCache.has(videoId)) return;

  let entry = urlCache.get(videoId);
  if (!entry) {
    try {
      entry = await directUrlService.resolveUrl(videoId);
    } catch {
      entry = null;
    }
  }
  if (prefetchTargetId !== videoId || audioCache.has(videoId)) return;

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
  const assembly = { acc, expectedLength, contentType };
  assembling.set(videoId, assembly);

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
  if (assembling.get(videoId) === assembly) assembling.delete(videoId);
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
    const assembly = { acc, expectedLength: null, contentType: CONTENT_TYPE };
    assembling.set(videoId, assembly);
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
      const current = inflight.get(videoId);
      if (current && current.promise === donePromise) inflight.delete(videoId);
      if (assembling.get(videoId) === assembly) assembling.delete(videoId);
      settle?.(false);
      resolve(false);
    });
    proc.on("close", (code) => {
      const current = inflight.get(videoId);
      if (current && current.promise === donePromise) inflight.delete(videoId);
      if (assembling.get(videoId) === assembly) assembling.delete(videoId);

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
