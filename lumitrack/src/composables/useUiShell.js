import { computed, ref, watch } from "vue";

/** Panel flotante abierto: null | "search" | "settings" */
const openPanel = ref(null);
const playlistOpen = ref(false);
const searchStatus = ref("");

export function useUiShell() {
  const searchOpen = computed(() => openPanel.value === "search");
  const settingsOpen = computed(() => openPanel.value === "settings");

  function setPanel(panel) {
    openPanel.value = panel;
  }

  function toggleSearch() {
    openPanel.value = openPanel.value === "search" ? null : "search";
  }

  function toggleSettings() {
    openPanel.value = openPanel.value === "settings" ? null : "settings";
  }

  function closePanels() {
    openPanel.value = null;
  }

  function setPlaylistOpen(isOpen) {
    playlistOpen.value = !!isOpen;
  }

  function togglePlaylist() {
    playlistOpen.value = !playlistOpen.value;
  }

  function setSearchStatus(text) {
    searchStatus.value = text || "";
  }

  watch(
    playlistOpen,
    (isOpen) => {
      document.body.classList.toggle("playlist-open", isOpen);
    },
    { immediate: true },
  );

  return {
    openPanel,
    playlistOpen,
    searchStatus,
    searchOpen,
    settingsOpen,
    setPanel,
    toggleSearch,
    toggleSettings,
    closePanels,
    setPlaylistOpen,
    togglePlaylist,
    setSearchStatus,
  };
}
