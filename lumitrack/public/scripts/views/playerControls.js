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
  timeRemainingEl,
  progressTrackEl,
  progressFillEl,
  onPlayButtonClick,
  onSeek,
}) {
  let state = PlaybackState.IDLE;
  let knownDuration = 0;

  function setState(nextState) {
    state = nextState;
    playButtonEl.textContent = ICONS[state] ?? ICONS[PlaybackState.IDLE];
    playButtonEl.title = LABELS[state] ?? LABELS[PlaybackState.IDLE];
    playButtonEl.setAttribute("aria-label", playButtonEl.title);
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
    progressTrackEl.addEventListener("click", handleTrackClick);
    setState(PlaybackState.IDLE);
    resetProgress();
  }

  return { init, setState, setProgress, resetProgress };
}
