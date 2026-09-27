export function createNowPlaying({ coverEl, titleEl, artistEl, loadingEl }) {
  let onReadyCallback = null;
  let loadGeneration = 0;

  function show(track) {
    titleEl.textContent = track.title;
    titleEl.title = track.title || "";
    artistEl.textContent = track.artist;
    artistEl.title = track.artist || "";
    loadCover(track);
  }

  function setLoading(isLoading) {
    loadingEl.classList.toggle("active", isLoading);
  }

  // Prioriza thumbnail con CORS, luego la misma imagen sin CORS y el fallback.
  function loadCover(track) {
    const generation = ++loadGeneration;
    const candidates = [];

    if (track.thumbnail) candidates.push(track.thumbnail);
    if (track.videoId) {
      const ytimg = `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
      if (!candidates.includes(ytimg)) candidates.push(ytimg);
    }

    if (!candidates.length) {
      coverEl.removeAttribute("src");
      return;
    }

    tryLoadCandidate(candidates, 0, true, generation);
  }

  function tryLoadCandidate(candidates, index, withCors, generation) {
    if (generation !== loadGeneration || index >= candidates.length) return;

    const url = candidates[index];

    coverEl.onload = () => {
      if (generation !== loadGeneration) return;
      if (onReadyCallback) onReadyCallback(coverEl);
    };

    coverEl.onerror = () => {
      if (generation !== loadGeneration) return;
      if (withCors) {
        tryLoadCandidate(candidates, index, false, generation);
        return;
      }
      tryLoadCandidate(candidates, index + 1, true, generation);
    };

    if (withCors) {
      coverEl.crossOrigin = "anonymous";
    } else {
      coverEl.removeAttribute("crossorigin");
    }

    coverEl.src = "";
    coverEl.src = url;
  }

  /** Registra el callback que corre cuando la portada está lista (extracción de color). */
  function onCoverReady(callback) {
    onReadyCallback = callback;
  }

  return { show, setLoading, onCoverReady };
}
