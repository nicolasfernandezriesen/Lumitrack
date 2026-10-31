<script setup>
import { computed, ref, watch } from "vue";
import { PlaybackState } from "../services/audioEngine.js";
import "../styles/views/player-controls.css";

const props = defineProps({
  state: { type: String, default: PlaybackState.IDLE },
  progress: {
    type: Object,
    default: () => ({
      currentTime: 0,
      duration: 0,
      bufferedStart: 0,
      bufferedEnd: 0,
    }),
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
const bufferedLeft = ref("0%");
const bufferedWidth = ref("0%");
const isRemainingMode = ref(false);
const knownDuration = ref(0);
const draggingPointerId = ref(null);
const dragFraction = ref(null);
let suppressNextClick = false;

const playIcon = computed(() => ICONS[props.state] ?? ICONS[PlaybackState.IDLE]);
const playLabel = computed(() => LABELS[props.state] ?? LABELS[PlaybackState.IDLE]);
const currentFraction = computed(() => {
  if (dragFraction.value !== null) return dragFraction.value;
  if (knownDuration.value <= 0) return 0;
  return Math.min(1, Math.max(0, props.progress.currentTime / knownDuration.value));
});
const fillWidth = computed(() => `${currentFraction.value * 100}%`);
const displayedTime = computed(() => currentFraction.value * knownDuration.value);
const timeLabel = computed(() => {
  const duration = knownDuration.value;
  const useHours = duration >= 3600;
  if (duration <= 0) {
    return isRemainingMode.value ? "00:00/-00:00" : "00:00/00:00";
  }
  const currentTime = Math.min(duration, Math.max(0, props.progress.currentTime));
  const value = isRemainingMode.value
    ? `-${formatTime(duration - currentTime, useHours)}`
    : formatTime(currentTime, useHours);
  return `${formatTime(duration, useHours)}/${value}`;
});

function formatTime(totalSeconds, useHours = false) {
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  if (useHours) return `${Math.floor(totalSeconds / 3600)}:${m}:${s}`;
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${s}`;
}

function toggleTimeMode() {
  isRemainingMode.value = !isRemainingMode.value;
}

function formatProgressTime(totalSeconds) {
  return formatTime(totalSeconds, knownDuration.value >= 3600);
}

watch(
  () => props.progress,
  ({ currentTime, duration, bufferedStart = 0, bufferedEnd }) => {
    if (!Number.isFinite(duration) || duration <= 0) {
      knownDuration.value = 0;
      bufferedLeft.value = "0%";
      bufferedWidth.value = "0%";
      return;
    }
    knownDuration.value = duration;
    const start = Math.min(duration, Math.max(0, bufferedStart));
    const end = Math.min(duration, Math.max(start, bufferedEnd));
    bufferedLeft.value = `${(start / duration) * 100}%`;
    bufferedWidth.value = `${((end - start) / duration) * 100}%`;
  },
  { deep: true, immediate: true },
);

function fractionAtPointer(event) {
  if (!progressTrackEl.value) return 0;
  const rect = progressTrackEl.value.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}

function handlePointerDown(event) {
  if (knownDuration.value <= 0 || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  draggingPointerId.value = event.pointerId;
  dragFraction.value = fractionAtPointer(event);
  suppressNextClick = true;
  progressTrackEl.value?.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (event.pointerId !== draggingPointerId.value) return;
  dragFraction.value = fractionAtPointer(event);
}

function handlePointerUp(event) {
  if (event.pointerId !== draggingPointerId.value) return;
  dragFraction.value = fractionAtPointer(event);
  emit("seek", dragFraction.value * knownDuration.value);
  draggingPointerId.value = null;
  dragFraction.value = null;
}

function handlePointerCancel(event) {
  if (event.pointerId !== draggingPointerId.value) return;
  draggingPointerId.value = null;
  dragFraction.value = null;
  suppressNextClick = false;
}

function handleTrackClick(event) {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (event.detail === 0 || knownDuration.value <= 0) return;
  emit("seek", fractionAtPointer(event) * knownDuration.value);
}

function handleTrackKeydown(event) {
  if (knownDuration.value <= 0) return;
  const currentTime = props.progress.currentTime;
  let target = currentTime;
  switch (event.key) {
    case "ArrowLeft":
      target -= 5;
      break;
    case "ArrowRight":
      target += 5;
      break;
    case "PageDown":
      target -= knownDuration.value * 0.1;
      break;
    case "PageUp":
      target += knownDuration.value * 0.1;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = knownDuration.value;
      break;
    default:
      return;
  }
  event.preventDefault();
  emit("seek", Math.min(knownDuration.value, Math.max(0, target)));
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

  <div
    id="progress-track"
    ref="progressTrackEl"
    :class="{ 'is-dragging': draggingPointerId !== null }"
    role="slider"
    aria-label="Posición de reproducción"
    :aria-valuemin="0"
    :aria-valuemax="knownDuration"
    :aria-valuenow="displayedTime"
    :aria-valuetext="formatProgressTime(displayedTime)"
    :aria-disabled="knownDuration <= 0"
    :tabindex="knownDuration > 0 ? 0 : -1"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
    @click="handleTrackClick"
    @keydown="handleTrackKeydown"
  >
    <div id="progress-track-hit">
      <div
        id="progress-buffered"
        :style="{ left: bufferedLeft, width: bufferedWidth }"
      ></div>
      <div id="progress-fill" :style="{ width: fillWidth }"></div>
    </div>
  </div>

  <button
    id="time-remaining"
    type="button"
    :aria-label="isRemainingMode ? 'Mostrar tiempo transcurrido' : 'Mostrar tiempo restante'"
    :title="isRemainingMode ? 'Mostrar tiempo transcurrido' : 'Mostrar tiempo restante'"
    :aria-pressed="isRemainingMode"
    @click="toggleTimeMode"
  >
    {{ timeLabel }}
  </button>
</template>
