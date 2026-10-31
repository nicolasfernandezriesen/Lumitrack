<script setup>
import "../styles/views/settings-panel.css";

defineProps({
  open: { type: Boolean, default: false },
  showFps: { type: Boolean, default: false },
});

const emit = defineEmits(["toggle-fps"]);
</script>

<template>
  <div
    id="settings-panel"
    class="top-panel"
    :class="{ hidden: !open }"
    role="dialog"
    aria-label="Configuración"
    :aria-hidden="!open"
  >
    <h2>Configuración</h2>
    <div class="setting-row">
      <div class="setting-copy">
        <span class="setting-label">Mostrar FPS</span>
      </div>
      <div class="setting-controls">
        <span class="setting-help">
          <button
            class="setting-help-button"
            type="button"
            aria-label="Información sobre Mostrar FPS"
            aria-describedby="fps-setting-description"
          >
            i
          </button>
          <span
            id="fps-setting-description"
            class="setting-tooltip"
            role="tooltip"
          >
            Ver los fotogramas por segundo en tiempo real.
          </span>
        </span>
        <button
          class="setting-switch"
          :class="{ 'is-on': showFps }"
          type="button"
          role="switch"
          aria-label="Mostrar FPS"
          :aria-checked="showFps"
          @click="emit('toggle-fps', !showFps)"
        >
          <span class="setting-switch-thumb"></span>
        </button>
      </div>
    </div>
  </div>
</template>
