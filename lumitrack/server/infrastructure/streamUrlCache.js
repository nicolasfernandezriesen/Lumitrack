// URLs directas del CDN ya resueltas. Caducan; no guardan el audio.

const MAX_ENTRIES = 24;

/** @type {Map<string, { url: string, contentType: string, expiresAt: number }>} */
const entries = new Map();

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
  entries.delete(videoId);
  entries.set(videoId, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    entries.delete(oldest);
  }
}

export function remove(videoId) {
  entries.delete(videoId);
}
