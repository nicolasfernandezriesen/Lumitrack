import { Router } from "express";
import { streamAudio, isCached, waitUntilCached, setPlaylistWindow } from "../services/streamService.js";

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

/**
 * Declara la ventana de playlist al servidor:
 * - URLs: hasta 3 atrás + 3 adelante (+ actual)
 * - Audio: historial + actual + prefetch de la siguiente
 */
router.post("/playlist/window", (req, res) => {
  const body = req.body || {};
  const current = typeof body.current === "string" ? body.current : null;
  const history = Array.isArray(body.history) ? body.history.filter((id) => typeof id === "string") : [];
  const upcoming = Array.isArray(body.upcoming) ? body.upcoming.filter((id) => typeof id === "string") : [];
  setPlaylistWindow({ current, history, upcoming });
  res.json({ ok: true });
});

export default router;
