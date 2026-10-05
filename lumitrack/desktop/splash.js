import { createSplashBars } from "./splashBars.js";
import { createSplashProgress } from "./splashProgress.js";

const barsEl = document.getElementById("eq-bars");
const fillEl = document.getElementById("progress-fill");
const msgEl = document.getElementById("msg");

const bars = createSplashBars(barsEl);
const progress = createSplashProgress(fillEl);

function formatStatus(detail) {
  const text = (detail || "").trim();
  return text ? `Cargando… ${text}` : "Cargando…";
}

function setStatus(detail) {
  msgEl.textContent = formatStatus(detail);
}

window.__splash = {
  setStatus,
  setProgressStage: (pct) => progress.setStage(Number(pct) || 0),
  completeProgress: () => progress.complete(),
};

bars.start();
progress.start();
setStatus("iniciando");
