/** Busca resultados contra /api/search y lanza si la respuesta falla. */
export async function searchTracks(query, filter = "song") {
  const params = new URLSearchParams({ q: query, filter });
  const res = await fetch(`/api/search?${params}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Error de búsqueda");
  }
  return data.results || [];
}

/** Obtiene los detalles y todas las canciones de una playlist. */
export async function fetchPlaylist(playlistId, creator = "") {
  const params = new URLSearchParams();
  if (creator) params.set("creator", creator);
  const query = params.toString();
  const res = await fetch(
    `/api/playlist/${encodeURIComponent(playlistId)}${query ? `?${query}` : ""}`,
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Error al obtener la playlist");
  }
  return data.playlist;
}

/** Obtiene los metadatos y todas las canciones de un álbum. */
export async function fetchAlbum(albumId) {
  const res = await fetch(`/api/album/${encodeURIComponent(albumId)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Error al obtener el álbum");
  }
  return data.album;
}

/** Obtiene el perfil y las canciones más populares de un artista. */
export async function fetchArtist(artistId) {
  const res = await fetch(`/api/artist/${encodeURIComponent(artistId)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Error al obtener el artista");
  }
  return data.artist;
}

/** Canciones similares para la playlist (radio / up-next). */
export async function fetchRelatedTracks(videoId, excludeIds = []) {
  const params = new URLSearchParams();
  if (excludeIds.length) params.set("exclude", excludeIds.join(","));
  const qs = params.toString();
  const res = await fetch(
    `/api/related/${encodeURIComponent(videoId)}${qs ? `?${qs}` : ""}`
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Error al obtener relacionadas");
  }
  return data.results || [];
}

/** Sincroniza la ventana de playlist con las cachés del servidor. */
export async function syncPlaylistWindow({ current, history = [], upcoming = [] }) {
  const res = await fetch("/api/playlist/window", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current, history, upcoming }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Error al sincronizar playlist");
  }
  return true;
}

export function streamUrl(videoId) {
  return `/api/stream/${videoId}`;
}

export async function isTrackCached(videoId) {
  const res = await fetch(`/api/cached/${encodeURIComponent(videoId)}`);
  if (!res.ok) return false;
  const data = await res.json();
  return !!data.cached;
}

/** Espera la caché del servidor mientras suena la descarga. */
export async function waitUntilTrackCached(videoId) {
  const res = await fetch(`/api/cached/${encodeURIComponent(videoId)}/wait`);
  if (!res.ok) return false;
  const data = await res.json();
  return !!data.cached;
}
