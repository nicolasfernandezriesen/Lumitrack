// Caché RAM de audio para la playlist: actuales, historial y prefetch.
// - Hasta MAX_HISTORY canciones ya escuchadas
// - 1 canción actual
// - 1 canción siguiente (prefetch en segundo plano)

const MAX_HISTORY = 3;

/** @type {Map<string, { buffer: Buffer, contentType: string }>} */
const entries = new Map();

/** @type {string | null} */
let currentVideoId = null;
/** @type {string | null} */
let nextVideoId = null;
/** @type {string[]} ids escuchados más recientes primero */
let historyIds = [];

/** Devuelve la entrada cacheada para el videoId, o null. */
export function get(videoId) {
  const entry = entries.get(videoId);
  if (!entry) return null;
  return { buffer: entry.buffer, contentType: entry.contentType };
}

/**
 * Guarda audio en caché.
 * @param {"current" | "next" | "history"} [role]
 */
export function set(videoId, buffer, contentType, role = "current") {
  if (!videoId || !buffer) return;

  entries.set(videoId, { buffer, contentType });

  if (role === "next") {
    if (nextVideoId && nextVideoId !== videoId && nextVideoId !== currentVideoId) {
      // Solo reemplaza el slot de prefetch; no borra historial.
    }
    nextVideoId = videoId;
    prune();
    return;
  }

  if (role === "history") {
    rememberHistory(videoId);
    prune();
    return;
  }

  // role === "current"
  if (currentVideoId && currentVideoId !== videoId) {
    rememberHistory(currentVideoId);
  }
  if (nextVideoId === videoId) {
    nextVideoId = null;
  }
  currentVideoId = videoId;
  historyIds = historyIds.filter((id) => id !== videoId);
  prune();
}

export function has(videoId) {
  return entries.has(videoId);
}

export function clear() {
  entries.clear();
  currentVideoId = null;
  nextVideoId = null;
  historyIds = [];
}

/** Marca qué pista es la actual al cambiar de canción (antes de cachear bytes). */
export function markCurrent(videoId) {
  if (!videoId || videoId === currentVideoId) return;
  if (currentVideoId) rememberHistory(currentVideoId);
  if (nextVideoId === videoId) nextVideoId = null;
  currentVideoId = videoId;
  historyIds = historyIds.filter((id) => id !== videoId);
  prune();
}

/** Declara la pista a prefetchar como siguiente. */
export function markNext(videoId) {
  nextVideoId = videoId || null;
  prune();
}

/** Ids que deben permanecer en caché (actual + historial + next). */
export function retainIds() {
  const ids = [];
  if (currentVideoId) ids.push(currentVideoId);
  if (nextVideoId && nextVideoId !== currentVideoId) ids.push(nextVideoId);
  for (const id of historyIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function getCurrentId() {
  return currentVideoId;
}

export function getNextId() {
  return nextVideoId;
}

export function size() {
  return entries.size;
}

function rememberHistory(videoId) {
  if (!videoId) return;
  historyIds = [videoId, ...historyIds.filter((id) => id !== videoId)].slice(0, MAX_HISTORY);
}

function prune() {
  const keep = new Set(retainIds());
  for (const id of [...entries.keys()]) {
    if (!keep.has(id)) entries.delete(id);
  }
  // Si el next ya no está en entries y no es el marcado, no pasa nada;
  // si hay demasiadas entradas por race, se recorta historial.
  while (entries.size > MAX_HISTORY + 2) {
    const oldest = historyIds[historyIds.length - 1];
    if (!oldest) break;
    historyIds.pop();
    if (oldest !== currentVideoId && oldest !== nextVideoId) {
      entries.delete(oldest);
    }
  }
}
