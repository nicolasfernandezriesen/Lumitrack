const HIGHLIGHT_ICONS = ["✦", "♪", "◈"];

const INSTALL_COUNTDOWN_SEC = 5;

/**
 * Update / install modals matching the Lumitrack updater design.
 */
export function createUpdaterModal({ rootEl, api }) {
  if (!api) return { init() {}, destroy() {} };

  const overlay = document.createElement("div");
  overlay.className = "updater-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="updater-modal" role="dialog" aria-modal="true" aria-labelledby="updater-title">
      <div class="updater-header">
        <div class="updater-brand-icon" aria-hidden="true"><span></span></div>
        <p class="updater-brand-title">LUMITRACK UPDATER</p>
        <button type="button" class="updater-close" data-action="close" aria-label="Cerrar">×</button>
      </div>
      <div data-slot="body"></div>
    </div>
  `;
  rootEl.appendChild(overlay);

  const bodyEl = overlay.querySelector("[data-slot='body']");
  const modalEl = overlay.querySelector(".updater-modal");

  let mode = null; // 'available' | 'install'
  let latestState = null;
  let busy = false;
  let countdownTimer = null;
  let countdownLeft = INSTALL_COUNTDOWN_SEC;
  let unsub = () => {};

  function openOverlay() {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("is-open"));
  }

  function closeOverlay() {
    overlay.classList.remove("is-open");
    window.setTimeout(() => {
      if (!overlay.classList.contains("is-open")) overlay.hidden = true;
    }, 220);
  }

  function clearCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderAvailable(state) {
    mode = "available";
    clearCountdown();
    const version = state.version || "—";
    const current = state.currentVersion || "—";
    const highlights = (state.highlights?.length ? state.highlights : [
      {
        title: "Novedades de esta versión",
        body: "Mejoras y correcciones listas para instalar.",
      },
    ]).slice(0, 3);

    bodyEl.innerHTML = `
      <div class="updater-version-row">
        <div class="updater-version-pill">
          <span class="dot" aria-hidden="true"></span>
          <strong>v${escapeHtml(version)} disponible</strong>
          <span class="sep" aria-hidden="true"></span>
          <span class="current">Actual: v${escapeHtml(current)}</span>
        </div>
      </div>
      <div class="updater-copy">
        <h2 id="updater-title">¡Nueva versión disponible!</h2>
        <p>Hay una actualización lista para instalar con optimizaciones clave.</p>
      </div>
      <div class="updater-highlights">
        ${highlights
          .map(
            (item, i) => `
          <div class="updater-highlight">
            <div class="updater-highlight-icon" aria-hidden="true">${HIGHLIGHT_ICONS[i % HIGHLIGHT_ICONS.length]}</div>
            <div>
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.body)}</p>
            </div>
          </div>`
          )
          .join("")}
      </div>
      <p class="updater-prompt">¿Deseas actualizar ahora?</p>
      <div class="updater-actions">
        <button type="button" class="updater-btn updater-btn-later" data-action="later">Más tarde</button>
        <button type="button" class="updater-btn updater-btn-primary" data-action="update">
          <span aria-hidden="true">⬇</span> Sí, actualizar
        </button>
      </div>
      <button type="button" class="updater-changelog" data-action="changelog">
        Ver registro de cambios completo en GitHub <span aria-hidden="true">↗</span>
      </button>
    `;
    openOverlay();
  }

  function renderInstall(state) {
    mode = "install";
    const version = state.version || "—";
    countdownLeft = INSTALL_COUNTDOWN_SEC;

    bodyEl.innerHTML = `
      <div class="updater-version-row">
        <div class="updater-version-pill">
          <span class="dot" aria-hidden="true"></span>
          <strong>v${escapeHtml(version)} lista</strong>
        </div>
      </div>
      <div class="updater-copy">
        <h2 id="updater-title">Actualización descargada</h2>
        <p>La app se cerrará en <strong data-countdown-label>${countdownLeft}</strong> segundos para instalar la nueva versión y volverá a abrirse sola.</p>
      </div>
      <p class="updater-countdown" data-countdown>${countdownLeft}</p>
      <div class="updater-actions single">
        <button type="button" class="updater-btn updater-btn-primary" data-action="install-now">
          Cerrar e instalar ahora
        </button>
      </div>
    `;
    openOverlay();
    startCountdown();
  }

  function startCountdown() {
    clearCountdown();
    const paint = () => {
      const numEl = bodyEl.querySelector("[data-countdown]");
      const labelEl = bodyEl.querySelector("[data-countdown-label]");
      if (numEl) numEl.textContent = String(countdownLeft);
      if (labelEl) labelEl.textContent = String(countdownLeft);
    };
    paint();
    countdownTimer = setInterval(() => {
      countdownLeft -= 1;
      paint();
      if (countdownLeft <= 0) {
        clearCountdown();
        void doInstall();
      }
    }, 1000);
  }

  async function dismiss() {
    if (mode === "install") {
      await doInstall();
      return;
    }
    try {
      await api.dismiss();
    } catch {
      /* ignore */
    }
    closeOverlay();
    mode = null;
  }

  async function startDownload() {
    if (busy) return;
    busy = true;
    setActionsDisabled(true);
    try {
      await api.download();
      closeOverlay();
      mode = null;
    } catch (err) {
      console.error("Download update failed:", err);
      setActionsDisabled(false);
    } finally {
      busy = false;
    }
  }

  async function doInstall() {
    if (busy) return;
    busy = true;
    clearCountdown();
    setActionsDisabled(true);
    try {
      await api.install();
    } catch (err) {
      console.error("Install update failed:", err);
      busy = false;
      setActionsDisabled(false);
    }
  }

  function setActionsDisabled(disabled) {
    for (const btn of bodyEl.querySelectorAll("button")) {
      btn.disabled = disabled;
    }
  }

  function sync(state) {
    latestState = state;
    if (state?.shouldShowInstallModal) {
      if (mode !== "install") renderInstall(state);
      return;
    }
    if (state?.shouldShowUpdateModal) {
      if (mode !== "available") renderAvailable(state);
      return;
    }
    if (mode === "available") {
      closeOverlay();
      mode = null;
    }
  }

  function onClick(event) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "close" || action === "later") void dismiss();
    else if (action === "update") void startDownload();
    else if (action === "install-now") void doInstall();
    else if (action === "changelog") void api.openChangelog?.();
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && mode === "available") void dismiss();
  }

  function init() {
    modalEl.addEventListener("click", onClick);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && mode === "available") void dismiss();
    });
    document.addEventListener("keydown", onKeyDown);
    unsub = api.onStatus(sync);
    void api.getState().then(sync).catch(() => {});
  }

  function destroy() {
    clearCountdown();
    unsub();
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  }

  return { init, destroy, sync };
}
