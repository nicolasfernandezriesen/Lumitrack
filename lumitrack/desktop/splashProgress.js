/**
 * Simulated load progress: eases toward a rising ceiling, then to 100% on complete.
 */
export function createSplashProgress(fillEl) {
  let display = 0;
  let ceiling = 8;
  let completed = false;
  let raf = 0;

  function paint() {
    fillEl.style.width = `${display}%`;
  }

  function frame() {
    const target = completed ? 100 : ceiling;
    const delta = target - display;
    if (Math.abs(delta) < 0.15) {
      display = target;
    } else {
      display += delta * (completed ? 0.18 : 0.06);
    }
    paint();

    if (!completed) {
      // Soft creep so the bar keeps moving between stage bumps.
      ceiling = Math.min(92, ceiling + 0.035);
    }

    if (!(completed && display >= 99.8)) {
      raf = requestAnimationFrame(frame);
    } else {
      display = 100;
      paint();
      raf = 0;
    }
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /** Raise the simulated ceiling (0–100). Monotonic. */
  function setStage(pct) {
    if (completed) return;
    ceiling = Math.max(ceiling, Math.min(92, pct));
    start();
  }

  function complete() {
    completed = true;
    ceiling = 100;
    start();
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  paint();
  return { start, setStage, complete, stop, get value() { return display; } };
}
