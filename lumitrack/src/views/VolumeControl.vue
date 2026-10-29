<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import "../styles/views/volume-control.css";

const emit = defineEmits(["volume-change", "mute-change"]);

const SPEAKER_PATH = "M4 9v6h4l5 5V4L8 9H4z";

const open = ref(false);
const volume = ref(1);
const muted = ref(false);
const rootEl = ref(null);

const isSilent = computed(() => muted.value || volume.value === 0);

function setOpen(next) {
  open.value = next;
}

function onSliderInput(event) {
  volume.value = Math.min(1, Math.max(0, Number(event.target.value) / 100));
  emit("volume-change", volume.value, muted.value);
}

function toggleMute() {
  muted.value = !muted.value;
  emit("mute-change", muted.value, volume.value);
}

function onDocumentClick(event) {
  if (!rootEl.value?.contains(event.target)) setOpen(false);
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick);
});
</script>

<template>
  <div id="volume-control" ref="rootEl" class="volume-control">
    <button
      id="volume-toggle"
      type="button"
      title="Mostrar control de volumen"
      aria-label="Mostrar control de volumen"
      :aria-expanded="open"
      @click.stop="setOpen(!open)"
    >
      <svg v-if="!isSilent" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path class="vc-body" :d="SPEAKER_PATH" fill="#fff" />
        <path
          class="vc-waves"
          d="M16.5 8.5a5 5 0 0 1 0 7"
          stroke-width="1.6"
          stroke-linecap="round"
          fill="none"
        />
        <path
          class="vc-waves"
          d="M19 6a8.5 8.5 0 0 1 0 12"
          stroke-width="1.6"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path class="vc-body" :d="SPEAKER_PATH" fill="#fff" />
        <path
          class="vc-x"
          d="M16.5 9.5l4 5M20.5 9.5l-4 5"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <div id="volume-popover" class="volume-popover" :hidden="!open" @click.stop>
      <input
        id="volume-slider"
        type="range"
        min="0"
        max="100"
        :value="Math.round(volume * 100)"
        aria-label="Volumen"
        orient="vertical"
        @input="onSliderInput"
      >
      <button
        id="mute-toggle"
        type="button"
        :title="muted ? 'Activar sonido' : 'Silenciar'"
        :aria-label="muted ? 'Activar sonido' : 'Silenciar'"
        @click="toggleMute"
      >
        <svg v-if="!isSilent" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path class="vc-body" :d="SPEAKER_PATH" fill="#fff" />
          <path
            class="vc-waves"
            d="M16.5 8.5a5 5 0 0 1 0 7"
            stroke-width="1.6"
            stroke-linecap="round"
            fill="none"
          />
          <path
            class="vc-waves"
            d="M19 6a8.5 8.5 0 0 1 0 12"
            stroke-width="1.6"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path class="vc-body" :d="SPEAKER_PATH" fill="#fff" />
          <path
            class="vc-x"
            d="M16.5 9.5l4 5M20.5 9.5l-4 5"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>
