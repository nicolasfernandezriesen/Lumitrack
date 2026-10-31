import { onMounted, onUnmounted, shallowRef, ref } from "vue";
import { createAudioEngine, PlaybackState } from "../services/audioEngine.js";
import { createPlaylistController } from "../services/playlist.js";
import { createMediaKeys } from "../services/mediaKeys.js";
import {
  extractDominantColor,
  complementary,
} from "../services/colorExtractor.js";
import { useUiShell } from "./useUiShell.js";

const BAR_COUNT = 100;
const APP_NAME = "Lumitrack";
const IDLE_TITLE = `${APP_NAME} — Visualizador audiorreactivo`;
const MUSIC_NOTE = "\u{1F3B5}\uFE0E";
const PREV_RESTART_SECONDS = 10;

const emptySnapshot = {
  current: null,
  previous: null,
  next: null,
  history: [],
  upcoming: [],
  hasPrevious: false,
  hasNext: false,
};

/**
 * Orquestación de reproducción + playlist (paridad con el antiguo main.js).
 * @param {{ getVisualizer: () => { setLevels: Function, applyPalette: Function } | null }} options
 */
export function usePlayback({ getVisualizer }) {
  const { setPlaylistOpen, setSearchStatus } = useUiShell();

  const playlistSnap = shallowRef({ ...emptySnapshot });
  const playbackState = ref(PlaybackState.IDLE);
  const progress = shallowRef({
    currentTime: 0,
    duration: 0,
    bufferedStart: 0,
    bufferedEnd: 0,
  });
  const currentTrack = shallowRef(null);
  const loading = ref(false);

  let currentTrackTitle = "";
  let autoAdvanceToken = 0;
  let playlist = null;
  let audioEngine = null;
  let mediaKeys = null;

  function syncDocumentTitle(state) {
    const playing = state === PlaybackState.PLAYING && currentTrackTitle;
    document.title = playing
      ? `${APP_NAME} — ${currentTrackTitle} ${MUSIC_NOTE}`
      : IDLE_TITLE;
  }

  function applyCoverPalette(imgEl) {
    const visualizer = getVisualizer?.();
    if (!visualizer) return;
    const dominant = extractDominantColor(imgEl);
    if (!dominant) return;
    visualizer.applyPalette(dominant, complementary(dominant));
  }

  async function playTrack(track) {
    if (!track?.videoId || !audioEngine) return;
    const visualizer = getVisualizer?.();
    currentTrackTitle = track.title?.trim() || "";
    currentTrack.value = track;
    syncDocumentTitle(PlaybackState.PLAYING);
    mediaKeys?.setMetadata({
      title: track.title || "",
      artist: track.artist || "",
      artworkUrl: track.thumbnail || "",
    });
    loading.value = true;
    progress.value = { currentTime: 0, duration: 0, bufferedEnd: 0 };

    try {
      await audioEngine.play(track.videoId, (levels) => {
        visualizer?.setLevels?.(levels);
      });
    } catch (err) {
      console.error("No se pudo reproducir:", err);
      currentTrackTitle = "";
      mediaKeys?.clear();
      syncDocumentTitle(PlaybackState.IDLE);
      setSearchStatus("No se pudo reproducir este track.");
    } finally {
      loading.value = false;
    }
  }

  async function handleTrackSelected(track) {
    autoAdvanceToken += 1;
    await playlist.playFromSelection(track);
    await playTrack(track);
  }

  async function handlePlaylistSelected(tracks, startIndex = 0) {
    const track = tracks?.[startIndex];
    if (!track?.videoId) return;
    autoAdvanceToken += 1;
    await playlist.playPlaylist(tracks, startIndex);
    setPlaylistOpen(true);
    await playTrack(track);
  }

  async function handleTrackPlayNext(track) {
    const snapshot = playlist.snapshot();
    if (!snapshot.current) {
      await handleTrackSelected(track);
      return;
    }
    if (snapshot.current.videoId === track.videoId) {
      setSearchStatus("Esta canción ya está sonando.");
      return;
    }

    playlist.playNext(track);
    setSearchStatus(
      `“${track.title || "La canción"}” se reproducirá a continuación.`,
    );
  }

  async function handleTrackEnded() {
    const token = ++autoAdvanceToken;
    const next = await playlist.goNext();
    if (token !== autoAdvanceToken) return;
    if (next) await playTrack(next);
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
    setSearchStatus("No hay una canción siguiente todavía.");
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

    if (canRestart) await audioEngine.replay();
  }

  function handlePlayButtonClick(state = playbackState.value) {
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
    if (state === PlaybackState.PAUSED) audioEngine.resume();
    else if (state === PlaybackState.ENDED) audioEngine.replay();
  }

  function handleMediaPause() {
    if (audioEngine.currentState() === PlaybackState.PLAYING) {
      audioEngine.pause();
    }
  }

  function setVolume(volume, muted) {
    audioEngine?.setVolume(volume, muted);
  }

  function seek(seconds) {
    void audioEngine?.seek(seconds);
  }

  function removeTrack(videoId) {
    playlist?.removeTrack(videoId);
  }

  onMounted(() => {
    playlist = createPlaylistController();
    playlist.subscribe((snap) => {
      playlistSnap.value = snap;
    });

    mediaKeys = createMediaKeys({
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

    audioEngine = createAudioEngine({
      barCount: BAR_COUNT,
      onError: (message) => setSearchStatus(message),
      onStateChange: (state) => {
        playbackState.value = state;
        mediaKeys.setPlaybackState(state);
        syncDocumentTitle(state);
        if (state === PlaybackState.ENDED) void handleTrackEnded();
      },
      onProgress: (next) => {
        progress.value = next;
        mediaKeys.setPositionState({
          duration: next.duration,
          position: next.currentTime,
        });
      },
    });

    mediaKeys.init();
  });

  onUnmounted(() => {
    document.title = IDLE_TITLE;
  });

  return {
    BAR_COUNT,
    PlaybackState,
    playlistSnap,
    playbackState,
    progress,
    currentTrack,
    loading,
    handleTrackSelected,
    handlePlaylistSelected,
    handleTrackPlayNext,
    handlePlayButtonClick,
    handlePrevClick,
    handleNextClick,
    setVolume,
    seek,
    removeTrack,
    applyCoverPalette,
  };
}
