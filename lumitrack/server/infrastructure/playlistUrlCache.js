// URLs directas para las 2 canciones recientes, la actual y hasta 20 próximas.
// Separada de la caché general de búsqueda para no mezclar prioridades.

const MAX_HISTORY = 2;
const MAX_UPCOMING = 20;
const MAX_ENTRIES = MAX_HISTORY + MAX_UPCOMING + 1; // + canción actual

/** @type {Map<string, { url: string, contentType: string, expiresAt: number }>} */
const entries = new Map();

/** @type {string | null} */
let currentVideoId = null;
/** @type {string[]} */
let historyIds = [];
/** @type {string[]} */
let upcomingIds = [];

export function get(videoId) {
  const entry = entries.get(videoId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    entries.delete(videoId);
    return null;
  }
  return entry;
}

export function set(videoId, entry) {
  if (!videoId || !entry) return;
  entries.delete(videoId);
  entries.set(videoId, entry);
  pruneToWindow();
}

export function remove(videoId) {
  entries.delete(videoId);
}

export function clear() {
  entries.clear();
  currentVideoId = null;
  historyIds = [];
  upcomingIds = [];
}

/**
 * Define la ventana de playlist que debe mantenerse en caché de URLs.
 * @param {{ current?: string | null, history?: string[], upcoming?: string[] }} window
 */
export function setWindow({
  current = null,
  history = [],
  upcoming = [],
} = {}) {
  currentVideoId = current || null;
  historyIds = unique(history).slice(0, MAX_HISTORY);
  upcomingIds = unique(upcoming).slice(0, MAX_UPCOMING);
  pruneToWindow();
}

/** Ids de la ventana actual (actual + historial de audio + hasta 20 próximas). */
export function windowIds() {
  const ids = [];
  if (currentVideoId) ids.push(currentVideoId);
  for (const id of historyIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  for (const id of upcomingIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_ENTRIES);
}

export function size() {
  return entries.size;
}

function pruneToWindow() {
  const keep = new Set(windowIds());
  if (keep.size === 0) {
    // Sin ventana activa no evictamos por playlist; limpia solo expirados.
    for (const [id, entry] of entries) {
      if (Date.now() >= entry.expiresAt) entries.delete(id);
    }
    return;
  }

  for (const [id, entry] of entries) {
    if (Date.now() >= entry.expiresAt || !keep.has(id)) {
      entries.delete(id);
    }
  }

  // Si aún sobran (race), recorta por orden de inserción.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (!oldest || keep.has(oldest)) {
      // Evita bucle infinito: borra el primero no prioritario.
      let removed = false;
      for (const id of entries.keys()) {
        if (!keep.has(id)) {
          entries.delete(id);
          removed = true;
          break;
        }
      }
      if (!removed) break;
      continue;
    }
    entries.delete(oldest);
  }
}

function unique(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
