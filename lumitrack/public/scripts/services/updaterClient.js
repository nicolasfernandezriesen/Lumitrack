/**
 * Thin adapter around window.lumitrackUpdater (Electron preload bridge).
 * Optional browser mock: append ?mockUpdate=1 to exercise the UI without Electron.
 */

function createBrowserMockApi() {
  let state = {
    status: "available",
    version: "0.4.0",
    currentVersion: "0.3.0",
    progress: null,
    error: null,
    releaseNotes: null,
    highlights: [
      {
        title: "Modal de actualización",
        body: "Aviso de nueva versión con highlights, opción de actualizar ahora o más tarde.",
      },
      {
        title: "Descarga en segundo plano",
        body: "Tras confirmar, la actualización se descarga sin interrumpir el uso.",
      },
      {
        title: "Modal de instalación",
        body: "Countdown de 5 segundos y botón para cerrar e instalar de inmediato.",
      },
      {
        title: "Splash",
        body: "Animación de barras + barra de progreso; se quita la espera forzada de prueba.",
      },
      {
        title: "Versión",
        body: "0.3.0 en empaquetado y etiqueta beta de la UI.",
      },
    ],
    changelogUrl: "https://github.com/nicolasfernandezriesen/Lumitrack/releases",
    shouldShowUpdateModal: true,
    shouldShowInstallModal: false,
  };

  /** @type {Set<(s: typeof state) => void>} */
  const listeners = new Set();
  const emit = () => {
    const snapshot = {
      ...state,
      highlights: state.highlights.map((h) => ({ ...h })),
    };
    for (const fn of listeners) fn(snapshot);
  };

  return {
    getState: async () => ({ ...state, highlights: state.highlights.map((h) => ({ ...h })) }),
    check: async () => state,
    dismiss: async () => {
      state = { ...state, shouldShowUpdateModal: false };
      emit();
      return state;
    },
    download: async () => {
      state = {
        ...state,
        status: "downloading",
        progress: 0,
        shouldShowUpdateModal: false,
      };
      emit();
      await new Promise((r) => setTimeout(r, 800));
      state = {
        ...state,
        status: "downloaded",
        progress: 100,
        shouldShowInstallModal: true,
      };
      emit();
      return state;
    },
    install: async () => {
      state = { ...state, shouldShowInstallModal: false };
      emit();
      window.alert("Mock install: la app se cerraría aquí.");
      return state;
    },
    openChangelog: async () => {
      window.open(state.changelogUrl, "_blank", "noopener,noreferrer");
      return true;
    },
    onStatus: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
}

export function getUpdaterApi() {
  const bridge = typeof window !== "undefined" ? window.lumitrackUpdater : null;
  if (bridge) {
    return {
      getState: () => bridge.getState(),
      check: () => bridge.check(),
      dismiss: () => bridge.dismiss(),
      download: () => bridge.download(),
      install: () => bridge.install(),
      openChangelog: () => bridge.openChangelog?.() ?? Promise.resolve(false),
      onStatus: (handler) => bridge.onStatus(handler),
    };
  }

  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mockUpdate") === "1") return createBrowserMockApi();
  }

  return null;
}
