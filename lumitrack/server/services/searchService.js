// Busca metadata con ytmusic-api; yt-dlp se reserva para el streaming.
import YTMusic from "ytmusic-api";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Cliente reutilizable; se inicializa una vez por proceso. */
let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const ytmusic = new YTMusic();
      await ytmusic.initialize();
      return ytmusic;
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/** Busca canciones y devuelve metadata normalizada para el frontend. */
export async function searchTracks(query, maxResults = 12) {
  const q = (query || "").trim();
  if (!q) return [];

  const ytmusic = await getClient();
  const songs = await ytmusic.searchSongs(q);

  const seen = new Set();
  const results = [];

  for (const song of songs) {
    const track = normalizeSong(song);
    if (!VIDEO_ID_RE.test(track.videoId)) continue;
    if (seen.has(track.videoId)) continue;
    seen.add(track.videoId);
    results.push(track);
    if (results.length >= maxResults) break;
  }

  return results;
}

/**
 * Canciones similares / siguientes (radio de YouTube Music).
 * Por ahora sin ranking propio; más adelante se podrá reemplazar con SQLite.
 */
export async function getRelatedTracks(videoId, { limit = 12, excludeIds = [] } = {}) {
  if (!VIDEO_ID_RE.test(videoId)) return [];

  const exclude = new Set(excludeIds.filter((id) => VIDEO_ID_RE.test(id)));
  exclude.add(videoId);

  const ytmusic = await getClient();
  let related = [];

  try {
    related = await ytmusic.getUpNexts(videoId);
  } catch (err) {
    console.error("getUpNexts falló, fallback a búsqueda:", err.message);
  }

  const results = [];
  const seen = new Set(exclude);

  for (const item of related || []) {
    const track = normalizeUpNext(item);
    if (!VIDEO_ID_RE.test(track.videoId)) continue;
    if (seen.has(track.videoId)) continue;
    seen.add(track.videoId);
    results.push(track);
    if (results.length >= limit) return results;
  }

  // Fallback: buscar por artista/título de la canción actual si up-nexts vino vacío.
  if (results.length < limit) {
    try {
      const song = await ytmusic.getSong(videoId);
      const artistName = song?.artist?.name || "";
      const query = [artistName, song?.name].filter(Boolean).join(" ").trim();
      if (query) {
        const more = await searchTracks(query, limit + 4);
        for (const track of more) {
          if (seen.has(track.videoId)) continue;
          seen.add(track.videoId);
          results.push(track);
          if (results.length >= limit) break;
        }
      }
    } catch (err) {
      console.error("Fallback de relacionadas falló:", err.message);
    }
  }

  return results;
}

function normalizeSong(song) {
  const videoId = song.videoId || "";
  return {
    videoId,
    title: song.name || "Sin título",
    artist: pickArtist(song),
    thumbnail: pickBestThumbnail(song, videoId),
    publishedAt: null,
    duration: typeof song.duration === "number" ? song.duration : null,
  };
}

function normalizeUpNext(item) {
  const videoId = item?.videoId || "";
  const artist =
    typeof item?.artists === "string"
      ? item.artists
      : item?.artists?.name || pickArtist(item);
  return {
    videoId,
    title: item?.title || item?.name || "Sin título",
    artist: artist || "Desconocido",
    thumbnail: pickBestThumbnail(item, videoId),
    publishedAt: null,
    duration: typeof item?.duration === "number" ? item.duration : null,
  };
}

function pickArtist(song) {
  if (typeof song.artist === "string" && song.artist.trim()) {
    return song.artist.trim();
  }
  if (song.artist && typeof song.artist.name === "string" && song.artist.name.trim()) {
    return song.artist.name.trim();
  }
  if (Array.isArray(song.artists) && song.artists.length) {
    const names = song.artists
      .map((a) => (typeof a === "string" ? a : a?.name))
      .map((n) => (typeof n === "string" ? n.trim() : ""))
      .filter(Boolean);
    if (names.length) return names.join(", ");
  }
  return "Desconocido";
}

function pickBestThumbnail(song, videoId) {
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  if (Array.isArray(song.thumbnails) && song.thumbnails.length) {
    const sorted = [...song.thumbnails].sort(
      (a, b) => (a.width || 0) - (b.width || 0)
    );
    const pick = sorted[sorted.length - 1];
    if (pick?.url) {
      return pick.url.replace(/=w\d+-h\d+/i, "=w400-h400");
    }
  }
  if (song.thumbnail) return song.thumbnail;
  return "";
}
