<script setup>
import "../styles/views/panel-actions.css";

defineProps({
  searchOpen: { type: Boolean, default: false },
  settingsOpen: { type: Boolean, default: false },
});

const emit = defineEmits(["toggle-search", "toggle-settings"]);
</script>

<template>
  <div id="panel-actions">
    <button
      id="toggle-search"
      class="panel-action"
      type="button"
      title="Buscar"
      aria-label="Buscar"
      aria-controls="panel"
      :aria-expanded="searchOpen"
      @click="emit('toggle-search')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.2"></circle>
        <path d="m15.4 15.4 4.1 4.1"></path>
      </svg>
    </button>
    <button
      id="toggle-settings"
      class="panel-action"
      type="button"
      title="Configuración"
      aria-label="Configuración"
      aria-controls="settings-panel"
      :aria-expanded="settingsOpen"
      @click="emit('toggle-settings')"
    >
      <span aria-hidden="true">⚙</span>
    </button>
  </div>
</template>
