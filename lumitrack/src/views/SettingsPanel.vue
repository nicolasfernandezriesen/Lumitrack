<script setup>
import "../styles/views/settings-panel.css";

defineProps({
  open: { type: Boolean, default: false },
});
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
    <h2>Configuracion</h2>
    <p>Aca ira la configuracion de la APP</p>
  </div>
</template>
