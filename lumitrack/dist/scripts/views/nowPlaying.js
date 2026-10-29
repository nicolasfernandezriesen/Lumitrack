/** Hosts donde una carga con CORS ya funcionó (evita reintentos innecesarios). */
const corsOkHosts = new Set();
/** Hosts donde CORS falló: ir directo sin crossOrigin. */
const corsBadHosts = new Set();

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

function hostOf(url) {
  try {
    return new URL(url, location.href).host;
  } catch {
    return "";
  }
}

function preferredCors(url) {
  const host = hostOf(url);
  if (host && corsBadHosts.has(host)) return false;
  if (host && corsOkHosts.has(host)) return true;
  return true;
}

function rememberCors(url, ok) {
  const host = hostOf(url);
  if (!host) return;
  if (ok) {
    corsOkHosts.add(host);
    corsBadHosts.delete(host);
  } else {
    corsBadHosts.add(host);
    corsOkHosts.delete(host);
  }
}

function assignSrc(imgEl, url, withCors) {
  if (withCors) {
    imgEl.crossOrigin = "anonymous";
  } else {
    imgEl.removeAttribute("crossorigin");
  }

  // Evita resetear src si la URL y el modo CORS ya coinciden.
  const sameUrl = imgEl.getAttribute("src") === url;
  const hasCors = imgEl.crossOrigin === "anonymous";
  if (sameUrl && hasCors === withCors && imgEl.complete && imgEl.naturalWidth > 0) {
    return false;
  }

  if (!sameUrl) {
    imgEl.src = url;
  } else if (hasCors !== withCors) {
    imgEl.src = "";
    imgEl.src = url;
  }
  return true;
}

function loadImageInto(imgEl, track, generation, getGeneration) {
  const candidates = coverCandidates(track);
  if (!candidates.length) {
    imgEl.removeAttribute("src");
    imgEl.hidden = true;
    return;
  }

  imgEl.hidden = false;
  const firstCors = preferredCors(candidates[0]);
  tryLoad(imgEl, candidates, 0, firstCors, generation, getGeneration);
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

  imgEl.onload = () => {
    if (generation !== getGeneration()) return;
    if (withCors) rememberCors(url, true);
  };
  imgEl.onerror = () => {
    if (generation !== getGeneration()) return;
    if (withCors) {
      rememberCors(url, false);
      tryLoad(imgEl, candidates, index, false, generation, getGeneration);
      return;
    }
    tryLoad(imgEl, candidates, index + 1, preferredCors(candidates[index + 1] || ""), generation, getGeneration);
  };

  assignSrc(imgEl, url, withCors);
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
  let lastPrevId = null;
  let lastNextId = null;

  function show(track) {
    titleEl.textContent = track.title;
    titleEl.title = track.title || "";
    artistEl.textContent = track.artist;
    artistEl.title = track.artist || "";
    loadCover(track);
  }

  function setNeighbors({ previous = null, next = null } = {}) {
    const prevId = previous?.videoId || null;
    const nextId = next?.videoId || null;
    if (prevId === lastPrevId && nextId === lastNextId) return;
    lastPrevId = prevId;
    lastNextId = nextId;

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

    tryLoadCandidate(candidates, 0, preferredCors(candidates[0]), generation);
  }

  function tryLoadCandidate(candidates, index, withCors, generation) {
    if (generation !== loadGeneration || index >= candidates.length) return;

    const url = candidates[index];

    coverEl.onload = () => {
      if (generation !== loadGeneration) return;
      if (withCors) rememberCors(url, true);
      if (onReadyCallback) onReadyCallback(coverEl);
    };

    coverEl.onerror = () => {
      if (generation !== loadGeneration) return;
      if (withCors) {
        rememberCors(url, false);
        tryLoadCandidate(candidates, index, false, generation);
        return;
      }
      tryLoadCandidate(candidates, index + 1, preferredCors(candidates[index + 1] || ""), generation);
    };

    const started = assignSrc(coverEl, url, withCors);
    // Si ya estaba cargada la misma URL con CORS, dispara el callback.
    if (!started && withCors && coverEl.complete && coverEl.naturalWidth > 0) {
      if (onReadyCallback) onReadyCallback(coverEl);
    }
  }

  /** Registra el callback que corre cuando la portada está lista (extracción de color). */
  function onCoverReady(callback) {
    onReadyCallback = callback;
  }

  return { show, setNeighbors, setLoading, onCoverReady };
}
