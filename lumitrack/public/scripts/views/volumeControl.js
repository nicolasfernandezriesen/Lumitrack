const SPEAKER_PATH = "M4 9v6h4l5 5V4L8 9H4z";

const ICONS = {
  audible: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path class="vc-body" d="${SPEAKER_PATH}" fill="#fff"/>
    <path class="vc-waves" d="M16.5 8.5a5 5 0 0 1 0 7" stroke-width="1.6"
      stroke-linecap="round" fill="none"/>
    <path class="vc-waves" d="M19 6a8.5 8.5 0 0 1 0 12" stroke-width="1.6"
      stroke-linecap="round" fill="none"/>
  </svg>`,
  muted: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path class="vc-body" d="${SPEAKER_PATH}" fill="#fff"/>
    <path class="vc-x" d="M16.5 9.5l4 5M20.5 9.5l-4 5" stroke-width="1.6"
      stroke-linecap="round"/>
  </svg>`,
};

export function createVolumeControl({
  toggleButtonEl,
  popoverEl,
  sliderEl,
  muteButtonEl,
  onVolumeChange,
  onMuteChange,
}) {
  let volume = 1;
  let muted = false;

  function updateIcons() {
    const icon = muted || volume === 0 ? ICONS.muted : ICONS.audible;
    toggleButtonEl.innerHTML = icon;
    muteButtonEl.innerHTML = icon;
    muteButtonEl.title = muted ? "Activar sonido" : "Silenciar";
    muteButtonEl.setAttribute("aria-label", muteButtonEl.title);
  }

  function setOpen(open) {
    popoverEl.hidden = !open;
    toggleButtonEl.setAttribute("aria-expanded", String(open));
  }

  function setVolume(nextVolume) {
    volume = Math.min(1, Math.max(0, nextVolume));
    sliderEl.value = String(Math.round(volume * 100));
    onVolumeChange(volume, muted);
    updateIcons();
  }

  function setMuted(nextMuted) {
    muted = nextMuted;
    onMuteChange(muted, volume);
    updateIcons();
  }

  function init() {
    toggleButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(popoverEl.hidden);
    });
    popoverEl.addEventListener("click", (event) => event.stopPropagation());
    sliderEl.addEventListener("input", () => setVolume(Number(sliderEl.value) / 100));
    muteButtonEl.addEventListener("click", () => setMuted(!muted));
    document.addEventListener("click", () => setOpen(false));
    updateIcons();
  }

  return { init, setVolume, setMuted };
}
