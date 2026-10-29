export function createVisualizer({ barsWrapEl, barCount }) {
  const bars = [];
  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement("div");
    bar.className = "bar";
    barsWrapEl.appendChild(bar);
    bars.push(bar);
  }

  function setLevels(levels) {
    for (let i = 0; i < bars.length; i++) {
      bars[i].style.height = levels[i] + "%";
    }
  }

  // Actualiza las variables CSS del glow y el gradiente de las barras.
  function applyPalette(dominant, accent2) {
    document.documentElement.style.setProperty(
      "--glow",
      `${dominant.r}, ${dominant.g}, ${dominant.b}`
    );
    document.documentElement.style.setProperty(
      "--accent",
      `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`
    );
    document.documentElement.style.setProperty(
      "--accent-2",
      `rgb(${accent2.r}, ${accent2.g}, ${accent2.b})`
    );
  }

  return { setLevels, applyPalette };
}
