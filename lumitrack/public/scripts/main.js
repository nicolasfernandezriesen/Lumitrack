import { createAudioEngine, PlaybackState } from "./services/audioEngine.js";
import {
  extractDominantColor,
  complementary,
} from "./services/colorExtractor.js";
import { createPlaylistController } from "./services/playlist.js";
import { createMediaKeys } from "./services/mediaKeys.js";
import { createVisualizer } from "./views/visualizer.js";
import { createSearchPanel } from "./views/searchPanel.js";
import { createNowPlaying } from "./views/nowPlaying.js";
import { createPlaylistView } from "./views/playlistView.js";
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
  const playlistView = createPlaylistView({
    containerEl: document.getElementById("playback-dock"),
    panelEl: document.getElementById("playlist-panel"),
    listEl: document.getElementById("playlist-list"),
    toggleButtonEl: document.getElementById("cover-stack"),
    onPlayTrack: (track) => {
      void handleTrackSelected(track);
    },
    onRemove: (videoId) => playlist.removeTrack(videoId),
  });
  const coverStackEl = document.getElementById("cover-stack");
  const coverEl = document.getElementById("cover");
  const playlistListEl = document.getElementById("playlist-list");

  const visualizer = createVisualizer({
    barsWrapEl: document.getElementById("bars-wrap"),
    barCount: BAR_COUNT,
  });

  const nowPlaying = createNowPlaying({
    coverEl,
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
    progressBufferedEl: document.getElementById("progress-buffered"),
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

  const settingsPanelEl = document.getElementById("settings-panel");
  const settingsToggleBtnEl = document.getElementById("toggle-settings");
  const searchPanelEl = document.getElementById("panel");
  const searchPanel = createSearchPanel({
    panelEl: searchPanelEl,
    toggleBtnEl: document.getElementById("toggle-search"),
    inputEl: document.getElementById("search-input"),
    statusEl: document.getElementById("search-status"),
    resultsListEl: document.getElementById("results-list"),
    onOpenChange: (isOpen) => {
      if (isOpen) {
        settingsPanelEl.classList.add("hidden");
        settingsPanelEl.setAttribute("aria-hidden", "true");
        settingsToggleBtnEl.setAttribute("aria-expanded", "false");
      }
    },
    onTrackSelected: (track) => {
      void handleTrackSelected(track);
    },
    onTrackPlayNext: (track) => {
      void handleTrackPlayNext(track);
    },
  });

  settingsToggleBtnEl.addEventListener("click", () => {
    const isOpen = settingsPanelEl.classList.contains("hidden");
    searchPanel.setOpen(false);
    settingsPanelEl.classList.toggle("hidden", !isOpen);
    settingsPanelEl.setAttribute("aria-hidden", String(!isOpen));
    settingsToggleBtnEl.setAttribute("aria-expanded", String(isOpen));
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

  const mediaKeys = createMediaKeys({
    onPlay: () => handleMediaPlay(),
    onPause: () => handleMediaPause(),
    onPlayPause: () => handlePlayButtonClick(audioEngine.currentState()),
    onPreviousTrack: () => {
      void handlePrevClick();
    },
    onNextTrack: () => {
      void handleNextClick();
    },
    onStop: () => handleMediaPause(),
  });

  const audioEngine = createAudioEngine({
    barCount: BAR_COUNT,
    onError: (message) => searchPanel.setStatus(message),
    onStateChange: (state) => {
      playerControls.setState(state);
      mediaKeys.setPlaybackState(state);
      syncDocumentTitle(state);
      if (state === PlaybackState.ENDED) {
        void handleTrackEnded();
      }
    },
    onProgress: (progress) => {
      playerControls.setProgress(progress);
      mediaKeys.setPositionState({
        duration: progress.duration,
        position: progress.currentTime,
      });
    },
  });

  playlist.subscribe((snap) => {
    nowPlaying.setNeighbors({ previous: snap.previous, next: snap.next });
    playlistView.setTracks({ history: snap.history, upcoming: snap.upcoming });
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

  coverStackEl.addEventListener("click", () => {
    const isOpen = document.body.classList.contains("playlist-open");
    playlistView.setOpen(!isOpen);
  });
  coverStackEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const isOpen = document.body.classList.contains("playlist-open");
    playlistView.setOpen(!isOpen);
  });

  window.addEventListener(
    "wheel",
    (event) => {
      if (event.target instanceof Node && searchPanelEl.contains(event.target)) {
        return;
      }
      const isOpen = document.body.classList.contains("playlist-open");
      const scrolledPlaylist =
        event.target instanceof Node && playlistListEl.contains(event.target);
      if (isOpen && event.deltaY < 0 && !scrolledPlaylist) {
        playlistView.setOpen(false);
      } else if (!isOpen && event.deltaY > 0) {
        playlistView.setOpen(true);
      }
    },
    { passive: true },
  );

  let touchStartY = null;
  let touchStartTarget = null;
  window.addEventListener(
    "touchstart",
    (event) => {
      touchStartY = event.touches[0]?.clientY ?? null;
      touchStartTarget = event.target;
    },
    { passive: true },
  );
  window.addEventListener(
    "touchend",
    (event) => {
      if (touchStartY === null) return;
      const touchEndY = event.changedTouches[0]?.clientY;
      const isOpen = document.body.classList.contains("playlist-open");
      const startedInPlaylist =
        touchStartTarget instanceof Node &&
        playlistListEl.contains(touchStartTarget);
      const startedInSearchPanel =
        touchStartTarget instanceof Node &&
        searchPanelEl.contains(touchStartTarget);
      if (
        Number.isFinite(touchEndY) &&
        !startedInPlaylist &&
        !startedInSearchPanel &&
        ((isOpen && touchEndY - touchStartY > 40) ||
          (!isOpen && touchStartY - touchEndY > 40))
      ) {
        playlistView.setOpen(!isOpen);
      }
      touchStartY = null;
      touchStartTarget = null;
    },
    { passive: true },
  );

  async function playTrack(track) {
    if (!track?.videoId) return;
    currentTrackTitle = track.title?.trim() || "";
    syncDocumentTitle(PlaybackState.PLAYING);
    nowPlaying.show(track);
    mediaKeys.setMetadata({
      title: track.title || "",
      artist: track.artist || "",
      artworkUrl: track.thumbnail || "",
    });
    nowPlaying.setLoading(true);
    playerControls.resetProgress();

    try {
      await audioEngine.play(track.videoId, visualizer.setLevels);
    } catch (err) {
      console.error("No se pudo reproducir:", err);
      currentTrackTitle = "";
      mediaKeys.clear();
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

  async function handleTrackPlayNext(track) {
    const snapshot = playlist.snapshot();
    if (!snapshot.current) {
      await handleTrackSelected(track);
      return;
    }
    if (snapshot.current.videoId === track.videoId) {
      searchPanel.setStatus("Esta canción ya está sonando.");
      return;
    }

    playlist.playNext(track);
    searchPanel.setStatus(
      `“${track.title || "La canción"}” se reproducirá a continuación.`,
    );
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

  function handleMediaPlay() {
    const state = audioEngine.currentState();
    if (state === PlaybackState.PAUSED) {
      audioEngine.resume();
    } else if (state === PlaybackState.ENDED) {
      audioEngine.replay();
    }
  }

  function handleMediaPause() {
    if (audioEngine.currentState() === PlaybackState.PLAYING) {
      audioEngine.pause();
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
  mediaKeys.init();
  updaterModal.init();
}

main();
