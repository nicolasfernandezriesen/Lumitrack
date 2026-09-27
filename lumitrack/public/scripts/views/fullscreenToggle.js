// Flechas diagonales gruesas, al estilo de zoom_out_map / zoom_in_map.
// Van embebidas para no pedir el dibujo por red.
const ARROW_OUT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z"/>
</svg>`;

const ARROW_IN = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path d="M9 9V3H7v2.59L3.91 2.5 2.5 3.91 5.59 7H3v2h6zm12 0V7h-2.59l3.09-3.09-1.41-1.41L17 5.59V3h-2v6h6zM3 15v2h2.59L2.5 20.09l1.41 1.41L7 18.41V21h2v-6H3zm12 0v6h2v-2.59l3.09 3.09 1.41-1.41L18.41 17H21v-2h-6z"/>
</svg>`;

export function createFullscreenToggle({ buttonEl }) {
  function isFullscreen() {
    return document.fullscreenElement != null;
  }

  function render() {
    const active = isFullscreen();
    buttonEl.innerHTML = active ? ARROW_IN : ARROW_OUT;
    const label = active ? "Salir de pantalla completa" : "Pantalla completa";
    buttonEl.title = label;
    buttonEl.setAttribute("aria-label", label);
    buttonEl.setAttribute("aria-pressed", String(active));
  }

  // En Electron esto es el fullscreen nativo de la ventana (como F11).
  // Al salir, la ventana recupera el tamaño que tenía antes.
  async function toggle() {
    try {
      if (isFullscreen()) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (err) {
      console.error("No se pudo cambiar la pantalla completa:", err);
    }
  }

  function init() {
    buttonEl.addEventListener("click", () => {
      void toggle();
    });
    document.addEventListener("fullscreenchange", render);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "F11") return;
      event.preventDefault();
      void toggle();
    });
    render();
  }

  return { init };
}
