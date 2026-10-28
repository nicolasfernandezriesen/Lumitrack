function formatDuration(duration) {
  if (!Number.isFinite(duration) || duration < 0) return "";
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function createPlaylistView({
  containerEl,
  panelEl,
  listEl,
  toggleButtonEl,
  onPlayTrack,
  onRemove,
}) {
  let contextMenuEl = null;

  function handlePlaylistOutsidePointerDown(event) {
    if (
      containerEl.contains(event.target) ||
      toggleButtonEl.contains(event.target) ||
      contextMenuEl?.contains(event.target)
    ) {
      return;
    }
    setOpen(false);
  }

  function closeContextMenu() {
    if (!contextMenuEl) return;
    contextMenuEl.remove();
    contextMenuEl = null;
    document.removeEventListener(
      "pointerdown",
      handleContextMenuOutsidePointerDown,
    );
    document.removeEventListener("keydown", handleContextMenuKeyDown);
    document.removeEventListener("scroll", closeContextMenu, true);
    window.removeEventListener("resize", closeContextMenu);
  }

  function handleContextMenuOutsidePointerDown(event) {
    if (!contextMenuEl?.contains(event.target)) closeContextMenu();
  }

  function handleContextMenuKeyDown(event) {
    if (event.key === "Escape") closeContextMenu();
  }

  function openContextMenu(event, track) {
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "playlist-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute(
      "aria-label",
      `Opciones para ${track.title || "canción"}`,
    );

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "playlist-context-menu-item";
    removeButton.setAttribute("role", "menuitem");
    removeButton.textContent = "Quitar cancion";
    removeButton.addEventListener("click", () => {
      closeContextMenu();
      onRemove(track.videoId);
    });
    menu.appendChild(removeButton);

    menu.style.visibility = "hidden";
    document.body.appendChild(menu);
    contextMenuEl = menu;

    const { width, height } = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - width - 8);
    const top = Math.min(event.clientY, window.innerHeight - height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.visibility = "";
    removeButton.focus();

    document.addEventListener(
      "pointerdown",
      handleContextMenuOutsidePointerDown,
    );
    document.addEventListener("keydown", handleContextMenuKeyDown);
    document.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("resize", closeContextMenu);
  }

  function setTracks({ history, upcoming }) {
    closeContextMenu();
    listEl.replaceChildren();

    if (!history.length && !upcoming.length) {
      const empty = document.createElement("li");
      empty.className = "playlist-empty";
      empty.textContent = "No hay canciones en cola";
      listEl.appendChild(empty);
      return;
    }

    function appendTracks(tracks, sectionLabel) {
      if (!tracks.length) return;

      const heading = document.createElement("li");
      heading.className = "playlist-section-heading";
      heading.textContent = sectionLabel;
      listEl.appendChild(heading);

      tracks.forEach((track, index) => {
        const item = document.createElement("li");
        item.className = "playlist-item";

        const number = document.createElement("span");
        number.className = "playlist-item-number";
        number.textContent = String(index + 1).padStart(2, "0");

        const coverButton = document.createElement("button");
        coverButton.type = "button";
        coverButton.className = "playlist-item-cover-button";
        coverButton.setAttribute(
          "aria-label",
          `Reproducir ${track.title || "canción"}`,
        );
        coverButton.addEventListener("click", () => onPlayTrack(track));

        const image = document.createElement("img");
        image.className = "playlist-item-cover";
        image.src = track.thumbnail || "";
        image.alt = "";
        image.loading = "lazy";
        coverButton.appendChild(image);

        const info = document.createElement("div");
        info.className = "playlist-item-info";

        const title = document.createElement("span");
        title.className = "playlist-item-title";
        title.textContent = track.title || "Sin título";
        title.title = title.textContent;

        const artist = document.createElement("span");
        artist.className = "playlist-item-artist";
        artist.textContent = track.artist || "Desconocido";
        artist.title = artist.textContent;
        info.append(title, artist);

        const duration = document.createElement("span");
        duration.className = "playlist-item-duration";
        duration.textContent = formatDuration(track.duration);

        const menuButton = document.createElement("button");
        menuButton.type = "button";
        menuButton.className = "playlist-item-menu";
        menuButton.textContent = "⋮";
        menuButton.title = "Opciones";
        menuButton.setAttribute(
          "aria-label",
          `Opciones para ${track.title || "canción"}`,
        );
        menuButton.setAttribute("aria-haspopup", "menu");
        menuButton.addEventListener("click", (event) => {
          event.stopPropagation();
          openContextMenu(event, track);
        });

        item.append(number, coverButton, info, duration, menuButton);
        listEl.appendChild(item);
      });
    }

    appendTracks(history.slice().reverse(), "Escuchadas");
    appendTracks(upcoming, "A continuación");
  }

  function setOpen(isOpen) {
    document.body.classList.toggle("playlist-open", isOpen);
    panelEl.setAttribute("aria-hidden", String(!isOpen));
    toggleButtonEl.setAttribute("aria-expanded", String(isOpen));
    toggleButtonEl.setAttribute(
      "aria-label",
      isOpen ? "Ocultar playlist" : "Mostrar playlist",
    );
    if (!isOpen) closeContextMenu();
    document.removeEventListener(
      "pointerdown",
      handlePlaylistOutsidePointerDown,
    );
    if (isOpen) {
      document.addEventListener(
        "pointerdown",
        handlePlaylistOutsidePointerDown,
      );
    }
  }

  return { setTracks, setOpen };
}
