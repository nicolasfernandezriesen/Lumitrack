<script setup>
import { onMounted, onUnmounted } from "vue";
import "../styles/views/playlist-detail-modal.css";
import "../styles/views/artist-detail-modal.css";

const props = defineProps({
  open: { type: Boolean, default: false },
  artist: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
});

const emit = defineEmits(["close", "play-track"]);

function formatDuration(duration) {
  if (!Number.isFinite(duration) || duration < 0) return "";
  const totalMinutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60)
    .toString()
    .padStart(2, "0");
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

function onKeyDown(event) {
  if (props.open && event.key === "Escape") emit("close");
}

onMounted(() => document.addEventListener("keydown", onKeyDown));
onUnmounted(() => document.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <div
    v-if="open"
    class="playlist-detail-overlay"
    @click.self="emit('close')"
  >
    <section
      class="playlist-detail-modal artist-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artist-detail-title"
    >
      <button
        class="playlist-detail-close"
        type="button"
        aria-label="Cerrar detalle del artista"
        @click="emit('close')"
      >
        ×
      </button>

      <header class="artist-detail-header">
        <img
          v-if="artist?.thumbnail"
          class="artist-detail-image"
          :src="artist.thumbnail"
          :alt="`Imagen de ${artist?.title || 'artista'}`"
        >
        <div>
          <p class="artist-detail-label">Artista</p>
          <h2 id="artist-detail-title">
            {{ artist?.title || "Artista" }}
          </h2>
        </div>
      </header>

      <h3 class="artist-detail-section-title">Canciones más populares</h3>
      <p v-if="loading" class="playlist-detail-message" aria-live="polite">
        Cargando canciones…
      </p>
      <p v-else-if="error" class="playlist-detail-message" role="alert">
        {{ error }}
      </p>
      <p
        v-else-if="!artist?.tracks?.length"
        class="playlist-detail-message"
        aria-live="polite"
      >
        No hay canciones disponibles para este artista.
      </p>
      <ol
        v-else
        class="playlist-detail-list"
        :aria-label="`Canciones más populares de ${artist?.title || 'el artista'}`"
      >
        <li
          v-for="(track, index) in artist.tracks"
          :key="`${track.videoId}-${index}`"
        >
          <button
            type="button"
            class="playlist-detail-track artist-detail-track"
            :aria-label="`Reproducir ${track.title || 'canción'}`"
            @click="emit('play-track', index)"
          >
            <span class="playlist-item-number">{{
              String(index + 1).padStart(2, "0")
            }}</span>
            <img
              v-if="track.thumbnail"
              class="artist-detail-track-image"
              :src="track.thumbnail"
              alt=""
              loading="lazy"
            >
            <span class="playlist-item-info">
              <span class="playlist-item-title">{{
                track.title || "Sin título"
              }}</span>
              <span class="playlist-item-artist">
                {{ track.album || track.artist || "Desconocido" }}
              </span>
            </span>
            <span class="playlist-item-duration">{{
              formatDuration(track.duration)
            }}</span>
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>
