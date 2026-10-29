import { searchTracks } from "../services/searchApi.js";

const DEBOUNCE_MS = 450;
const AUTO_HIDE_MS = 6000;

export function createSearchPanel({
  panelEl,
  toggleBtnEl,
  inputEl,
  statusEl,
  resultsListEl,
  onOpenChange,
  onTrackSelected,
  onTrackPlayNext,
}) {
  let debounceTimer = null;
  let contextMenuEl = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function closeContextMenu() {
    if (!contextMenuEl) return;
    contextMenuEl.remove();
    contextMenuEl = null;
    document.removeEventListener("pointerdown", handleOutsidePointerDown);
    document.removeEventListener("keydown", handleContextMenuKeyDown);
    document.removeEventListener("scroll", closeContextMenu, true);
    window.removeEventListener("resize", closeContextMenu);
  }

  function handleOutsidePointerDown(event) {
    if (!contextMenuEl?.contains(event.target)) closeContextMenu();
  }

  function handleContextMenuKeyDown(event) {
    if (event.key === "Escape") closeContextMenu();
  }

  function openContextMenu(event, track) {
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "search-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Opciones para ${track.title || "canción"}`);

    const playNextButton = document.createElement("button");
    playNextButton.type = "button";
    playNextButton.className = "search-context-menu-item";
    playNextButton.setAttribute("role", "menuitem");
    playNextButton.textContent = "Reproducir a continuación";
    playNextButton.addEventListener("click", () => {
      closeContextMenu();
      onTrackPlayNext?.(track);
    });
    menu.appendChild(playNextButton);

    menu.style.visibility = "hidden";
    document.body.appendChild(menu);
    contextMenuEl = menu;

    const { width, height } = menu.getBoundingClientRect();
    const left =
      event.clientX + width <= window.innerWidth
        ? event.clientX
        : event.clientX - width;
    const top = Math.min(
      Math.max(0, event.clientY),
      Math.max(0, window.innerHeight - height),
    );
    menu.style.left = `${Math.min(Math.max(0, left), Math.max(0, window.innerWidth - width))}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "";
    playNextButton.focus();

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    document.addEventListener("keydown", handleContextMenuKeyDown);
    document.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("resize", closeContextMenu);
  }

  function renderResults(results) {
    closeContextMenu();
    resultsListEl.innerHTML = "";
    results.forEach((track) => {
      const btn = document.createElement("button");
      btn.className = "result-item";
      btn.innerHTML = `
        <img src="${track.thumbnail}" alt="" loading="lazy">
        <div class="result-info">
          <div class="result-title">${escapeHtml(track.title)}</div>
          <div class="result-artist">${escapeHtml(track.artist)}</div>
        </div>
      `;
      btn.addEventListener("click", () => onTrackSelected(track));
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openContextMenu(event, track);
      });
      resultsListEl.appendChild(btn);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function runSearch(query) {
    try {
      const results = await searchTracks(query);
      renderResults(results);
      setStatus(results.length ? "" : "Sin resultados.");
    } catch (err) {
      closeContextMenu();
      setStatus("Error: " + err.message);
      resultsListEl.innerHTML = "";
    }
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    closeContextMenu();
    const q = inputEl.value.trim();
    if (!q) {
      resultsListEl.innerHTML = "";
      setStatus("");
      return;
    }
    setStatus("Buscando…");
    debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  }

  function setOpen(isOpen) {
    panelEl.classList.toggle("hidden", !isOpen);
    panelEl.setAttribute("aria-hidden", String(!isOpen));
    toggleBtnEl.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) closeContextMenu();
  }

  function toggle() {
    const isOpen = panelEl.classList.contains("hidden");
    setOpen(isOpen);
    onOpenChange?.(isOpen);
  }

  function init() {
    inputEl.addEventListener("input", handleInput);
    toggleBtnEl.addEventListener("click", toggle);
    panelEl.addEventListener("click", (event) => {
      if (event.target === panelEl) closeContextMenu();
    });

    const hideTimer = setTimeout(() => setOpen(false), AUTO_HIDE_MS);
    panelEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  }

  return { init, setOpen, setStatus };
}
