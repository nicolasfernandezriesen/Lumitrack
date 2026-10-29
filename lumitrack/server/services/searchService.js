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

/** Busca un tipo de resultado y devuelve metadata normalizada para el frontend. */
export async function searchTracks(query, maxResults = 12, filter = "song") {
  const q = (query || "").trim();
  if (!q) return [];

  const ytmusic = await getClient();
  let matches;
  switch (filter) {
    case "artist":
      matches = await ytmusic.searchArtists(q);
      break;
    case "album":
      matches = await ytmusic.searchAlbums(q);
      break;
    case "playlist":
      matches = await ytmusic.searchPlaylists(q);
      break;
    case "video":
      matches = await ytmusic.searchVideos(q);
      break;
    case "song":
      matches = await ytmusic.searchSongs(q);
      break;
    default:
      throw new Error(`Filtro de búsqueda no soportado: ${filter}`);
  }

  const seen = new Set();
  const results = [];

  for (const match of matches) {
    let result;
    let identity;
    if (filter === "artist") {
      result = normalizeArtist(match);
      identity = result.artistId;
    } else if (filter === "album") {
      result = normalizeAlbum(match);
      identity = result.albumId;
    } else if (filter === "playlist") {
      result = normalizePlaylist(match);
      identity = result.playlistId;
    } else if (filter === "video") {
      result = normalizeVideo(match);
      identity = result.videoId;
      if (!VIDEO_ID_RE.test(identity)) continue;
    } else {
      result = normalizeSong(match);
      identity = result.videoId;
      if (!VIDEO_ID_RE.test(identity)) continue;
    }

    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    results.push(result);
    if (results.length >= maxResults) break;
  }

  return results;
}

/** Devuelve una playlist completa con las pistas normalizadas para el cliente. */
export async function getPlaylistDetails(playlistId, creatorFallback = "") {
  const id = typeof playlistId === "string" ? playlistId.trim() : "";
  if (!id) throw new Error("playlistId inválido");

  const ytmusic = await getClient();
  const [playlist, playlistVideos] = await Promise.all([
    ytmusic.getPlaylist(id),
    ytmusic.getPlaylistVideos(id),
  ]);
  if (!playlist) throw new Error("No se encontró la playlist.");

  const sourceTracks = Array.isArray(playlistVideos)
    ? playlistVideos
    : Array.isArray(playlist.tracks)
      ? playlist.tracks
      : Array.isArray(playlist.songs)
        ? playlist.songs
        : [];
  const tracks = [];

  for (const [index, song] of sourceTracks.entries()) {
    const track = normalizeSong(song);
    if (!VIDEO_ID_RE.test(track.videoId)) continue;
    track.playlistEntryId = `${index}:${track.videoId}`;
    tracks.push(track);
  }
  const totalDuration = getTotalDuration(tracks);

  const playlistCreator = pickPlaylistCreator(playlist);
  return {
    type: "playlist",
    playlistId: playlist.playlistId || id,
    title: playlist.name || "Sin título",
    creator:
      playlistCreator !== "Desconocido"
        ? playlistCreator
        : (typeof creatorFallback === "string" && creatorFallback.trim()) ||
          "Desconocido",
    totalDuration,
    tracks,
  };
}

/** Devuelve los datos del álbum, sus canciones y la duración si está completa. */
export async function getAlbumDetails(albumId) {
  const id = typeof albumId === "string" ? albumId.trim() : "";
  if (!id) throw new Error("albumId inválido");

  const ytmusic = await getClient();
  const album = await ytmusic.getAlbum(id);
  if (!album) throw new Error("No se encontró el álbum.");

  const sourceTracks = Array.isArray(album.songs) ? album.songs : [];
  const tracks = sourceTracks
    .map(normalizeSong)
    .filter((track) => VIDEO_ID_RE.test(track.videoId));
  const hasCompleteDuration =
    sourceTracks.length > 0 &&
    sourceTracks.every(
      (song) => Number.isFinite(song.duration) && song.duration >= 0,
    );

  return {
    type: "album",
    albumId: album.albumId || id,
    title: album.name || "Sin título",
    creator: pickArtist(album),
    year: album.year || null,
    totalDuration: hasCompleteDuration
      ? sourceTracks.reduce((total, song) => total + song.duration, 0)
      : null,
    tracks,
  };
}

/** Devuelve el perfil del artista y sus canciones más populares. */
export async function getArtistDetails(artistId) {
  const id = typeof artistId === "string" ? artistId.trim() : "";
  if (!id) throw new Error("artistId inválido");

  const ytmusic = await getClient();
  const artist = await ytmusic.getArtist(id);
  if (!artist) throw new Error("No se encontró el artista.");

  const popularSongs = Array.isArray(artist.topSongs) ? artist.topSongs : [];
  const sourceTracks = popularSongs.length
    ? popularSongs
    : await ytmusic.getArtistSongs(id);
  const tracks = sourceTracks
    .map((song) => ({
      ...normalizeSong(song),
      album: song.album?.name || "",
    }))
    .filter((track) => VIDEO_ID_RE.test(track.videoId))
    .slice(0, 10);

  return {
    type: "artist",
    artistId: artist.artistId || id,
    title: artist.name || "Sin nombre",
    thumbnail: pickBestThumbnail(artist),
    thumbnailCandidates: pickThumbnailCandidates(artist),
    tracks,
  };
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
    type: "song",
    videoId,
    title: song.name || "Sin título",
    artist: pickArtist(song),
    thumbnail: pickBestThumbnail(song, videoId),
    publishedAt: null,
    duration: typeof song.duration === "number" ? song.duration : null,
  };
}

function getTotalDuration(tracks) {
  if (
    !tracks.length ||
    tracks.some(
      (track) => !Number.isFinite(track.duration) || track.duration < 0,
    )
  ) {
    return null;
  }
  return tracks.reduce((total, track) => total + track.duration, 0);
}

function normalizeVideo(video) {
  const videoId = video.videoId || "";
  return {
    type: "video",
    videoId,
    title: video.name || "Sin título",
    artist: pickArtist(video),
    thumbnail: pickBestThumbnail(video, videoId),
    publishedAt: null,
    duration: typeof video.duration === "number" ? video.duration : null,
  };
}

function normalizeArtist(artist) {
  return {
    type: "artist",
    artistId: artist.artistId || "",
    title: artist.name || "Sin nombre",
    subtitle: "Artista",
    thumbnail: pickBestThumbnail(artist),
  };
}

function normalizeAlbum(album) {
  const artist = pickArtist(album);
  const details = [artist, album.year].filter(Boolean).join(" • ");
  return {
    type: "album",
    albumId: album.albumId || "",
    playlistId: album.playlistId || "",
    title: album.name || "Sin título",
    artist,
    year: album.year || null,
    subtitle: details || "Álbum",
    thumbnail: pickBestThumbnail(album),
  };
}

function normalizePlaylist(playlist) {
  const creator = pickPlaylistCreator(playlist);
  return {
    type: "playlist",
    playlistId: playlist.playlistId || "",
    title: playlist.name || "Sin título",
    creator,
    subtitle: creator === "Desconocido" ? "Playlist" : `Playlist • ${creator}`,
    thumbnail: pickBestThumbnail(playlist),
    thumbnailCandidates: pickThumbnailCandidates(playlist),
  };
}

function pickPlaylistCreator(playlist) {
  const artist = pickArtist(playlist);
  if (artist !== "Desconocido") return artist;

  for (const candidate of [playlist.author, playlist.owner]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate?.name === "string" && candidate.name.trim()) {
      return candidate.name.trim();
    }
  }
  return "Desconocido";
}

function normalizeUpNext(item) {
  const videoId = item?.videoId || "";
  const artist =
    typeof item?.artists === "string"
      ? item.artists
      : item?.artists?.name || pickArtist(item);

  let duration = null;
  if (typeof item?.duration === "number") {
    duration = item.duration;
  } else if (typeof item?.duration === "string" && /^\d+:\d+/.test(item.duration)) {
    const parts = item.duration.split(":").map(Number);
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      duration = parts[0] * 60 + parts[1];
    } else if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  const thumb =
    typeof item?.thumbnail === "string" && item.thumbnail.startsWith("http")
      ? item.thumbnail
      : pickBestThumbnail(item, videoId);

  return {
    videoId,
    title: item?.title || item?.name || "Sin título",
    artist: (artist || "Desconocido").toString(),
    thumbnail: thumb,
    publishedAt: null,
    duration,
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

function pickBestThumbnail(song, videoId = "") {
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  const candidates = pickThumbnailCandidates(song);
  if (candidates.length) return candidates[0];
  if (song.thumbnail) return normalizeImageUrl(song.thumbnail);
  return "";
}

function pickThumbnailCandidates(song) {
  if (Array.isArray(song.thumbnails) && song.thumbnails.length) {
    const sorted = [...song.thumbnails].sort(
      (a, b) => (a.width || 0) - (b.width || 0)
    );
    return [...new Set(sorted.reverse().map((thumbnail) => normalizeImageUrl(thumbnail?.url)).filter(Boolean))];
  }
  const thumbnail = normalizeImageUrl(song.thumbnail);
  return thumbnail ? [thumbnail] : [];
}

function normalizeImageUrl(url) {
  if (typeof url !== "string" || !url.trim()) return "";
  const value = url.trim();
  if (value.startsWith("//")) return `https:${value}`;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}
