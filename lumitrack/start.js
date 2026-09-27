import { spawn } from "node:child_process";
import { runSetup } from "./setup.js";

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? "start"
      : platform === "darwin"
      ? "open"
      : "xdg-open";

  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
  } else {
    spawn(cmd, [url], { stdio: "ignore", detached: true });
  }
}

async function main() {
  console.log("========================================");
  console.log("  Lumitrack");
  console.log("========================================\n");

  try {
    await runSetup();
  } catch (err) {
    console.error("\nNo se pudo completar la configuración inicial:");
    console.error(err.message);
    console.error(
      "\nRevisá tu conexión a internet o instalá yt-dlp/ffmpeg manualmente (ver README)."
    );
    await waitForKeypress();
    process.exit(1);
  }

  const { startServer } = await import("./server/index.js");
  const { url } = await startServer();

  console.log(`Abriendo ${url} en el navegador…`);
  openBrowser(url);
}

function waitForKeypress() {
  return new Promise((resolve) => {
    console.log("\nPresioná una tecla para cerrar…");
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

main();
