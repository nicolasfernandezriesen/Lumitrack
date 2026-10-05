import { createAudioEngine, PlaybackState } from "./services/audioEngine.js";
import { extractDominantColor, complementary } from "./services/colorExtractor.js";
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

let currentTrackTitle = "";

function syncDocumentTitle(state) {
  const playing = state === PlaybackState.PLAYING && currentTrackTitle;
  document.title = playing
    ? `${APP_NAME} — ${currentTrackTitle} ${MUSIC_NOTE}`
    : IDLE_TITLE;
}

function main() {
  const visualizer = createVisualizer({
    barsWrapEl: document.getElementById("bars-wrap"),
    barCount: BAR_COUNT,
  });

  const nowPlaying = createNowPlaying({
    coverEl: document.getElementById("cover"),
    titleEl: document.getElementById("track-title"),
    artistEl: document.getElementById("track-artist"),
    loadingEl: document.getElementById("loading-indicator"),
  });

  const playerControls = createPlayerControls({
    playButtonEl: document.getElementById("play-toggle"),
    timeRemainingEl: document.getElementById("time-remaining"),
    progressTrackEl: document.getElementById("progress-track"),
    progressFillEl: document.getElementById("progress-fill"),
    onPlayButtonClick: handlePlayButtonClick,
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
    onTrackSelected: playTrack,
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
    },
    onProgress: playerControls.setProgress,
  });

  nowPlaying.onCoverReady((imgEl) => {
    const dominant = extractDominantColor(imgEl);
    if (!dominant) return; // CORS u otro fallo: mantenemos la paleta actual
    visualizer.applyPalette(dominant, complementary(dominant));
  });

  async function playTrack(track) {
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
