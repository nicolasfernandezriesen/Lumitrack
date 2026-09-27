// Caché RAM de un único audio; se reemplaza al reproducir otra canción.
let cachedVideoId = null;
let cachedBuffer = null;
let cachedContentType = null;

/** Devuelve la entrada cacheada para el videoId, o null. */
export function get(videoId) {
  if (cachedVideoId !== videoId || !cachedBuffer) return null;
  return { buffer: cachedBuffer, contentType: cachedContentType };
}

export function set(videoId, buffer, contentType) {
  cachedVideoId = videoId;
  cachedBuffer = buffer;
  cachedContentType = contentType;
}

export function has(videoId) {
  return cachedVideoId === videoId && !!cachedBuffer;
}

export function clear() {
  cachedVideoId = null;
  cachedBuffer = null;
  cachedContentType = null;
}
