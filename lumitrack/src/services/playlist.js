import { fetchRelatedTracks, syncPlaylistWindow } from "./searchApi.js";

const MAX_HISTORY = 10;
const MAX_UPCOMING = 20;
const WINDOW_SYNC_DEBOUNCE_MS = 180;

function trackIdentity(track) {
  return track?.playlistEntryId || track?.videoId;
}

function isSameTrack(left, right) {
  return trackIdentity(left) === trackIdentity(right);
}

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
  const playlistTrackIds = new Set();
  const playlistUpcomingCounts = new Map();
  const removedUpcomingIds = new Set();
  let refillToken = 0;
  let syncTimer = null;
  let syncToken = 0;
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

  function refreshPlaylistUpcoming() {
    playlistUpcomingCounts.clear();
    for (const track of upcoming) {
      if (!playlistTrackIds.has(track.videoId)) continue;
      playlistUpcomingCounts.set(
        track.videoId,
        (playlistUpcomingCounts.get(track.videoId) || 0) + 1,
      );
    }
  }

  /** @param {{ urgent?: boolean }} [opts] urgent = cambio de pista (prefetch inmediato). */
  function emit({ urgent = false } = {}) {
    onChange?.(snapshot());
    if (urgent) {
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      void pushWindow();
      return;
    }
    schedulePushWindow();
  }

  function schedulePushWindow() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void pushWindow();
    }, WINDOW_SYNC_DEBOUNCE_MS);
  }

  async function pushWindow() {
    if (!current) return;
    const token = ++syncToken;
    const payload = {
      current: current.videoId,
      history: history.slice(0, 2).map((t) => t.videoId),
      upcoming: upcoming.slice(0, 20).map((t) => t.videoId),
    };
    try {
      await syncPlaylistWindow(payload);
    } catch (err) {
      if (token !== syncToken) return;
      console.warn("No se pudo sincronizar la ventana de playlist:", err);
    }
  }

  function excludeIds() {
    const ids = [];
    if (current) ids.push(current.videoId);
    for (const t of history) ids.push(t.videoId);
    for (const t of upcoming) ids.push(t.videoId);
    for (const id of removedUpcomingIds) ids.push(id);
    return ids;
  }

  async function refillUpcoming(seedTrack) {
    if (playlistUpcomingCounts.size) return;
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
        refreshPlaylistUpcoming();
        emit();
      }
    } catch (err) {
      console.warn("No se pudieron cargar canciones relacionadas:", err);
    }
  }

  /** Arranca (o reinicia) la playlist al elegir una canción desde la búsqueda. */
  async function playFromSelection(track) {
    if (!track?.videoId) return snapshot();

    const historyIndex = history.findIndex(
      (queued) => isSameTrack(queued, track),
    );
    const upcomingIndex = upcoming.findIndex(
      (queued) => isSameTrack(queued, track),
    );
    if (historyIndex >= 0 || upcomingIndex >= 0) {
      removedUpcomingIds.delete(track.videoId);
    } else {
      removedUpcomingIds.clear();
    }

    if (historyIndex >= 0) {
      const newerHistory = history.slice(0, historyIndex).reverse();
      history = history.slice(historyIndex + 1);
      const queuedIds = new Set(newerHistory.map(trackIdentity));
      upcoming = [
        ...newerHistory,
        ...upcoming.filter((queued) => !queuedIds.has(trackIdentity(queued))),
      ];
      current = track;
      refreshPlaylistUpcoming();
      refillToken += 1;
      emit({ urgent: true });
      await refillUpcoming(track);
      return snapshot();
    }

    const remainingUpcoming =
      upcomingIndex >= 0
        ? upcoming.filter((queued) => !isSameTrack(queued, track))
        : [];

    if (
      historyIndex < 0 &&
      upcomingIndex < 0 &&
      !playlistTrackIds.has(track.videoId)
    ) {
      playlistTrackIds.clear();
    }
    if (current && current.videoId !== track.videoId) {
      history = [
        current,
        ...history.filter((t) => !isSameTrack(t, current)),
      ].slice(0, MAX_HISTORY);
    }

    upcoming = remainingUpcoming;
    history = history.filter((queued) => !isSameTrack(queued, track));
    current = track;
    refreshPlaylistUpcoming();
    emit({ urgent: true });
    await refillUpcoming(track);
    return snapshot();
  }

  /** Reproduce una playlist completa desde la pista seleccionada. */
  async function playPlaylist(tracks, startIndex = 0) {
    if (!Array.isArray(tracks) || !Number.isInteger(startIndex)) {
      return snapshot();
    }
    if (!tracks[startIndex]?.videoId) return snapshot();
    const playlistTracks = tracks
      .slice(startIndex)
      .map((track, index) => {
        if (!track?.videoId) return null;
        return {
          ...track,
          playlistEntryId:
            track.playlistEntryId ||
            `${startIndex + index}:${track.videoId}`,
        };
      })
      .filter(Boolean);
    const selected = playlistTracks[0];
    if (!selected) return snapshot();

    playlistTrackIds.clear();
    for (const track of playlistTracks) {
      if (track?.videoId) playlistTrackIds.add(track.videoId);
    }
    current = selected;
    history = [];
    upcoming = playlistTracks.slice(1);
    removedUpcomingIds.clear();
    refreshPlaylistUpcoming();
    refillToken += 1;
    emit({ urgent: true });
    return snapshot();
  }

  /** Coloca la pista elegida al principio de lo que queda por reproducir. */
  function playNext(track) {
    if (!track?.videoId) return snapshot();
    if (!current) return playFromSelection(track);
    if (current.videoId === track.videoId) return snapshot();

    removedUpcomingIds.delete(track.videoId);
    refillToken += 1;
    upcoming = [
      track,
      ...upcoming.filter((queued) => !isSameTrack(queued, track)),
    ];
    refreshPlaylistUpcoming();
    emit({ urgent: true });
    if (upcoming.length < MAX_UPCOMING) void refillUpcoming(current);
    return snapshot();
  }

  function removeTrack(videoId) {
    if (!videoId) return snapshot();
    const remainingUpcoming = upcoming.filter(
      (track) => track.videoId !== videoId,
    );
    const remainingHistory = history.filter(
      (track) => track.videoId !== videoId,
    );
    if (
      remainingUpcoming.length === upcoming.length &&
      remainingHistory.length === history.length
    ) {
      return snapshot();
    }
    const removedFromUpcoming = remainingUpcoming.length !== upcoming.length;
    if (removedFromUpcoming) {
      removedUpcomingIds.delete(videoId);
      removedUpcomingIds.add(videoId);
      if (removedUpcomingIds.size > MAX_UPCOMING) {
        removedUpcomingIds.delete(removedUpcomingIds.values().next().value);
      }
      refillToken += 1;
    }
    upcoming = remainingUpcoming;
    history = remainingHistory;
    refreshPlaylistUpcoming();
    emit();
    if (removedFromUpcoming && current) void refillUpcoming(current);
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
      history = [
        current,
        ...history.filter((t) => !isSameTrack(t, current)),
      ].slice(0, MAX_HISTORY);
      current = retry;
      emit({ urgent: true });
      void refillUpcoming(current);
      return current;
    }

    refreshPlaylistUpcoming();
    history = [
      current,
      ...history.filter((t) => !isSameTrack(t, current)),
    ].slice(0, MAX_HISTORY);
    current = next;
    emit({ urgent: true });
    void refillUpcoming(current);
    return current;
  }

  /** Retrocede a la canción anterior de la playlist, si hay. */
  function goPrevious() {
    if (!history.length || !current) return null;
    refillToken += 1;
    const prev = history.shift();
    upcoming = [
      current,
      ...upcoming.filter((t) => !isSameTrack(t, current)),
    ];
    current = prev;
    refreshPlaylistUpcoming();
    emit({ urgent: true });
    if (upcoming.length < MAX_UPCOMING) void refillUpcoming(current);
    return current;
  }

  function subscribe(callback) {
    onChange = callback;
    callback(snapshot());
  }

  return {
    playFromSelection,
    playPlaylist,
    playNext,
    removeTrack,
    goNext,
    goPrevious,
    peekNext,
    peekPrevious,
    snapshot,
    subscribe,
  };
}
