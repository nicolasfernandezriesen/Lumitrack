import { Router } from "express";
import { streamAudio, isCached, waitUntilCached } from "../services/streamService.js";

const router = Router();

router.get("/stream/:videoId", (req, res) => {
  streamAudio(req.params.videoId, req, res);
});

router.get("/cached/:videoId", (req, res) => {
  res.json({ cached: isCached(req.params.videoId) });
});

router.get("/cached/:videoId/wait", async (req, res) => {
  const cached = await waitUntilCached(req.params.videoId);
  res.json({ cached });
});

export default router;
