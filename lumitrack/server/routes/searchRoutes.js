import { Router } from "express";
import { prefetch } from "../services/directUrlService.js";
import { getRelatedTracks, searchTracks } from "../services/searchService.js";

const router = Router();

router.get("/search", async (req, res) => {
  const q = req.query.q;
  try {
    const results = await searchTracks(q);
    res.json({ results });
    if (results.length) prefetch(results.map((track) => track.videoId));
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
      limit: 12,
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
