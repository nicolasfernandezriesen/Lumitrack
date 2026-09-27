/** Busca tracks contra /api/search y lanza si la respuesta falla. */
export async function searchTracks(query) {
  const res = await fetch("/api/search?q=" + encodeURIComponent(query));
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Error de búsqueda");
  }
  return data.results || [];
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
