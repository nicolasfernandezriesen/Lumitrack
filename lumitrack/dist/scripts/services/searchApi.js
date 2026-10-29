/** Busca tracks contra /api/search y lanza si la respuesta falla. */
export async function searchTracks(query) {
  const res = await fetch("/api/search?q=" + encodeURIComponent(query));
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Error de búsqueda");
  }
  return data.results || [];
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
