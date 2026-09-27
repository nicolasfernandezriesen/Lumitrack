import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import searchRoutes from "./routes/searchRoutes.js";
import streamRoutes from "./routes/streamRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";

const app = express();

app.use(express.static(publicDir()));
app.use("/api", searchRoutes);
app.use("/api", streamRoutes);

/** Carpeta public, también si electron-builder la desempaqueta fuera del asar. */
function publicDir() {
  const bundled = path.join(__dirname, "..", "public");
  const marker = `app.asar${path.sep}`;
  const unpacked = bundled.includes(marker)
    ? bundled.replace(marker, `app.asar.unpacked${path.sep}`)
    : bundled;
  if (unpacked !== bundled && existsSync(unpacked)) return unpacked;
  return bundled;
}

/**
 * Escucha solo en loopback. Sin `port` usa PORT o 3000; con 0 elige un puerto libre.
 * @returns {Promise<{ server: import("node:http").Server, url: string, port: number }>}
 */
export function startServer({ port } = {}) {
  const chosen = port ?? (process.env.PORT ? Number(process.env.PORT) : 3000);

  return new Promise((resolve, reject) => {
    const server = app.listen(chosen, HOST, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : chosen;
      const url = `http://${HOST}:${actual}`;
      console.log(`\n  Lumitrack corriendo en ${url}\n`);
      resolve({ server, url, port: actual });
    });
    server.on("error", reject);
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  startServer().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
