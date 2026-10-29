<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import "../styles/views/updater-modal.css";

const props = defineProps({
  api: { type: Object, required: true },
});

const HIGHLIGHT_ICONS = ["✦", "♪", "◈"];
const INSTALL_COUNTDOWN_SEC = 5;

const visible = ref(false);
const isOpen = ref(false);
const mode = ref(null);
const updaterState = ref(null);
const busy = ref(false);
const countdownLeft = ref(INSTALL_COUNTDOWN_SEC);

let countdownTimer = null;
let unsub = () => {};

const highlights = computed(() => {
  const list = updaterState.value?.highlights;
  if (list?.length) return list;
  return [
    {
      title: "Novedades de esta versión",
      body: "Mejoras y correcciones listas para instalar.",
    },
  ];
});

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function openOverlay() {
  visible.value = true;
  requestAnimationFrame(() => {
    isOpen.value = true;
  });
}

function closeOverlay() {
  isOpen.value = false;
  window.setTimeout(() => {
    if (!isOpen.value) visible.value = false;
  }, 220);
}

function startCountdown() {
  clearCountdown();
  countdownLeft.value = INSTALL_COUNTDOWN_SEC;
  countdownTimer = setInterval(() => {
    countdownLeft.value -= 1;
    if (countdownLeft.value <= 0) {
      clearCountdown();
      void doInstall();
    }
  }, 1000);
}

async function dismiss() {
  if (mode.value === "install") {
    await doInstall();
    return;
  }
  try {
    await props.api.dismiss();
  } catch {
    /* ignore */
  }
  closeOverlay();
  mode.value = null;
}

async function startDownload() {
  if (busy.value) return;
  busy.value = true;
  try {
    await props.api.download();
    closeOverlay();
    mode.value = null;
  } catch (err) {
    console.error("Download update failed:", err);
  } finally {
    busy.value = false;
  }
}

async function doInstall() {
  if (busy.value) return;
  busy.value = true;
  clearCountdown();
  try {
    await props.api.install();
  } catch (err) {
    console.error("Install update failed:", err);
    busy.value = false;
  }
}

function sync(state) {
  updaterState.value = state;
  if (state?.shouldShowInstallModal) {
    if (mode.value !== "install") {
      mode.value = "install";
      openOverlay();
      startCountdown();
    }
    return;
  }
  if (state?.shouldShowUpdateModal) {
    if (mode.value !== "available") {
      mode.value = "available";
      clearCountdown();
      openOverlay();
    }
    return;
  }
  if (mode.value === "available") {
    closeOverlay();
    mode.value = null;
  }
}

function onOverlayClick(event) {
  if (event.target === event.currentTarget && mode.value === "available") {
    void dismiss();
  }
}

function onKeyDown(event) {
  if (event.key === "Escape" && mode.value === "available") void dismiss();
}

watch(mode, (next) => {
  if (next !== "install") clearCountdown();
});

onMounted(() => {
  document.addEventListener("keydown", onKeyDown);
  unsub = props.api.onStatus(sync);
  void props.api.getState().then(sync).catch(() => {});
});

onUnmounted(() => {
  clearCountdown();
  unsub();
  document.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="updater-overlay"
      :class="{ 'is-open': isOpen }"
      :hidden="!visible"
      @click="onOverlayClick"
    >
      <div
        class="updater-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="updater-title"
        @click.stop
      >
        <div class="updater-header">
          <div class="updater-brand-icon" aria-hidden="true"><span></span></div>
          <p class="updater-brand-title">LUMITRACK UPDATER</p>
          <button
            type="button"
            class="updater-close"
            aria-label="Cerrar"
            @click="dismiss"
          >
            ×
          </button>
        </div>

        <template v-if="mode === 'available' && updaterState">
          <div class="updater-version-row">
            <div class="updater-version-pill">
              <span class="dot" aria-hidden="true"></span>
              <strong>v{{ updaterState.version || "—" }} disponible</strong>
              <span class="sep" aria-hidden="true"></span>
              <span class="current"
                >Actual: v{{ updaterState.currentVersion || "—" }}</span
              >
            </div>
          </div>
          <div class="updater-copy">
            <h2 id="updater-title">¡Nueva versión disponible!</h2>
            <p>
              Hay una actualización lista para instalar con optimizaciones clave.
            </p>
          </div>
          <div class="updater-highlights">
            <div
              v-for="(item, i) in highlights"
              :key="`${item.title}-${i}`"
              class="updater-highlight"
            >
              <div class="updater-highlight-icon" aria-hidden="true">
                {{ HIGHLIGHT_ICONS[i % HIGHLIGHT_ICONS.length] }}
              </div>
              <div>
                <h3>{{ item.title }}</h3>
                <p>{{ item.body }}</p>
              </div>
            </div>
          </div>
          <p class="updater-prompt">¿Deseas actualizar ahora?</p>
          <div class="updater-actions">
            <button
              type="button"
              class="updater-btn updater-btn-later"
              :disabled="busy"
              @click="dismiss"
            >
              Más tarde
            </button>
            <button
              type="button"
              class="updater-btn updater-btn-primary"
              :disabled="busy"
              @click="startDownload"
            >
              <span aria-hidden="true">⬇</span> Sí, actualizar
            </button>
          </div>
          <button
            type="button"
            class="updater-changelog"
            @click="api.openChangelog?.()"
          >
            Ver registro de cambios completo en GitHub
            <span aria-hidden="true">↗</span>
          </button>
        </template>

        <template v-else-if="mode === 'install' && updaterState">
          <div class="updater-version-row">
            <div class="updater-version-pill">
              <span class="dot" aria-hidden="true"></span>
              <strong>v{{ updaterState.version || "—" }} lista</strong>
            </div>
          </div>
          <div class="updater-copy">
            <h2 id="updater-title">Actualización descargada</h2>
            <p>
              La app se cerrará en
              <strong>{{ countdownLeft }}</strong> segundos para instalar la
              nueva versión y volverá a abrirse sola.
            </p>
          </div>
          <p class="updater-countdown">{{ countdownLeft }}</p>
          <div class="updater-actions single">
            <button
              type="button"
              class="updater-btn updater-btn-primary"
              :disabled="busy"
              @click="doInstall"
            >
              Cerrar e instalar ahora
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
