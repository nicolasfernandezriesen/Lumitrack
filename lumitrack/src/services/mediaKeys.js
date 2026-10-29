import { PlaybackState } from "./audioEngine.js";

const MEDIA_KEY_CODES = new Set([
  "MediaPlayPause",
  "MediaPlay",
  "MediaPause",
  "MediaStop",
  "MediaTrackNext",
  "MediaTrackPrevious",
]);

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Enlaza teclas multimedia del teclado (play/pause/siguiente/anterior)
 * vía Media Session API y, como respaldo, eventos keydown.
 */
export function createMediaKeys({
  onPlay,
  onPause,
  onPlayPause,
  onPreviousTrack,
  onNextTrack,
  onStop,
}) {
  const hasMediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator;

  function setActionHandler(action, handler) {
    if (!hasMediaSession) return;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Algunas acciones no están disponibles en todos los entornos.
    }
  }

  function handleKeyDown(event) {
    if (!MEDIA_KEY_CODES.has(event.code) && !MEDIA_KEY_CODES.has(event.key)) return;
    if (isEditableTarget(event.target)) return;

    event.preventDefault();

    const code = MEDIA_KEY_CODES.has(event.code) ? event.code : event.key;
    switch (code) {
      case "MediaPlayPause":
        onPlayPause?.();
        break;
      case "MediaPlay":
        onPlay?.();
        break;
      case "MediaPause":
        onPause?.();
        break;
      case "MediaStop":
        onStop?.();
        break;
      case "MediaTrackNext":
        onNextTrack?.();
        break;
      case "MediaTrackPrevious":
        onPreviousTrack?.();
        break;
      default:
        break;
    }
  }

  function setMetadata({ title = "", artist = "", artworkUrl = "" } = {}) {
    if (!hasMediaSession || typeof MediaMetadata === "undefined") return;

    const artwork = artworkUrl
      ? [{ src: artworkUrl, sizes: "512x512", type: "image/jpeg" }]
      : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || "Lumitrack",
      artist: artist || "",
      album: "Lumitrack",
      artwork,
    });
  }

  function setPlaybackState(state) {
    if (!hasMediaSession) return;

    if (state === PlaybackState.PLAYING) {
      navigator.mediaSession.playbackState = "playing";
    } else if (state === PlaybackState.PAUSED || state === PlaybackState.ENDED) {
      navigator.mediaSession.playbackState = "paused";
    } else {
      navigator.mediaSession.playbackState = "none";
    }
  }

  function setPositionState({ duration, position, playbackRate = 1 } = {}) {
    if (!hasMediaSession || typeof navigator.mediaSession.setPositionState !== "function") {
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position: Math.min(Math.max(0, position || 0), duration),
      });
    } catch {
      // Ignorar si el navegador rechaza el estado (duración aún no lista, etc.).
    }
  }

  function clear() {
    if (!hasMediaSession) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    try {
      navigator.mediaSession.setPositionState?.(null);
    } catch {
      // Algunos entornos no aceptan null; no es crítico.
    }
  }

  function init() {
    setActionHandler("play", () => onPlay?.());
    setActionHandler("pause", () => onPause?.());
    setActionHandler("stop", () => onStop?.());
    setActionHandler("previoustrack", () => onPreviousTrack?.());
    setActionHandler("nexttrack", () => onNextTrack?.());

    window.addEventListener("keydown", handleKeyDown);
  }

  return { init, setMetadata, setPlaybackState, setPositionState, clear };
}
