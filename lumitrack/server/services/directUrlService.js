// Resuelve la URL directa del audio en segundo plano, antes de que el usuario elija.

import { spawn } from "node:child_process";
import { ytDlpPath } from "../infrastructure/binaries.js";
import * as urlCache from "../infrastructure/urlCache.js";
import * as playlistUrlCache from "../infrastructure/playlistUrlCache.js";
import { AUDIO_FORMAT, VIDEO_ID_RE, describeDirectUrl, watchUrl } from "../infrastructure/youtubeAudio.js";

const CONCURRENCY = 2;

/** @type {Map<string, { pinned: boolean, promise: Promise, abort: () => void }>} */
const jobs = new Map();
/** @type {string[]} */
let queue = [];
let deferPump = false;
let activeDownloads = 0;

/** Encola las pistas de una búsqueda. No bloquea la respuesta HTTP. */
export function prefetch(videoIds) {
  const wanted = uniqueIds(videoIds);
  const playlistIds = playlistUrlCache.windowIds();
  const wantedSet = new Set([...wanted, ...playlistIds]);

  deferPump = true;
  for (const [id, job] of jobs) {
    if (!wantedSet.has(id) && !job.pinned) job.abort();
  }
  // Conserva en cola las de la ventana de playlist que aún falten.
  const keepPlaylist = queue.filter((id) => playlistIds.includes(id));
  const fresh = wanted.filter((id) => !urlCache.get(id) && !jobs.has(id));
  queue = uniqueIds([...keepPlaylist, ...fresh, ...playlistIds.filter((id) => !urlCache.get(id) && !jobs.has(id))]);
  deferPump = false;
  pump();
}

/**
 * Actualiza la ventana de playlist (URLs: 3 atrás + 3 adelante + actual)
 * y encola la resolución de las que falten.
 */
export function setPlaylistWindow({ current = null, history = [], upcoming = [] } = {}) {
  playlistUrlCache.setWindow({ current, history, upcoming });
  const ids = playlistUrlCache.windowIds();
  if (!ids.length) return;

  deferPump = true;
  for (const id of ids) {
    if (urlCache.get(id) || jobs.has(id) || queue.includes(id)) continue;
    queue.push(id);
  }
  deferPump = false;
  pump();
}

/**
 * URL lista para reproducir. Frena el resto de resoluciones mientras
 * esta pista se descarga, para no competir por CPU ni por red.
 */
export function resolveForPlayback(videoId) {
  activeDownloads += 1;
  deferPump = true;

  for (const [id, job] of [...jobs.entries()]) {
    if (id === videoId) {
      job.pinned = true;
      continue;
    }
    job.abort();
    requeue(id);
  }
  queue = queue.filter((id) => id !== videoId);

  const pending = resolve(videoId);
  deferPump = false;
  return pending;
}

/** Libera el turno de descarga y retoma las resoluciones en cola. */
export function releaseDownload() {
  activeDownloads = Math.max(0, activeDownloads - 1);
  if (activeDownloads === 0) pump();
}

/** Resuelve una URL sin abortar otras resoluciones (útil para prefetch). */
export function resolveUrl(videoId) {
  if (!VIDEO_ID_RE.test(videoId)) return Promise.resolve(null);
  return resolve(videoId);
}

/** Mata resoluciones en curso, por ejemplo al cerrar la ventana. */
export function abortAll() {
  deferPump = true;
  queue = [];
  activeDownloads = 0;
  for (const job of jobs.values()) job.abort();
  deferPump = false;
}

function resolve(videoId) {
  const cached = urlCache.get(videoId);
  if (cached) return Promise.resolve(cached);

  const existing = jobs.get(videoId);
  if (existing) {
    existing.pinned = true;
    return existing.promise;
  }

  queue = queue.filter((id) => id !== videoId);
  return startJob(videoId, true).promise;
}

function pump() {
  if (deferPump || activeDownloads > 0) return;

  while (jobs.size < CONCURRENCY && queue.length > 0) {
    const videoId = queue.shift();
    if (!videoId || urlCache.get(videoId) || jobs.has(videoId)) continue;
    startJob(videoId, false);
  }
}

function requeue(videoId) {
  if (!VIDEO_ID_RE.test(videoId)) return;
  if (queue.includes(videoId) || jobs.has(videoId) || urlCache.get(videoId)) return;
  queue.unshift(videoId);
}

function uniqueIds(videoIds) {
  const seen = new Set();
  const ids = [];
  for (const id of videoIds) {
    if (!VIDEO_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function startJob(videoId, pinned) {
  let settled = false;
  let killed = false;
  let proc = null;
  let resolvePromise = () => {};

  const job = {
    pinned,
    promise: new Promise((resolve) => {
      resolvePromise = resolve;
    }),
    abort() {
      killed = true;
      if (proc && !proc.killed) proc.kill("SIGKILL");
      finish(null);
    },
  };

  function finish(entry) {
    if (settled) return;
    settled = true;
    if (jobs.get(videoId) === job) jobs.delete(videoId);
    resolvePromise(entry);
    pump();
  }

  let stdout = "";
  let stderr = "";
  try {
    proc = spawn(
      ytDlpPath(),
      ["-f", AUDIO_FORMAT, "-g", "--no-playlist", "--quiet", "--no-warnings", watchUrl(videoId)],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
  } catch (err) {
    console.error("No se pudo iniciar yt-dlp:", err.message);
    jobs.set(videoId, job);
    finish(null);
    return job;
  }

  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    if (stderr.length < 400) stderr += chunk.toString();
  });
  proc.on("error", () => finish(null));
  proc.on("close", (code) => {
    if (killed || code !== 0) {
      if (!killed && code !== 0) {
        console.error(`No se pudo resolver la URL de ${videoId}:`, stderr.slice(-200));
      }
      finish(null);
      return;
    }

    const line = stdout
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.startsWith("https://"));
    const entry = line ? describeDirectUrl(line) : null;
    if (!entry) {
      finish(null);
      return;
    }

    urlCache.set(videoId, entry);
    finish(entry);
  });

  jobs.set(videoId, job);
  return job;
}
