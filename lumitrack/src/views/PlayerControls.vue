<script setup>
import { computed, ref, watch } from "vue";
import { PlaybackState } from "../services/audioEngine.js";
import "../styles/views/player-controls.css";

const props = defineProps({
  state: { type: String, default: PlaybackState.IDLE },
  progress: {
    type: Object,
    default: () => ({ currentTime: 0, duration: 0, bufferedEnd: 0 }),
  },
  hasCurrent: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
});

const emit = defineEmits(["play-click", "prev", "next", "seek"]);

const ICONS = {
  [PlaybackState.PLAYING]: "⏸",
  [PlaybackState.PAUSED]: "▶",
  [PlaybackState.ENDED]: "↻",
  [PlaybackState.IDLE]: "▶",
};

const LABELS = {
  [PlaybackState.PLAYING]: "Pausar",
  [PlaybackState.PAUSED]: "Reproducir",
  [PlaybackState.ENDED]: "Repetir",
  [PlaybackState.IDLE]: "Reproducir",
};

const progressTrackEl = ref(null);
const fillWidth = ref("0%");
const bufferedWidth = ref("0%");
const timeLabel = ref("0:00/-0:00");
const knownDuration = ref(0);

const playIcon = computed(() => ICONS[props.state] ?? ICONS[PlaybackState.IDLE]);
const playLabel = computed(() => LABELS[props.state] ?? LABELS[PlaybackState.IDLE]);

function formatTime(totalSeconds) {
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(totalSeconds / 60);
  return `${m}:${s}`;
}

watch(
  () => props.progress,
  ({ currentTime, duration, bufferedEnd }) => {
    if (!Number.isFinite(duration) || duration <= 0) {
      knownDuration.value = 0;
      timeLabel.value = "0:00/-0:00";
      fillWidth.value = "0%";
      bufferedWidth.value = "0%";
      return;
    }
    knownDuration.value = duration;
    const remaining = Math.max(0, duration - currentTime);
    timeLabel.value = `${formatTime(duration)}/-${formatTime(remaining)}`;
    fillWidth.value = `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%`;
    bufferedWidth.value = `${Math.min(100, Math.max(0, (bufferedEnd / duration) * 100))}%`;
  },
  { deep: true, immediate: true },
);

function handleTrackClick(event) {
  if (knownDuration.value <= 0 || !progressTrackEl.value) return;
  const rect = progressTrackEl.value.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  emit("seek", fraction * knownDuration.value);
}
</script>

<template>
  <div id="transport" aria-label="Controles de reproducción">
    <button
      id="prev-track"
      type="button"
      title="Anterior"
      aria-label="Anterior"
      :disabled="!hasCurrent"
      @click="emit('prev')"
    >
      ⏮
    </button>
    <button
      id="play-toggle"
      type="button"
      :title="playLabel"
      :aria-label="playLabel"
      @click="emit('play-click', state)"
    >
      {{ playIcon }}
    </button>
    <button
      id="next-track"
      type="button"
      title="Siguiente"
      aria-label="Siguiente"
      :disabled="!hasCurrent || !hasNext"
      @click="emit('next')"
    >
      ⏭
    </button>
  </div>

  <div id="progress-track" ref="progressTrackEl" @click="handleTrackClick">
    <div id="progress-track-hit">
      <div id="progress-buffered" :style="{ width: bufferedWidth }"></div>
      <div id="progress-fill" :style="{ width: fillWidth }"></div>
    </div>
  </div>

  <span id="time-remaining">{{ timeLabel }}</span>
</template>
