<script setup>
import { computed, nextTick, ref, watch } from "vue";
import "../styles/views/now-playing.css";

const props = defineProps({
  track: { type: Object, default: null },
  previous: { type: Object, default: null },
  next: { type: Object, default: null },
  playlistOpen: { type: Boolean, default: false },
});

const emit = defineEmits(["cover-ready", "toggle-playlist"]);

const coverEl = ref(null);
const coverPrevEl = ref(null);
const coverNextEl = ref(null);

const title = computed(() => props.track?.title || "Nada sonando todavía");
const artist = computed(
  () => props.track?.artist || "Buscá una canción para empezar",
);

const corsOkHosts = new Set();
const corsBadHosts = new Set();
let loadGeneration = 0;
let peekGeneration = 0;

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
  if (withCors) imgEl.crossOrigin = "anonymous";
  else imgEl.removeAttribute("crossorigin");

  const sameUrl = imgEl.getAttribute("src") === url;
  const hasCors = imgEl.crossOrigin === "anonymous";
  if (sameUrl && hasCors === withCors && imgEl.complete && imgEl.naturalWidth > 0) {
    return false;
  }

  if (!sameUrl) imgEl.src = url;
  else if (hasCors !== withCors) {
    imgEl.src = "";
    imgEl.src = url;
  }
  return true;
}

function tryLoad(imgEl, candidates, index, withCors, generation, getGeneration, onReady) {
  if (generation !== getGeneration() || index >= candidates.length) {
    if (generation === getGeneration()) {
      imgEl.removeAttribute("src");
      imgEl.hidden = true;
    }
    return;
  }

  const url = candidates[index];
  imgEl.hidden = false;
  imgEl.onload = () => {
    if (generation !== getGeneration()) return;
    if (withCors) rememberCors(url, true);
    onReady?.(imgEl);
  };
  imgEl.onerror = () => {
    if (generation !== getGeneration()) return;
    if (withCors) {
      rememberCors(url, false);
      tryLoad(imgEl, candidates, index, false, generation, getGeneration, onReady);
      return;
    }
    tryLoad(
      imgEl,
      candidates,
      index + 1,
      preferredCors(candidates[index + 1] || ""),
      generation,
      getGeneration,
      onReady,
    );
  };

  const started = assignSrc(imgEl, url, withCors);
  if (!started && withCors && imgEl.complete && imgEl.naturalWidth > 0) {
    onReady?.(imgEl);
  }
}

function loadImageInto(imgEl, track, generation, getGeneration, onReady) {
  const candidates = coverCandidates(track);
  if (!candidates.length) {
    imgEl.removeAttribute("src");
    imgEl.hidden = true;
    return;
  }
  tryLoad(
    imgEl,
    candidates,
    0,
    preferredCors(candidates[0]),
    generation,
    getGeneration,
    onReady,
  );
}

watch(
  () => props.track,
  async (track) => {
    await nextTick();
    const img = coverEl.value;
    if (!img || !track) return;
    const generation = ++loadGeneration;
    loadImageInto(img, track, generation, () => loadGeneration, (el) => {
      emit("cover-ready", el);
    });
  },
);

watch(
  () => [props.previous, props.next],
  async ([previous, next]) => {
    await nextTick();
    const generation = ++peekGeneration;
    const getGeneration = () => peekGeneration;
    const prevEl = coverPrevEl.value;
    const nextEl = coverNextEl.value;

    if (prevEl) {
      if (previous) {
        loadImageInto(prevEl, previous, generation, getGeneration);
        prevEl.alt = previous.title || "Anterior";
      } else {
        prevEl.hidden = true;
        prevEl.removeAttribute("src");
        prevEl.alt = "";
      }
    }

    if (nextEl) {
      if (next) {
        loadImageInto(nextEl, next, generation, getGeneration);
        nextEl.alt = next.title || "Siguiente";
      } else {
        nextEl.hidden = true;
        nextEl.removeAttribute("src");
        nextEl.alt = "";
      }
    }
  },
  { immediate: true },
);

function onCoverActivate(event) {
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") {
    return;
  }
  if (event.type === "keydown") event.preventDefault();
  emit("toggle-playlist");
}
</script>

<template>
  <div id="now-playing">
    <div
      id="cover-stack"
      role="button"
      tabindex="0"
      aria-controls="playlist-panel"
      :aria-label="playlistOpen ? 'Ocultar playlist' : 'Mostrar playlist'"
      :aria-expanded="playlistOpen"
      :class="{ 'has-prev': !!previous, 'has-next': !!next }"
      @click="onCoverActivate"
      @keydown="onCoverActivate"
    >
      <img
        id="cover-prev"
        ref="coverPrevEl"
        class="cover-peek cover-peek--prev"
        alt=""
        hidden
      >
      <img id="cover" ref="coverEl" alt="">
      <img
        id="cover-next"
        ref="coverNextEl"
        class="cover-peek cover-peek--next"
        alt=""
        hidden
      >
    </div>

    <div id="player-main">
      <div id="meta">
        <p id="track-title" :title="title">{{ title }}</p>
        <p id="track-artist" :title="artist">{{ artist }}</p>
      </div>
      <div id="controls-row">
        <slot />
      </div>
    </div>
  </div>
</template>
