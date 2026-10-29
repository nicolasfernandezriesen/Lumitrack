<script setup>
import { onMounted, onUnmounted } from "vue";
import "../styles/views/playlist-detail-modal.css";

const props = defineProps({
  open: { type: Boolean, default: false },
  playlist: { type: Object, default: null },
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
      class="playlist-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="playlist-detail-title"
    >
      <button
        class="playlist-detail-close"
        type="button"
        aria-label="Cerrar detalle de playlist"
        @click="emit('close')"
      >
        ×
      </button>
      <h2 id="playlist-detail-title">
        {{ playlist?.title || "Playlist" }}
      </h2>
      <div class="playlist-detail-meta">
        <p class="playlist-detail-creator">
          {{ playlist?.creator || "Desconocido" }}
        </p>
        <span
          v-if="formatDuration(playlist?.totalDuration)"
          class="playlist-detail-duration"
        >
          {{ formatDuration(playlist.totalDuration) }}
        </span>
      </div>

      <p v-if="loading" class="playlist-detail-message" aria-live="polite">
        Cargando canciones…
      </p>
      <p v-else-if="error" class="playlist-detail-message" role="alert">
        {{ error }}
      </p>
      <ol
        v-else
        class="playlist-detail-list"
        :aria-label="`Canciones de ${playlist?.title || 'la playlist'}`"
      >
        <li
          v-for="(track, index) in playlist?.tracks || []"
          :key="`${track.videoId}-${index}`"
        >
          <button
            type="button"
            class="playlist-detail-track"
            :aria-label="`Reproducir ${track.title || 'canción'}`"
            @click="emit('play-track', index)"
          >
            <span class="playlist-item-number">{{
              String(index + 1).padStart(2, "0")
            }}</span>
            <span class="playlist-item-info">
              <span class="playlist-item-title">{{
                track.title || "Sin título"
              }}</span>
              <span class="playlist-item-artist">{{
                track.artist || "Desconocido"
              }}</span>
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
