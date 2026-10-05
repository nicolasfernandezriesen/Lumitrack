const BAR_COUNT = 5;
const MIN_HEIGHT = 6;
const MAX_HEIGHT = 100;
const UP_MS = 420;
const DOWN_MS = 560;

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function pickBarId(excludeId) {
  if (BAR_COUNT <= 1) return 0;
  let id = Math.floor(Math.random() * BAR_COUNT);
  while (id === excludeId) {
    id = Math.floor(Math.random() * BAR_COUNT);
  }
  return id;
}

function tween(from, to, durationMs, onUpdate) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      onUpdate(from + (to - from) * easeInOut(t));
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/**
 * One-at-a-time equalizer bars: rise from the floor, then fall.
 * When ~25% of the descent remains, the next bar starts.
 */
export function createSplashBars(container) {
  const bars = [];
  for (let id = 0; id < BAR_COUNT; id++) {
    const el = document.createElement("div");
    el.className = "eq-bar";
    el.dataset.barId = String(id);
    el.style.height = `${MIN_HEIGHT}%`;
    container.appendChild(el);
    bars.push(el);
  }

  let running = false;
  let activeId = -1;

  function setHeight(id, pct) {
    bars[id].style.height = `${pct}%`;
  }

  async function runCycle(id) {
    if (!running) return;
    activeId = id;
    setHeight(id, MIN_HEIGHT);
    await tween(MIN_HEIGHT, MAX_HEIGHT, UP_MS, (h) => setHeight(id, h));
    if (!running) return;

    let handedOff = false;
    const range = MAX_HEIGHT - MIN_HEIGHT;
    await tween(MAX_HEIGHT, MIN_HEIGHT, DOWN_MS, (h) => {
      setHeight(id, h);
      const remaining = (h - MIN_HEIGHT) / range;
      if (!handedOff && remaining <= 0.25) {
        handedOff = true;
        const next = pickBarId(id);
        void runCycle(next);
      }
    });
  }

  function start() {
    if (running) return;
    running = true;
    void runCycle(pickBarId(-1));
  }

  function stop() {
    running = false;
  }

  return { start, stop, barCount: BAR_COUNT };
}
