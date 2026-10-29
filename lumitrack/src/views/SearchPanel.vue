<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { searchTracks } from "../services/searchApi.js";
import "../styles/views/search-panel.css";

const props = defineProps({
  open: { type: Boolean, default: false },
  status: { type: String, default: "" },
});

const emit = defineEmits([
  "track-selected",
  "track-play-next",
  "playlist-selected",
  "playlist-detail",
  "artist-selected",
  "artist-detail",
  "album-selected",
  "album-detail",
  "update:status",
]);

const DEBOUNCE_MS = 450;
const FALLBACK_THUMBNAIL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 42 42'%3E%3Crect width='42' height='42' rx='6' fill='%2326262c'/%3E%3Cpath d='M25 9v17.5a5 5 0 1 1-2-4V14l11-2v11.5a5 5 0 1 1-2-4V9z' fill='%238b7cff'/%3E%3C/svg%3E";

const FILTERS = [
  { id: "artist", label: "Artista" },
  { id: "album", label: "Álbum" },
  { id: "playlist", label: "Playlist" },
  { id: "video", label: "Video" },
];

const query = ref("");
const results = ref([]);
const activeFilter = ref(null);
const localStatus = ref("");
const contextMenu = ref(null);
const panelEl = ref(null);

let debounceTimer = null;
let searchSequence = 0;

const displayStatus = computed(() => props.status || localStatus.value);

function setStatus(text) {
  localStatus.value = text || "";
  emit("update:status", text || "");
}

function closeContextMenu() {
  contextMenu.value = null;
}

function positionMenu(event, width, height) {
  const left =
    event.clientX + width <= window.innerWidth
      ? event.clientX
      : event.clientX - width;
  const top = Math.min(
    Math.max(0, event.clientY),
    Math.max(0, window.innerHeight - height),
  );
  return {
    left: `${Math.min(Math.max(0, left), Math.max(0, window.innerWidth - width))}px`,
    top: `${top}px`,
  };
}

function openContextMenu(event, track) {
  event.preventDefault();
  const approxWidth = 200;
  const approxHeight = 48;
  contextMenu.value = {
    track,
    style: positionMenu(event, approxWidth, approxHeight),
  };
}

function handleContextMenuAction() {
  const track = contextMenu.value?.track;
  if (!track) return;
  if (track.type === "playlist") {
    emit("playlist-detail", track);
  } else if (track.type === "artist") {
    emit("artist-detail", track);
  } else if (track.type === "album") {
    emit("album-detail", track);
  } else {
    emit("track-play-next", track);
  }
  closeContextMenu();
}

function canPlay(track) {
  return track.type === "song" || track.type === "video";
}

function handleThumbnailError(event, track) {
  const image = event.currentTarget;
  if (image.dataset.thumbnailFallback) return;
  const candidates = track.thumbnailCandidates || [];
  const nextIndex = Number(image.dataset.thumbnailIndex || 0) + 1;
  if (nextIndex < candidates.length) {
    image.dataset.thumbnailIndex = String(nextIndex);
    image.src = candidates[nextIndex];
    return;
  }
  image.classList.add("result-thumbnail-unavailable");
  image.dataset.thumbnailFallback = "true";
  image.src = FALLBACK_THUMBNAIL;
}

async function runSearch(q) {
  const sequence = ++searchSequence;
  const filter = activeFilter.value || "song";
  try {
    const next = await searchTracks(q, filter);
    if (sequence !== searchSequence) return;
    results.value = next;
    setStatus(next.length ? "" : "Sin resultados.");
  } catch (err) {
    if (sequence !== searchSequence) return;
    closeContextMenu();
    setStatus("Error: " + err.message);
    results.value = [];
  }
}

function handleInput() {
  clearTimeout(debounceTimer);
  closeContextMenu();
  const q = query.value.trim();
  if (!q) {
    searchSequence += 1;
    results.value = [];
    setStatus("");
    return;
  }
  setStatus("Buscando…");
  debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
}

function toggleFilter(filterId) {
  activeFilter.value = activeFilter.value === filterId ? null : filterId;
  clearTimeout(debounceTimer);
  const q = query.value.trim();
  if (q) {
    setStatus("Buscando…");
    void runSearch(q);
  } else {
    searchSequence += 1;
    results.value = [];
    setStatus("");
  }
}

function onPanelClick(event) {
  if (event.target === panelEl.value) closeContextMenu();
}

function onDocumentPointerDown(event) {
  const menu = document.querySelector(".search-context-menu");
  if (menu && !menu.contains(event.target)) closeContextMenu();
}

function onKeyDown(event) {
  if (event.key === "Escape") closeContextMenu();
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) closeContextMenu();
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("scroll", closeContextMenu, true);
  window.addEventListener("resize", closeContextMenu);
});

onUnmounted(() => {
  clearTimeout(debounceTimer);
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("scroll", closeContextMenu, true);
  window.removeEventListener("resize", closeContextMenu);
});

defineExpose({ setStatus, panelEl });
</script>

<template>
  <div
    id="panel"
    ref="panelEl"
    class="top-panel"
    :class="{ hidden: !open }"
    :aria-hidden="!open"
    @click="onPanelClick"
  >
    <h2>Búsqueda</h2>
    <input
      id="search-input"
      v-model="query"
      type="text"
      placeholder="Buscar canción o artista…"
      @input="handleInput"
    >
    <div id="search-filters" role="group" aria-label="Filtrar resultados">
      <button
        v-for="filter in FILTERS"
        :key="filter.id"
        class="search-filter"
        type="button"
        :data-filter="filter.id"
        :aria-pressed="activeFilter === filter.id"
        @click="toggleFilter(filter.id)"
      >
        {{ filter.label }}
      </button>
    </div>
    <p id="search-status">{{ displayStatus }}</p>
    <div id="results-list">
      <button
        v-for="track in results"
        :key="
          track.videoId ||
          track.albumId ||
          track.playlistId ||
          track.artistId ||
          track.title
        "
        class="result-item"
        type="button"
        @click="
          track.type === 'playlist'
            ? emit('playlist-selected', track)
            : track.type === 'artist'
              ? emit('artist-selected', track)
              : track.type === 'album'
                ? emit('album-selected', track)
                : canPlay(track) && emit('track-selected', track)
        "
        @contextmenu="
          (track.type === 'playlist' ||
            track.type === 'artist' ||
            track.type === 'album' ||
            canPlay(track)) &&
          openContextMenu($event, track)
        "
      >
        <img
          :src="track.thumbnail || ''"
          alt=""
          loading="lazy"
          @error="handleThumbnailError($event, track)"
        >
        <div class="result-info">
          <div class="result-title">{{ track.title || "Sin título" }}</div>
          <div class="result-artist">{{ track.artist || track.subtitle || "" }}</div>
        </div>
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="contextMenu"
      class="search-context-menu"
      role="menu"
      :aria-label="`Opciones para ${contextMenu.track.title || 'canción'}`"
      :style="contextMenu.style"
    >
      <button
        type="button"
        class="search-context-menu-item"
        role="menuitem"
        @click="handleContextMenuAction"
      >
        {{
          contextMenu.track.type === "playlist"
          || contextMenu.track.type === "artist"
          || contextMenu.track.type === "album"
            ? "Ver detalle"
            : "Reproducir a continuación"
        }}
      </button>
    </div>
  </Teleport>
</template>
