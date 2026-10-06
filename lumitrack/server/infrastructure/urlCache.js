// Lectura/escritura unificada: ventana de playlist (prioridad) + caché de búsqueda.

import * as playlistUrlCache from "./playlistUrlCache.js";
import * as streamUrlCache from "./streamUrlCache.js";

export function get(videoId) {
  return playlistUrlCache.get(videoId) || streamUrlCache.get(videoId);
}

export function set(videoId, entry) {
  const inPlaylistWindow = playlistUrlCache.windowIds().includes(videoId);
  if (inPlaylistWindow) {
    playlistUrlCache.set(videoId, entry);
  }
  streamUrlCache.set(videoId, entry);
}

export function remove(videoId) {
  playlistUrlCache.remove(videoId);
  streamUrlCache.remove(videoId);
}
