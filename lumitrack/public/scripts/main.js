import { createAudioEngine, PlaybackState } from "./services/audioEngine.js";
import { extractDominantColor, complementary } from "./services/colorExtractor.js";
import { createPlaylistController } from "./services/playlist.js";
import { createVisualizer } from "./views/visualizer.js";
import { createSearchPanel } from "./views/searchPanel.js";
import { createNowPlaying } from "./views/nowPlaying.js";
import { createPlayerControls } from "./views/playerControls.js";
import { createVolumeControl } from "./views/volumeControl.js";
import { createFullscreenToggle } from "./views/fullscreenToggle.js";
import { createUpdaterModal } from "./views/updaterModal.js";
import { getUpdaterApi } from "./services/updaterClient.js";

const BAR_COUNT = 100;
const APP_NAME = "Lumitrack";
const IDLE_TITLE = `${APP_NAME} — Visualizador audiorreactivo`;
// Variante de texto (U+FE0E): la nota toma el color del título, no el del emoji a color.
const MUSIC_NOTE = "\u{1F3B5}\uFE0E";
/** Umbral del botón atrás: antes reinicia o va a la anterior; después solo reinicia. */
const PREV_RESTART_SECONDS = 10;

let currentTrackTitle = "";
let autoAdvanceToken = 0;

function syncDocumentTitle(state) {
  const playing = state === PlaybackState.PLAYING && currentTrackTitle;
  document.title = playing
    ? `${APP_NAME} — ${currentTrackTitle} ${MUSIC_NOTE}`
    : IDLE_TITLE;
}

function main() {
  const playlist = createPlaylistController();

  const visualizer = createVisualizer({
    barsWrapEl: document.getElementById("bars-wrap"),
    barCount: BAR_COUNT,
  });

  const nowPlaying = createNowPlaying({
    coverEl: document.getElementById("cover"),
    coverPrevEl: document.getElementById("cover-prev"),
    coverNextEl: document.getElementById("cover-next"),
    coverStackEl: document.getElementById("cover-stack"),
    titleEl: document.getElementById("track-title"),
    artistEl: document.getElementById("track-artist"),
    loadingEl: document.getElementById("loading-indicator"),
  });

  const playerControls = createPlayerControls({
    playButtonEl: document.getElementById("play-toggle"),
    prevButtonEl: document.getElementById("prev-track"),
    nextButtonEl: document.getElementById("next-track"),
    timeRemainingEl: document.getElementById("time-remaining"),
    progressTrackEl: document.getElementById("progress-track"),
    progressFillEl: document.getElementById("progress-fill"),
    onPlayButtonClick: handlePlayButtonClick,
    onPrevClick: () => {
      void handlePrevClick();
    },
    onNextClick: () => {
      void handleNextClick();
    },
    onSeek: (seconds) => {
      void audioEngine.seek(seconds);
    },
  });

  const searchPanel = createSearchPanel({
    panelEl: document.getElementById("panel"),
    toggleBtnEl: document.getElementById("toggle-panel"),
    inputEl: document.getElementById("search-input"),
    statusEl: document.getElementById("search-status"),
    resultsListEl: document.getElementById("results-list"),
    onTrackSelected: (track) => {
      void handleTrackSelected(track);
    },
  });

  const fullscreenToggle = createFullscreenToggle({
    buttonEl: document.getElementById("fullscreen-toggle"),
  });

  const volumeControl = createVolumeControl({
    toggleButtonEl: document.getElementById("volume-toggle"),
    popoverEl: document.getElementById("volume-popover"),
    sliderEl: document.getElementById("volume-slider"),
    muteButtonEl: document.getElementById("mute-toggle"),
    onVolumeChange: (volume, muted) => audioEngine.setVolume(volume, muted),
    onMuteChange: (muted, volume) => audioEngine.setVolume(volume, muted),
  });

  const audioEngine = createAudioEngine({
    barCount: BAR_COUNT,
    onError: (message) => searchPanel.setStatus(message),
    onStateChange: (state) => {
      playerControls.setState(state);
      syncDocumentTitle(state);
      if (state === PlaybackState.ENDED) {
        void handleTrackEnded();
      }
    },
    onProgress: playerControls.setProgress,
  });

  playlist.subscribe((snap) => {
    nowPlaying.setNeighbors({ previous: snap.previous, next: snap.next });
    playerControls.setNavAvailability({
      hasCurrent: !!snap.current,
      hasPrevious: snap.hasPrevious,
      hasNext: snap.hasNext,
    });
  });

  nowPlaying.onCoverReady((imgEl) => {
    const dominant = extractDominantColor(imgEl);
    if (!dominant) return; // CORS u otro fallo: mantenemos la paleta actual
    visualizer.applyPalette(dominant, complementary(dominant));
  });

  async function playTrack(track) {
    if (!track?.videoId) return;
    currentTrackTitle = track.title?.trim() || "";
    syncDocumentTitle(PlaybackState.PLAYING);
    nowPlaying.show(track);
    nowPlaying.setLoading(true);
    playerControls.resetProgress();

    try {
      await audioEngine.play(track.videoId, visualizer.setLevels);
    } catch (err) {
      console.error("No se pudo reproducir:", err);
      currentTrackTitle = "";
      syncDocumentTitle(PlaybackState.IDLE);
      searchPanel.setStatus("No se pudo reproducir este track.");
    } finally {
      nowPlaying.setLoading(false);
    }
  }

  async function handleTrackSelected(track) {
    autoAdvanceToken += 1;
    await playlist.playFromSelection(track);
    await playTrack(track);
  }

  async function handleTrackEnded() {
    const token = ++autoAdvanceToken;
    const next = await playlist.goNext();
    if (token !== autoAdvanceToken) return;
    if (next) {
      await playTrack(next);
      return;
    }
    // Sin siguiente: se queda en ENDED (botón replay).
  }

  async function handleNextClick() {
    const snap = playlist.snapshot();
    if (!snap.current) return;
    autoAdvanceToken += 1;
    const next = await playlist.goNext();
    if (next) {
      await playTrack(next);
      return;
    }
    searchPanel.setStatus("No hay una canción siguiente todavía.");
  }

  async function handlePrevClick() {
    const snap = playlist.snapshot();
    if (!snap.current) return;

    const elapsed = audioEngine.getCurrentTime();
    const engineState = audioEngine.currentState();
    const canRestart =
      engineState === PlaybackState.PLAYING ||
      engineState === PlaybackState.PAUSED ||
      engineState === PlaybackState.ENDED;

    if (elapsed > PREV_RESTART_SECONDS && canRestart) {
      await audioEngine.replay();
      return;
    }

    if (snap.hasPrevious) {
      autoAdvanceToken += 1;
      const prev = playlist.goPrevious();
      if (prev) {
        await playTrack(prev);
        return;
      }
    }

    // Sin anterior (u otro flujo): reinicia la canción actual si hay audio.
    if (canRestart) await audioEngine.replay();
  }

  function handlePlayButtonClick(state) {
    if (state === PlaybackState.PLAYING) {
      audioEngine.pause();
    } else if (state === PlaybackState.PAUSED) {
      audioEngine.resume();
    } else if (state === PlaybackState.ENDED) {
      audioEngine.replay();
    }
  }

  const updaterModal = createUpdaterModal({
    rootEl: document.body,
    api: getUpdaterApi(),
  });

  searchPanel.init();
  playerControls.init();
  volumeControl.init();
  fullscreenToggle.init();
  updaterModal.init();
}

main();
