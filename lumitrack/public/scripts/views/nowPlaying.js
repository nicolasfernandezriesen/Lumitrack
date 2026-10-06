function coverCandidates(track) {
  const candidates = [];
  if (!track) return candidates;
  if (track.thumbnail) candidates.push(track.thumbnail);
  if (track.videoId) {
    const ytimg = `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
    if (!candidates.includes(ytimg)) candidates.push(ytimg);
  }
  return candidates;
}

function loadImageInto(imgEl, track, generation, getGeneration) {
  const candidates = coverCandidates(track);
  if (!candidates.length) {
    imgEl.removeAttribute("src");
    imgEl.hidden = true;
    return;
  }

  imgEl.hidden = false;
  tryLoad(imgEl, candidates, 0, true, generation, getGeneration);
}

function tryLoad(imgEl, candidates, index, withCors, generation, getGeneration) {
  if (generation !== getGeneration() || index >= candidates.length) {
    if (generation === getGeneration()) {
      imgEl.removeAttribute("src");
      imgEl.hidden = true;
    }
    return;
  }

  const url = candidates[index];

  imgEl.onload = () => {};
  imgEl.onerror = () => {
    if (generation !== getGeneration()) return;
    if (withCors) {
      tryLoad(imgEl, candidates, index, false, generation, getGeneration);
      return;
    }
    tryLoad(imgEl, candidates, index + 1, true, generation, getGeneration);
  };

  if (withCors) {
    imgEl.crossOrigin = "anonymous";
  } else {
    imgEl.removeAttribute("crossorigin");
  }

  imgEl.src = "";
  imgEl.src = url;
}

export function createNowPlaying({
  coverEl,
  coverPrevEl,
  coverNextEl,
  coverStackEl,
  titleEl,
  artistEl,
  loadingEl,
}) {
  let onReadyCallback = null;
  let loadGeneration = 0;
  let peekGeneration = 0;

  function show(track) {
    titleEl.textContent = track.title;
    titleEl.title = track.title || "";
    artistEl.textContent = track.artist;
    artistEl.title = track.artist || "";
    loadCover(track);
  }

  function setNeighbors({ previous = null, next = null } = {}) {
    const generation = ++peekGeneration;
    const getGeneration = () => peekGeneration;

    if (coverStackEl) {
      coverStackEl.classList.toggle("has-prev", !!previous);
      coverStackEl.classList.toggle("has-next", !!next);
    }

    if (coverPrevEl) {
      if (previous) {
        loadImageInto(coverPrevEl, previous, generation, getGeneration);
        coverPrevEl.alt = previous.title || "Anterior";
      } else {
        coverPrevEl.hidden = true;
        coverPrevEl.removeAttribute("src");
        coverPrevEl.alt = "";
      }
    }

    if (coverNextEl) {
      if (next) {
        loadImageInto(coverNextEl, next, generation, getGeneration);
        coverNextEl.alt = next.title || "Siguiente";
      } else {
        coverNextEl.hidden = true;
        coverNextEl.removeAttribute("src");
        coverNextEl.alt = "";
      }
    }
  }

  function setLoading(isLoading) {
    loadingEl.classList.toggle("active", isLoading);
  }

  // Prioriza thumbnail con CORS, luego la misma imagen sin CORS y el fallback.
  function loadCover(track) {
    const generation = ++loadGeneration;
    const candidates = coverCandidates(track);

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

  return { show, setNeighbors, setLoading, onCoverReady };
}