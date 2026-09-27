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
