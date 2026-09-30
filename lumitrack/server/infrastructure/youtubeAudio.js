// Formato y URL de una pista de YouTube, compartidos por la resolución y el fallback.

export const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

// WebM/Opus primero: el navegador puede empezar a reproducir con los primeros bytes.
export const AUDIO_FORMAT = "ba[ext=webm]/ba[ext=m4a]/ba";

const DEFAULT_TTL_MS = 5 * 60 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60_000;

export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Lee tipo y vencimiento de una URL directa del CDN. Null si ya no sirve. */
export function describeDirectUrl(rawUrl) {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!url.startsWith("https://")) return null;

  let contentType = "audio/webm";
  let expiresAt = Date.now() + DEFAULT_TTL_MS;

  try {
    const parsed = new URL(url);
    const fromMime = normalizeAudioContentType(parsed.searchParams.get("mime"));
    if (fromMime) contentType = fromMime;

    const expire = parsed.searchParams.get("expire");
    if (expire && /^\d+$/.test(expire)) {
      expiresAt = Number(expire) * 1000 - EXPIRY_MARGIN_MS;
    }
  } catch {
    return null;
  }

  if (expiresAt <= Date.now()) return null;
  return { url, contentType, expiresAt };
}

export function normalizeAudioContentType(mime) {
  if (!mime) return null;
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base === "audio/webm" || base === "audio/mp4") return base;
  if (base === "video/webm") return "audio/webm";
  if (base === "video/mp4") return "audio/mp4";
  return null;
}
