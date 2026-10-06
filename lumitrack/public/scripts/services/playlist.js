import { fetchRelatedTracks, syncPlaylistWindow } from "./searchApi.js";

const MAX_HISTORY = 3;
const MAX_UPCOMING = 6;
const RELATED_BATCH = 12;

/**
 * Estado de playlist en el cliente: historial + cola de similares.
 * Más adelante el ranking puede venir de SQLite; hoy usa /api/related.
 */
export function createPlaylistController() {
  let current = null;
  /** @type {object[]} */
  let history = [];
  /** @type {object[]} */
  let upcoming = [];
  let refillToken = 0;
  /** @type {((snapshot: object) => void) | null} */
  let onChange = null;

  function snapshot() {
    return {
      current,
      previous: history[0] || null,
      next: upcoming[0] || null,
      history: history.slice(),
      upcoming: upcoming.slice(),
      hasPrevious: history.length > 0,
      hasNext: upcoming.length > 0,
    };
  }

  function emit() {
    onChange?.(snapshot());
    void pushWindow();
  }

  async function pushWindow() {
    if (!current) return;
    try {
      await syncPlaylistWindow({
        current: current.videoId,
        history: history.slice(0, 3).map((t) => t.videoId),
        upcoming: upcoming.slice(0, 3).map((t) => t.videoId),
      });
    } catch (err) {
      console.warn("No se pudo sincronizar la ventana de playlist:", err);
    }
  }

  function excludeIds() {
    const ids = [];
    if (current) ids.push(current.videoId);
    for (const t of history) ids.push(t.videoId);
    for (const t of upcoming) ids.push(t.videoId);
    return ids;
  }

  async function refillUpcoming(seedTrack) {
    const token = ++refillToken;
    const seed = seedTrack || current;
    if (!seed?.videoId) return;

    try {
      const related = await fetchRelatedTracks(seed.videoId, excludeIds());
      if (token !== refillToken) return;

      const seen = new Set(excludeIds());
      const additions = [];
      for (const track of related) {
        if (!track?.videoId || seen.has(track.videoId)) continue;
        seen.add(track.videoId);
        additions.push(track);
        if (upcoming.length + additions.length >= MAX_UPCOMING) break;
      }

      if (additions.length) {
        upcoming = [...upcoming, ...additions].slice(0, MAX_UPCOMING);
        emit();
      }
    } catch (err) {
      console.warn("No se pudieron cargar canciones relacionadas:", err);
    }
  }

  /** Arranca (o reinicia) la playlist al elegir una canción desde la búsqueda. */
  async function playFromSelection(track) {
    if (!track?.videoId) return snapshot();

    if (current && current.videoId !== track.videoId) {
      history = [current, ...history.filter((t) => t.videoId !== current.videoId)].slice(0, MAX_HISTORY);
    }

    // Si el usuario eligió algo que ya estaba en la cola, recorta hasta ahí.
    const idx = upcoming.findIndex((t) => t.videoId === track.videoId);
    if (idx >= 0) {
      upcoming = upcoming.slice(idx + 1);
    } else {
      upcoming = [];
    }

    current = track;
    emit();
    await refillUpcoming(track);
    return snapshot();
  }

  function peekNext() {
    return upcoming[0] || null;
  }

  function peekPrevious() {
    return history[0] || null;
  }

  /** Avanza a la siguiente; rellena la cola si hace falta. */
  async function goNext() {
    if (!current) return null;
    const next = upcoming.shift() || null;
    if (!next) {
      await refillUpcoming(current);
      const retry = upcoming.shift() || null;
      if (!retry) return null;
      history = [current, ...history.filter((t) => t.videoId !== current.videoId)].slice(0, MAX_HISTORY);
      current = retry;
      emit();
      if (upcoming.length < 3) void refillUpcoming(current);
      return current;
    }

    history = [current, ...history.filter((t) => t.videoId !== current.videoId)].slice(0, MAX_HISTORY);
    current = next;
    emit();
    if (upcoming.length < 3) void refillUpcoming(current);
    return current;
  }

  /** Retrocede a la canción anterior de la playlist, si hay. */
  function goPrevious() {
    if (!history.length || !current) return null;
    const prev = history.shift();
    upcoming = [current, ...upcoming.filter((t) => t.videoId !== current.videoId)].slice(0, MAX_UPCOMING);
    current = prev;
    emit();
    return current;
  }

  function subscribe(callback) {
    onChange = callback;
    callback(snapshot());
  }

  return {
    playFromSelection,
    goNext,
    goPrevious,
    peekNext,
    peekPrevious,
    snapshot,
    subscribe,
  };
}
