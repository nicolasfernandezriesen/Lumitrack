// Búsqueda auxiliar con yt-dlp, sin API key.
import { spawn } from "node:child_process";

/** Busca videos con yt-dlp y devuelve metadata para el frontend. */
export function searchTracks(query, maxResults = 12) {
  return new Promise((resolve, reject) => {
    const q = (query || "").trim();
    if (!q) {
      resolve([]);
      return;
    }

    const searchTarget = `ytsearch${Math.min(maxResults, 25)}:${q}`;

    const args = [
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      "--quiet",
      searchTarget,
    ];

    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdoutBuf = "";
    let stderrBuf = "";

    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          "No se pudo ejecutar yt-dlp. ¿Está instalado y en el PATH? " +
            err.message
        )
      );
    });

    proc.on("close", (code) => {
      if (code !== 0 && !stdoutBuf.trim()) {
        reject(
          new Error(
            "yt-dlp falló al buscar: " + stderrBuf.slice(-500)
          )
        );
        return;
      }

      const results = stdoutBuf
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .map(normalizeEntry)
        .filter((track) => track.videoId);

      resolve(results);
    });
  });
}

function normalizeEntry(entry) {
  const thumbnail = pickBestThumbnail(entry);
  return {
    videoId: entry.id || "",
    title: entry.title || "Sin título",
    artist: entry.channel || entry.uploader || "Desconocido",
    thumbnail,
    publishedAt: null, // --flat-playlist no trae fecha exacta de forma confiable
    duration: typeof entry.duration === "number" ? entry.duration : null,
  };
}

function pickBestThumbnail(entry) {
  if (Array.isArray(entry.thumbnails) && entry.thumbnails.length) {
    const sorted = [...entry.thumbnails].sort(
      (a, b) => (a.width || 0) - (b.width || 0)
    );
    const pick = sorted.reverse().find((t) => (t.width || 0) <= 640) || sorted[0];
    if (pick && pick.url) return pick.url;
  }
  if (entry.thumbnail) return entry.thumbnail;
  return entry.id
    ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`
    : "";
}
