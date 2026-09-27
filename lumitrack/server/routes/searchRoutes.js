import { Router } from "express";
import { searchTracks } from "../services/searchService.js";

const router = Router();

router.get("/search", async (req, res) => {
  const q = req.query.q;
  try {
    const results = await searchTracks(q);
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
