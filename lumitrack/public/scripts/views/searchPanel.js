import { searchTracks } from "../services/searchApi.js";

const DEBOUNCE_MS = 450;
const AUTO_HIDE_MS = 6000;

export function createSearchPanel({
  panelEl,
  toggleBtnEl,
  inputEl,
  statusEl,
  resultsListEl,
  onTrackSelected,
}) {
  let debounceTimer = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function renderResults(results) {
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
      setStatus("Error: " + err.message);
      resultsListEl.innerHTML = "";
    }
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    const q = inputEl.value.trim();
    if (!q) {
      resultsListEl.innerHTML = "";
      setStatus("");
      return;
    }
    setStatus("Buscando…");
    debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  }

  function toggle() {
    panelEl.classList.toggle("hidden");
  }

  function init() {
    inputEl.addEventListener("input", handleInput);
    toggleBtnEl.addEventListener("click", toggle);

    const hideTimer = setTimeout(() => panelEl.classList.add("hidden"), AUTO_HIDE_MS);
    panelEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  }

  return { init, setStatus };
}
