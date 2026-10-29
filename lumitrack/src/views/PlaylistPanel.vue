<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import "../styles/views/playlist-panel.css";

const props = defineProps({
  open: { type: Boolean, default: false },
  history: { type: Array, default: () => [] },
  upcoming: { type: Array, default: () => [] },
});

const emit = defineEmits(["play-track", "remove", "close"]);

const listEl = ref(null);
const panelEl = ref(null);
const contextMenu = ref(null);

const historyTracks = computed(() => props.history.slice().reverse());
const isEmpty = computed(
  () => !props.history.length && !props.upcoming.length,
);

function formatDuration(duration) {
  if (!Number.isFinite(duration) || duration < 0) return "";
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function closeContextMenu() {
  contextMenu.value = null;
}

function openContextMenu(event, track) {
  event.stopPropagation();
  const width = 170;
  const height = 48;
  const left = Math.min(event.clientX, window.innerWidth - width - 8);
  const top = Math.min(event.clientY, window.innerHeight - height - 8);
  contextMenu.value = {
    track,
    style: {
      left: `${Math.max(8, left)}px`,
      top: `${Math.max(8, top)}px`,
    },
  };
}

function onDocumentPointerDown(event) {
  const dock = document.getElementById("playback-dock");
  const cover = document.getElementById("cover-stack");
  const menu = document.querySelector(".playlist-context-menu");
  const detailModal = document.querySelector(".playlist-detail-overlay");
  if (
    dock?.contains(event.target) ||
    cover?.contains(event.target) ||
    menu?.contains(event.target) ||
    detailModal?.contains(event.target)
  ) {
    if (menu && !menu.contains(event.target) && contextMenu.value) {
      closeContextMenu();
    }
    return;
  }
  if (props.open) emit("close");
  closeContextMenu();
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

watch(
  () => [props.history, props.upcoming],
  () => closeContextMenu(),
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("scroll", closeContextMenu, true);
  window.addEventListener("resize", closeContextMenu);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("scroll", closeContextMenu, true);
  window.removeEventListener("resize", closeContextMenu);
});

defineExpose({ listEl, panelEl });
</script>

<template>
  <div id="playlist-panel" ref="panelEl" :aria-hidden="!open">
    <ol id="playlist-list" ref="listEl" aria-label="Canciones siguientes">
      <li v-if="isEmpty" class="playlist-empty">No hay canciones en cola</li>

      <template v-if="historyTracks.length">
        <li class="playlist-section-heading">Escuchadas</li>
        <li
          v-for="(track, index) in historyTracks"
          :key="`h-${track.videoId}-${index}`"
          class="playlist-item"
        >
          <span class="playlist-item-number">{{
            String(index + 1).padStart(2, "0")
          }}</span>
          <button
            type="button"
            class="playlist-item-cover-button"
            :aria-label="`Reproducir ${track.title || 'canción'}`"
            @click="emit('play-track', track)"
          >
            <img
              class="playlist-item-cover"
              :src="track.thumbnail || ''"
              alt=""
              loading="lazy"
            >
          </button>
          <div class="playlist-item-info">
            <span class="playlist-item-title" :title="track.title || 'Sin título'">{{
              track.title || "Sin título"
            }}</span>
            <span
              class="playlist-item-artist"
              :title="track.artist || 'Desconocido'"
              >{{ track.artist || "Desconocido" }}</span
            >
          </div>
          <span class="playlist-item-duration">{{
            formatDuration(track.duration)
          }}</span>
          <button
            type="button"
            class="playlist-item-menu"
            title="Opciones"
            :aria-label="`Opciones para ${track.title || 'canción'}`"
            aria-haspopup="menu"
            @click="openContextMenu($event, track)"
          >
            ⋮
          </button>
        </li>
      </template>

      <template v-if="upcoming.length">
        <li class="playlist-section-heading">A continuación</li>
        <li
          v-for="(track, index) in upcoming"
          :key="`u-${track.videoId}-${index}`"
          class="playlist-item"
        >
          <span class="playlist-item-number">{{
            String(index + 1).padStart(2, "0")
          }}</span>
          <button
            type="button"
            class="playlist-item-cover-button"
            :aria-label="`Reproducir ${track.title || 'canción'}`"
            @click="emit('play-track', track)"
          >
            <img
              class="playlist-item-cover"
              :src="track.thumbnail || ''"
              alt=""
              loading="lazy"
            >
          </button>
          <div class="playlist-item-info">
            <span class="playlist-item-title" :title="track.title || 'Sin título'">{{
              track.title || "Sin título"
            }}</span>
            <span
              class="playlist-item-artist"
              :title="track.artist || 'Desconocido'"
              >{{ track.artist || "Desconocido" }}</span
            >
          </div>
          <span class="playlist-item-duration">{{
            formatDuration(track.duration)
          }}</span>
          <button
            type="button"
            class="playlist-item-menu"
            title="Opciones"
            :aria-label="`Opciones para ${track.title || 'canción'}`"
            aria-haspopup="menu"
            @click="openContextMenu($event, track)"
          >
            ⋮
          </button>
        </li>
      </template>
    </ol>
  </div>

  <Teleport to="body">
    <div
      v-if="contextMenu"
      class="playlist-context-menu"
      role="menu"
      :aria-label="`Opciones para ${contextMenu.track.title || 'canción'}`"
      :style="contextMenu.style"
    >
      <button
        type="button"
        class="playlist-context-menu-item"
        role="menuitem"
        @click="
          emit('remove', contextMenu.track.videoId);
          closeContextMenu();
        "
      >
        Quitar cancion
      </button>
    </div>
  </Teleport>
</template>
