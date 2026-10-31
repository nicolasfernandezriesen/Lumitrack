import {
  streamUrl,
  isTrackCached,
  getCachedTrackSection,
} from "./searchApi.js";

const FFT_SIZE = 4096;
const MIN_FREQ_HZ = 60;
const MAX_FREQ_HZ = 16000;
const CACHE_POLL_MS = 1500;

export const PlaybackState = {
  IDLE: "idle",
  PLAYING: "playing",
  PAUSED: "paused",
  ENDED: "ended",
};

export function createAudioEngine({ barCount, onError, onStateChange, onProgress }) {
  let audioCtx = null;
  let analyser = null;
  let gainNode = null;
  let audioEl = null;
  let dataArray = null;
  let bufferLength = 0;
  let barRanges = null;
  let rafId = null;
  let onFrame = null;
  let state = PlaybackState.IDLE;
  // Invalida operaciones async que quedaron obsoletas al cambiar de canción.
  let loadToken = 0;
  let seekToken = 0;
  let currentVideoId = null;
  let sourceOffset = 0;
  let trackDuration = 0;
  /** Caché RAM lista; el seek completo puede requerir un rebind único. */
  let cacheReady = false;
  /** Ya se hizo rebind al stream cacheado (Accept-Ranges). */
  let reboundFromCache = false;
  let cacheWatchTimer = null;
  let volume = 1;
  let muted = false;
  let levelsBuf = new Array(barCount);
  let visibilityBound = false;

  function setState(next) {
    state = next;
    onStateChange?.(state);
  }

  function ensureVisibilityHook() {
    if (visibilityBound) return;
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopVisualLoop({ resetBars: false });
        return;
      }
      if (state === PlaybackState.PLAYING) startVisualLoop();
    });
  }

  function ensureGraph() {
    if (audioCtx) return;

    ensureVisibilityHook();

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.75;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    barRanges = buildBarRanges(audioCtx.sampleRate, bufferLength, barCount);

    audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
    audioEl.setAttribute("playsinline", "");
    audioEl.preload = "auto";
    // Mantener el elemento en el DOM mejora la integración con Media Session / teclas multimedia.
    audioEl.hidden = true;
    document.body.appendChild(audioEl);
    const source = audioCtx.createMediaElementSource(audioEl);
    source.connect(analyser);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = volume;
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    audioEl.addEventListener("ended", () => {
      stopVisualLoop();
      setState(PlaybackState.ENDED);
    });
    audioEl.addEventListener("error", () => {
      stopVisualLoop();
      onError?.("Error reproduciendo el stream de audio.");
    });
    audioEl.addEventListener("timeupdate", emitProgress);
    audioEl.addEventListener("progress", emitProgress);
    audioEl.addEventListener("loadedmetadata", emitProgress);
    audioEl.addEventListener("durationchange", emitProgress);
    audioEl.addEventListener("seeking", emitProgress);
    audioEl.addEventListener("seeked", emitProgress);
  }

  function emitProgress() {
    if (!audioEl) return;
    const mediaDuration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
    if (sourceOffset === 0 && mediaDuration > 0) {
      trackDuration = mediaDuration;
    } else if (trackDuration <= sourceOffset && mediaDuration > 0) {
      trackDuration = sourceOffset + mediaDuration;
    }
    const duration = trackDuration || sourceOffset + mediaDuration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    let bufferedStart = Infinity;
    let bufferedEnd = 0;
    const buffered = audioEl.buffered;
    for (let i = 0; i < buffered.length; i++) {
      bufferedStart = Math.min(bufferedStart, sourceOffset + buffered.start(i));
      bufferedEnd = Math.max(bufferedEnd, sourceOffset + buffered.end(i));
    }
    onProgress?.({
      currentTime: sourceOffset + audioEl.currentTime,
      duration,
      bufferedStart: Number.isFinite(bufferedStart) ? bufferedStart : 0,
      bufferedEnd,
    });
  }

  // Distribuye el rango audible en tramos logarítmicos sin colisiones.
  function buildBarRanges(sampleRate, binCount, bars) {
    const binHz = sampleRate / FFT_SIZE;
    const maxHz = Math.min(MAX_FREQ_HZ, (sampleRate / 2) * 0.9);
    const minBin = Math.max(1, Math.floor(MIN_FREQ_HZ / binHz));
    const maxBin = Math.min(binCount, Math.ceil(maxHz / binHz));

    const logMin = Math.log(minBin);
    const logMax = Math.log(Math.max(minBin + 1, maxBin));
    const ranges = new Array(bars);
    let prev = minBin;

    for (let i = 0; i < bars; i++) {
      const idealEnd =
        i === bars - 1
          ? maxBin
          : Math.round(Math.exp(logMin + (logMax - logMin) * ((i + 1) / bars)));
      const start = prev;
      const end = Math.max(start + 1, Math.min(idealEnd, maxBin));
      ranges[i] = { start, end };
      prev = end;
    }
    ranges[bars - 1].end = maxBin;
    return ranges;
  }

  function frequencyLevels() {
    analyser.getByteFrequencyData(dataArray);
    for (let i = 0; i < barCount; i++) {
      const { start, end } = barRanges[i];
      let sum = 0;
      for (let j = start; j < end; j++) sum += dataArray[j];
      const avg = sum / (end - start);
      levelsBuf[i] = muted ? 3 : Math.max(3, (avg / 255) * 100 * volume);
    }
    return levelsBuf;
  }

  function startVisualLoop() {
    if (document.hidden || state !== PlaybackState.PLAYING) return;
    if (rafId) return;
    const tick = () => {
      if (state !== PlaybackState.PLAYING || document.hidden) {
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(tick);
      onFrame?.(frequencyLevels());
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopVisualLoop({ resetBars = true } = {}) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (resetBars) {
      levelsBuf.fill(3);
      onFrame?.(levelsBuf);
    }
  }

  function stopCacheWatch() {
    if (cacheWatchTimer) {
      clearInterval(cacheWatchTimer);
      cacheWatchTimer = null;
    }
  }

  /** Marca caché lista sin rebind: evita re-descargar el audio en reproducción normal. */
  function startCacheWatch(videoId, token) {
    stopCacheWatch();
    cacheWatchTimer = setInterval(async () => {
      if (token !== loadToken || videoId !== currentVideoId) {
        stopCacheWatch();
        return;
      }
      if (cacheReady) {
        stopCacheWatch();
        return;
      }
      try {
        const ready = await isTrackCached(videoId);
        if (token !== loadToken || videoId !== currentVideoId) return;
        if (ready) {
          cacheReady = true;
          stopCacheWatch();
        }
      } catch {}
    }, CACHE_POLL_MS);
  }

  function canSeekLocally(seconds) {
    if (!audioEl || !Number.isFinite(seconds)) return false;
    if (reboundFromCache && Number.isFinite(audioEl.duration)) {
      return seconds >= 0 && seconds <= audioEl.duration;
    }
    const localTime = seconds - sourceOffset;
    if (localTime < 0) return false;
    const buffered = audioEl.buffered;
    for (let i = 0; i < buffered.length; i++) {
      if (localTime >= buffered.start(i) && localTime <= buffered.end(i)) return true;
    }
    return false;
  }

  // AbortError es normal si otra canción reemplaza la carga en curso.
  async function safePlay() {
    try {
      await audioEl.play();
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
      throw err;
    }
  }

  function waitForMetadata() {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        audioEl.removeEventListener("loadedmetadata", onMeta);
        audioEl.removeEventListener("error", onError);
      };
      const onMeta = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("No se pudo cargar el audio desde el destino."));
      };

      audioEl.addEventListener("loadedmetadata", onMeta);
      audioEl.addEventListener("error", onError);
      if (audioEl.readyState >= 1) onMeta();
    });
  }

  // Rebind desde caché (o parcial con Range) para habilitar seek completo.
  async function rebindFromCache(seconds, { resume, seekOperation } = {}) {
    if (!audioEl || !currentVideoId) return false;
    const token = loadToken;
    const shouldResume = resume ?? state === PlaybackState.PLAYING;
    const url = streamUrl(currentVideoId);

    sourceOffset = 0;
    audioEl.src = url;
    await waitForMetadata();

    if (
      token !== loadToken ||
      (seekOperation !== undefined && seekOperation !== seekToken)
    ) {
      return false;
    }

    if (Number.isFinite(audioEl.duration)) {
      audioEl.currentTime = Math.min(Math.max(0, seconds), audioEl.duration);
    }
    cacheReady = true;
    reboundFromCache = true;

    if (shouldResume) {
      if (audioCtx.state === "suspended") await audioCtx.resume();
      if (
        token !== loadToken ||
        (seekOperation !== undefined && seekOperation !== seekToken)
      ) {
        return false;
      }
      const started = await safePlay();
      if (
        token !== loadToken ||
        (seekOperation !== undefined && seekOperation !== seekToken) ||
        !started
      ) {
        return false;
      }
      setState(PlaybackState.PLAYING);
      startVisualLoop();
    }

    emitProgress();
    return true;
  }

  async function rebindFromOffset(seconds, { resume, seekOperation } = {}) {
    if (!audioEl || !currentVideoId) return false;
    const token = loadToken;
    const shouldResume = resume ?? state !== PlaybackState.PAUSED;
    const end = Math.max(trackDuration, seconds + 0.1);

    audioEl.pause();
    sourceOffset = seconds;
    onProgress?.({
      currentTime: seconds,
      duration: trackDuration,
      bufferedStart: seconds,
      bufferedEnd: seconds,
    });
    audioEl.src = streamUrl(currentVideoId, { start: seconds, end });
    await waitForMetadata();

    if (
      token !== loadToken ||
      (seekOperation !== undefined && seekOperation !== seekToken)
    ) {
      return false;
    }

    if (trackDuration <= sourceOffset) {
      trackDuration = sourceOffset + audioEl.duration;
    }
    cacheReady = false;
    reboundFromCache = false;

    if (shouldResume) {
      if (audioCtx.state === "suspended") await audioCtx.resume();
      if (
        token !== loadToken ||
        (seekOperation !== undefined && seekOperation !== seekToken)
      ) {
        return false;
      }
      const started = await safePlay();
      if (
        token !== loadToken ||
        (seekOperation !== undefined && seekOperation !== seekToken) ||
        !started
      ) {
        return false;
      }
      setState(PlaybackState.PLAYING);
      startVisualLoop();
    }

    emitProgress();
    return true;
  }

  async function rebindFromCachedSection(
    seconds,
    section,
    { resume, seekOperation } = {},
  ) {
    if (!audioEl || !currentVideoId) return false;
    const token = loadToken;
    const shouldResume = resume ?? state !== PlaybackState.PAUSED;

    audioEl.pause();
    sourceOffset = section.start;
    audioEl.src = streamUrl(currentVideoId, section);
    await waitForMetadata();

    if (
      token !== loadToken ||
      (seekOperation !== undefined && seekOperation !== seekToken)
    ) {
      return false;
    }

    audioEl.currentTime = Math.min(
      Math.max(0, seconds - section.start),
      audioEl.duration,
    );
    cacheReady = false;
    reboundFromCache = false;

    if (shouldResume) {
      if (audioCtx.state === "suspended") await audioCtx.resume();
      if (
        token !== loadToken ||
        (seekOperation !== undefined && seekOperation !== seekToken)
      ) {
        return false;
      }
      const started = await safePlay();
      if (
        token !== loadToken ||
        (seekOperation !== undefined && seekOperation !== seekToken) ||
        !started
      ) {
        return false;
      }
      setState(PlaybackState.PLAYING);
      startVisualLoop();
    }

    emitProgress();
    return true;
  }

  async function play(videoId, onLevels) {
    ensureGraph();
    const myToken = ++loadToken;
    onFrame = onLevels;
    currentVideoId = videoId;
    sourceOffset = 0;
    trackDuration = 0;
    cacheReady = false;
    reboundFromCache = false;
    stopCacheWatch();
    stopVisualLoop({ resetBars: false });

    const cacheCheck = isTrackCached(videoId).catch(() => false);

    audioEl.src = streamUrl(videoId);

    if (audioCtx.state === "suspended") await audioCtx.resume();
    const started = await safePlay();
    if (myToken !== loadToken) return;

    const alreadyCached = await cacheCheck;
    if (myToken !== loadToken) return;

    if (started) {
      if (alreadyCached) {
        cacheReady = true;
        reboundFromCache = true;
      }
      setState(PlaybackState.PLAYING);
      startVisualLoop();
      if (!cacheReady) startCacheWatch(videoId, myToken);
    }
  }

  function pause() {
    if (!audioEl) return;
    audioEl.pause();
    stopVisualLoop();
    setState(PlaybackState.PAUSED);
  }

  async function resume() {
    if (!audioEl) return;
    const myToken = loadToken;
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const started = await safePlay();

    if (myToken !== loadToken || !started) return;
    setState(PlaybackState.PLAYING);
    startVisualLoop();
  }

  async function replay() {
    if (!audioEl) return;
    const myToken = loadToken;
    if (sourceOffset > 0) {
      sourceOffset = 0;
      reboundFromCache = cacheReady;
      audioEl.src = streamUrl(currentVideoId);
      try {
        await waitForMetadata();
      } catch (err) {
        onError?.(err.message);
        return;
      }
      if (myToken !== loadToken) return;
    }
    audioEl.currentTime = 0;
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const started = await safePlay();

    if (myToken !== loadToken || !started) return;
    setState(PlaybackState.PLAYING);
    startVisualLoop();
  }

  // Seek local si hay buffer; si no, pide un stream nuevo desde el destino.
  async function seek(seconds) {
    if (!audioEl || !currentVideoId) return;
    const token = loadToken;
    const operation = ++seekToken;
    const target = Number(seconds);
    if (!Number.isFinite(target)) return;

    if (canSeekLocally(target)) {
      audioEl.currentTime = Math.max(0, target - sourceOffset);
      return;
    }

    if (token !== loadToken || operation !== seekToken) return;

    let rebound;
    try {
      if (cacheReady) {
          rebound = await rebindFromCache(target, {
            resume: state !== PlaybackState.PAUSED,
            seekOperation: operation,
          });
      } else {
          const cachedSection = await getCachedTrackSection(
            currentVideoId,
            target,
          );
          if (token !== loadToken || operation !== seekToken) return;
          rebound = cachedSection
            ? await rebindFromCachedSection(target, cachedSection, {
            resume: state !== PlaybackState.PAUSED,
            seekOperation: operation,
              })
            : await rebindFromOffset(target, {
            resume: state !== PlaybackState.PAUSED,
            seekOperation: operation,
              });
      }
    } catch (err) {
      if (token === loadToken && operation === seekToken) {
        onError?.(err.message);
      }
      return;
    }
    if (!rebound && token === loadToken && operation === seekToken) {
      onError?.("No se pudo completar el adelanto de la canción.");
    }
  }

  function currentState() {
    return state;
  }

  function getCurrentTime() {
    return audioEl && Number.isFinite(audioEl.currentTime)
      ? sourceOffset + audioEl.currentTime
      : 0;
  }

  function setVolume(nextVolume, nextMuted = muted) {
    volume = Math.min(1, Math.max(0, Number(nextVolume) || 0));
    muted = Boolean(nextMuted);
    if (gainNode) gainNode.gain.value = muted ? 0 : volume;
    if (muted) {
      levelsBuf.fill(3);
      onFrame?.(levelsBuf);
    }
  }

  return { play, pause, resume, replay, seek, currentState, getCurrentTime, setVolume };
}
