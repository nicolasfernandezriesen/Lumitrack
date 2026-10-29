<script setup>
import { onMounted, ref } from "vue";
import "../styles/views/visualizer.css";

const props = defineProps({
  barCount: { type: Number, required: true },
});

const barsWrapEl = ref(null);
/** @type {HTMLElement[]} */
let bars = [];

onMounted(() => {
  const wrap = barsWrapEl.value;
  if (!wrap) return;
  wrap.replaceChildren();
  bars = [];
  for (let i = 0; i < props.barCount; i++) {
    const bar = document.createElement("div");
    bar.className = "bar";
    wrap.appendChild(bar);
    bars.push(bar);
  }
});

function setLevels(levels) {
  for (let i = 0; i < bars.length; i++) {
    bars[i].style.height = levels[i] + "%";
  }
}

function applyPalette(dominant, accent2) {
  document.documentElement.style.setProperty(
    "--glow",
    `${dominant.r}, ${dominant.g}, ${dominant.b}`,
  );
  document.documentElement.style.setProperty(
    "--accent",
    `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`,
  );
  document.documentElement.style.setProperty(
    "--accent-2",
    `rgb(${accent2.r}, ${accent2.g}, ${accent2.b})`,
  );
}

defineExpose({ setLevels, applyPalette });
</script>

<template>
  <div id="bars-wrap" ref="barsWrapEl"></div>
</template>
