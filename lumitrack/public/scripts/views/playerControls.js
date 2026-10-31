import { PlaybackState } from "../services/audioEngine.js";

const ICONS = {
  [PlaybackState.PLAYING]: "⏸",
  [PlaybackState.PAUSED]: "▶",
  [PlaybackState.ENDED]: "↻",
  [PlaybackState.IDLE]: "▶",
};

const LABELS = {
  [PlaybackState.PLAYING]: "Pausar",
  [PlaybackState.PAUSED]: "Reproducir",
  [PlaybackState.ENDED]: "Repetir",
  [PlaybackState.IDLE]: "Reproducir",
};

export function createPlayerControls({
  playButtonEl,
  prevButtonEl,
  nextButtonEl,
  timeRemainingEl,
  progressTrackEl,
  progressBufferedEl,
  progressFillEl,
  onPlayButtonClick,
  onPrevClick,
  onNextClick,
  onSeek,
}) {
  let state = PlaybackState.IDLE;
  let knownDuration = 0;
  let currentTime = 0;
  let isRemainingMode = false;
  let hasCurrentTrack = false;
  let canGoPrev = false;
  let canGoNext = false;

  function setState(nextState) {
    state = nextState;
    playButtonEl.textContent = ICONS[state] ?? ICONS[PlaybackState.IDLE];
    playButtonEl.title = LABELS[state] ?? LABELS[PlaybackState.IDLE];
    playButtonEl.setAttribute("aria-label", playButtonEl.title);
    syncNavButtons();
  }

  function setNavAvailability({
    hasCurrent = false,
    hasPrevious = false,
    hasNext = false,
  } = {}) {
    hasCurrentTrack = !!hasCurrent;
    canGoPrev = !!hasPrevious;
    canGoNext = !!hasNext;
    syncNavButtons();
  }

  function syncNavButtons() {
    // La navegación depende de la playlist, no de si el audio ya arrancó.
    if (prevButtonEl) {
      prevButtonEl.disabled = !hasCurrentTrack;
    }
    if (nextButtonEl) {
      nextButtonEl.disabled = !hasCurrentTrack || !canGoNext;
    }
    void canGoPrev;
  }

  function setProgress({ currentTime: playbackTime, duration, bufferedEnd }) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    knownDuration = duration;
    currentTime = playbackTime;
    updateTimeDisplay(currentTime);

    const pct = Math.min(100, Math.max(0, (playbackTime / duration) * 100));
    const bufferedPct = Math.min(100, Math.max(0, (bufferedEnd / duration) * 100));
    progressBufferedEl.style.width = bufferedPct + "%";
    progressFillEl.style.width = pct + "%";
  }

  function resetProgress() {
    knownDuration = 0;
    currentTime = 0;
    updateTimeDisplay(0);
    progressBufferedEl.style.width = "0%";
    progressFillEl.style.width = "0%";
  }

  function formatTime(totalSeconds, useHours = false) {
    const s = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    if (useHours) return `${Math.floor(totalSeconds / 3600)}:${m}:${s}`;
    return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${s}`;
  }

  function updateTimeDisplay(currentTime) {
    const useHours = knownDuration >= 3600;
    const safeCurrentTime = Math.min(knownDuration, Math.max(0, currentTime));
    const value = isRemainingMode
      ? `-${formatTime(knownDuration - safeCurrentTime, useHours)}`
      : formatTime(safeCurrentTime, useHours);
    timeRemainingEl.textContent = `${formatTime(knownDuration, useHours)}/${value}`;
    timeRemainingEl.setAttribute(
      "aria-label",
      isRemainingMode ? "Mostrar tiempo transcurrido" : "Mostrar tiempo restante",
    );
    timeRemainingEl.title = isRemainingMode
      ? "Mostrar tiempo transcurrido"
      : "Mostrar tiempo restante";
    timeRemainingEl.setAttribute("aria-pressed", String(isRemainingMode));
  }

  function toggleTimeMode() {
    isRemainingMode = !isRemainingMode;
    updateTimeDisplay(currentTime);
  }

  function handleTrackClick(event) {
    if (knownDuration <= 0) return; // sin canción cargada, nada que buscar
    const rect = progressTrackEl.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(fraction * knownDuration);
  }

  function init() {
    playButtonEl.addEventListener("click", () => onPlayButtonClick(state));
    prevButtonEl?.addEventListener("click", () => onPrevClick?.());
    nextButtonEl?.addEventListener("click", () => onNextClick?.());
    timeRemainingEl.addEventListener("click", toggleTimeMode);
    progressTrackEl.addEventListener("click", handleTrackClick);
    setState(PlaybackState.IDLE);
    resetProgress();
    syncNavButtons();
  }

  return { init, setState, setProgress, resetProgress, setNavAvailability };
}