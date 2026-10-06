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
  progressFillEl,
  onPlayButtonClick,
  onPrevClick,
  onNextClick,
  onSeek,
}) {
  let state = PlaybackState.IDLE;
  let knownDuration = 0;
  let canGoPrev = false;
  let canGoNext = false;

  function setState(nextState) {
    state = nextState;
    playButtonEl.textContent = ICONS[state] ?? ICONS[PlaybackState.IDLE];
    playButtonEl.title = LABELS[state] ?? LABELS[PlaybackState.IDLE];
    playButtonEl.setAttribute("aria-label", playButtonEl.title);
    syncNavButtons();
  }

  function setNavAvailability({ hasPrevious = false, hasNext = false } = {}) {
    canGoPrev = !!hasPrevious;
    canGoNext = !!hasNext;
    syncNavButtons();
  }

  function syncNavButtons() {
    const hasTrack = state !== PlaybackState.IDLE;
    // Atrás siempre útil con pista cargada (reinicia o va a anterior).
    if (prevButtonEl) {
      prevButtonEl.disabled = !hasTrack;
    }
    if (nextButtonEl) {
      nextButtonEl.disabled = !hasTrack || !canGoNext;
    }
    void canGoPrev;
  }

  function setProgress({ currentTime, duration }) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    knownDuration = duration;

    const remaining = Math.max(0, duration - currentTime);
    timeRemainingEl.textContent = "-" + formatTime(remaining);

    const pct = Math.min(100, Math.max(0, (currentTime / duration) * 100));
    progressFillEl.style.width = pct + "%";
  }

  function resetProgress() {
    knownDuration = 0;
    timeRemainingEl.textContent = "-0:00";
    progressFillEl.style.width = "0%";
  }

  function formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, "0");
    const m = Math.floor(totalSeconds / 60);
    return `${m}:${s}`;
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
    progressTrackEl.addEventListener("click", handleTrackClick);
    setState(PlaybackState.IDLE);
    resetProgress();
    syncNavButtons();
  }

  return { init, setState, setProgress, resetProgress, setNavAvailability };
}