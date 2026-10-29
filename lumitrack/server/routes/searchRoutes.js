import { Router } from "express";
import { prefetch } from "../services/directUrlService.js";
import {
  getAlbumDetails,
  getArtistDetails,
  getPlaylistDetails,
  getRelatedTracks,
  searchTracks,
} from "../services/searchService.js";

const router = Router();
const SEARCH_FILTERS = new Set(["song", "artist", "album", "playlist", "video"]);

router.get("/search", async (req, res) => {
  const q = req.query.q;
  const filter = req.query.filter || "song";
  if (typeof filter !== "string" || !SEARCH_FILTERS.has(filter)) {
    res.status(400).json({ error: "Filtro de búsqueda inválido." });
    return;
  }
  if (typeof q !== "string" && q !== undefined) {
    res.status(400).json({ error: "La búsqueda debe ser un texto." });
    return;
  }

  try {
    const results = await searchTracks(q, 12, filter);
    res.json({ results });
    const videoIds = results
      .filter((result) => result.type === "song" || result.type === "video")
      .map((track) => track.videoId);
    if (videoIds.length) prefetch(videoIds);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/playlist/:playlistId", async (req, res) => {
  try {
    const creator =
      typeof req.query.creator === "string" ? req.query.creator : "";
    const playlist = await getPlaylistDetails(req.params.playlistId, creator);
    res.json({ playlist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/album/:albumId", async (req, res) => {
  try {
    const album = await getAlbumDetails(req.params.albumId);
    res.json({ album });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/artist/:artistId", async (req, res) => {
  try {
    const artist = await getArtistDetails(req.params.artistId);
    res.json({ artist });
    if (artist.tracks.length) {
      prefetch(artist.tracks.map((track) => track.videoId));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/** Canciones similares para alimentar la playlist (radio / up-next). */
router.get("/related/:videoId", async (req, res) => {
  try {
    const exclude = String(req.query.exclude || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const results = await getRelatedTracks(req.params.videoId, {
      limit: 20,
      excludeIds: exclude,
    });
    res.json({ results });
    if (results.length) prefetch(results.map((track) => track.videoId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
