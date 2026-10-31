<script setup>
import { onMounted, onUnmounted, ref, watch } from "vue";
import Visualizer from "./views/Visualizer.vue";
import NowPlaying from "./views/NowPlaying.vue";
import PlayerControls from "./views/PlayerControls.vue";
import VolumeControl from "./views/VolumeControl.vue";
import FullscreenToggle from "./views/FullscreenToggle.vue";
import PanelActions from "./views/PanelActions.vue";
import SearchPanel from "./views/SearchPanel.vue";
import SettingsPanel from "./views/SettingsPanel.vue";
import PlaylistPanel from "./views/PlaylistPanel.vue";
import PlaylistDetailModal from "./views/PlaylistDetailModal.vue";
import AlbumDetailModal from "./views/AlbumDetailModal.vue";
import ArtistDetailModal from "./views/ArtistDetailModal.vue";
import UpdaterModal from "./views/UpdaterModal.vue";
import { usePlayback } from "./composables/usePlayback.js";
import { useUiShell } from "./composables/useUiShell.js";
import { getUpdaterApi } from "./services/updaterClient.js";
import {
  fetchAlbum,
  fetchArtist,
  fetchPlaylist,
} from "./services/searchApi.js";

const visualizerRef = ref(null);
const searchPanelRef = ref(null);
const playlistPanelRef = ref(null);
const playlistDetailOpen = ref(false);
const playlistDetail = ref(null);
const playlistDetailLoading = ref(false);
const playlistDetailError = ref("");
const albumDetailOpen = ref(false);
const albumDetail = ref(null);
const albumDetailLoading = ref(false);
const albumDetailError = ref("");
const artistDetailOpen = ref(false);
const artistDetail = ref(null);
const artistDetailLoading = ref(false);
const artistDetailError = ref("");
const updaterApi = getUpdaterApi();
const showFps = ref(false);
const fps = ref(0);
let playlistRequestSequence = 0;
let fpsAnimationFrame = null;
let fpsFrameCount = 0;
let fpsSampleStartedAt = 0;

const {
  searchOpen,
  settingsOpen,
  playlistOpen,
  searchStatus,
  toggleSearch,
  toggleSettings,
  togglePlaylist,
  setPlaylistOpen,
  setSearchStatus,
} = useUiShell();

const {
  BAR_COUNT,
  playlistSnap,
  playbackState,
  progress,
  currentTrack,
  loading,
  handleTrackSelected,
  handlePlaylistSelected: playPlaylistTracks,
  handleTrackPlayNext,
  handlePlayButtonClick,
  handlePrevClick,
  handleNextClick,
  setVolume,
  seek,
  removeTrack,
  applyCoverPalette,
} = usePlayback({
  getVisualizer: () => visualizerRef.value,
});

async function handlePlaylistSelected(playlist) {
  const sequence = ++playlistRequestSequence;
  if (!playlist?.playlistId) {
    setSearchStatus("Error: No se pudo identificar la playlist.");
    return;
  }
  setSearchStatus("Cargando playlist…");
  try {
    const details = await fetchPlaylist(
      playlist.playlistId,
      playlist.creator || "",
    );
    if (sequence !== playlistRequestSequence) return;
    if (!details.tracks.length) {
      throw new Error("La playlist no contiene canciones disponibles.");
    }
    setSearchStatus("");
    await handlePlaylistPlayback(details.tracks, 0);
  } catch (err) {
    if (sequence !== playlistRequestSequence) return;
    setSearchStatus("Error: " + err.message);
  }
}

async function handleAlbumSelected(album) {
  const sequence = ++playlistRequestSequence;
  if (!album?.albumId) {
    setSearchStatus("Error: No se pudo identificar el álbum.");
    return;
  }
  setSearchStatus("Cargando álbum…");
  try {
    const details = await fetchAlbum(album.albumId);
    if (sequence !== playlistRequestSequence) return;
    if (!details.tracks.length) {
      throw new Error("El álbum no contiene canciones disponibles.");
    }
    setSearchStatus("");
    await handlePlaylistPlayback(details.tracks, 0);
  } catch (err) {
    if (sequence !== playlistRequestSequence) return;
    setSearchStatus("Error: " + err.message);
  }
}

async function loadArtistDetails(artist) {
  if (!artist?.artistId) {
    throw new Error("No se pudo identificar el artista.");
  }
  return fetchArtist(artist.artistId);
}

async function handleArtistSelected(artist) {
  const sequence = ++playlistRequestSequence;
  setSearchStatus("Cargando canciones del artista…");
  try {
    const details = await loadArtistDetails(artist);
    if (sequence !== playlistRequestSequence) return;
    if (!details.tracks.length) {
      throw new Error("El artista no tiene canciones disponibles.");
    }
    setSearchStatus("");
    await handlePlaylistPlayback(details.tracks, 0);
  } catch (err) {
    if (sequence !== playlistRequestSequence) return;
    setSearchStatus("Error: " + err.message);
  }
}

async function openArtistDetails(artist) {
  const sequence = ++playlistRequestSequence;
  artistDetailOpen.value = true;
  artistDetail.value = { ...artist, tracks: [] };
  artistDetailLoading.value = true;
  artistDetailError.value = "";
  try {
    const details = await loadArtistDetails(artist);
    if (sequence !== playlistRequestSequence) return;
    artistDetail.value = details;
    if (!details.tracks.length) {
      artistDetailError.value = "El artista no tiene canciones disponibles.";
    }
  } catch (err) {
    if (sequence !== playlistRequestSequence) return;
    artistDetailError.value = err.message;
  } finally {
    if (sequence === playlistRequestSequence) {
      artistDetailLoading.value = false;
    }
  }
}

function closeArtistDetails() {
  playlistRequestSequence += 1;
  artistDetailOpen.value = false;
  artistDetailLoading.value = false;
}

async function handleArtistDetailTrackSelected(index) {
  const tracks = artistDetail.value?.tracks;
  if (!tracks?.[index]) return;
  closeArtistDetails();
  await handlePlaylistPlayback(tracks, index);
}

async function openAlbumDetails(album) {
  const sequence = ++playlistRequestSequence;
  albumDetailOpen.value = true;
  albumDetail.value = { ...album, tracks: [] };
  albumDetailLoading.value = true;
  albumDetailError.value = "";
  if (!album?.albumId) {
    albumDetailError.value = "No se pudo identificar el álbum.";
    albumDetailLoading.value = false;
    return;
  }
  try {
    const details = await fetchAlbum(album.albumId);
    if (sequence !== playlistRequestSequence) return;
    albumDetail.value = details;
    if (!details.tracks.length) {
      albumDetailError.value = "El álbum no contiene canciones disponibles.";
    }
  } catch (err) {
    if (sequence !== playlistRequestSequence) return;
    albumDetailError.value = err.message;
  } finally {
    if (sequence === playlistRequestSequence) {
      albumDetailLoading.value = false;
    }
  }
}

function closeAlbumDetails() {
  playlistRequestSequence += 1;
  albumDetailOpen.value = false;
  albumDetailLoading.value = false;
}

async function handleAlbumDetailTrackSelected(index) {
  const tracks = albumDetail.value?.tracks;
  if (!tracks?.[index]) return;
  closeAlbumDetails();
  await handlePlaylistPlayback(tracks, index);
}

async function openPlaylistDetails(playlist) {
  const sequence = ++playlistRequestSequence;
  playlistDetailOpen.value = true;
  playlistDetail.value = { ...playlist, tracks: [] };
  playlistDetailLoading.value = true;
  playlistDetailError.value = "";
  if (!playlist?.playlistId) {
    playlistDetailError.value = "No se pudo identificar la playlist.";
    playlistDetailLoading.value = false;
    return;
  }
  try {
    const details = await fetchPlaylist(
      playlist.playlistId,
      playlist.creator || "",
    );
    if (sequence !== playlistRequestSequence) return;
    playlistDetail.value = details;
    if (!details.tracks.length) {
      playlistDetailError.value = "La playlist no contiene canciones disponibles.";
    }
  } catch (err) {
    if (sequence !== playlistRequestSequence) return;
    playlistDetailError.value = err.message;
  } finally {
    if (sequence === playlistRequestSequence) {
      playlistDetailLoading.value = false;
    }
  }
}

function closePlaylistDetails() {
  playlistRequestSequence += 1;
  playlistDetailOpen.value = false;
  playlistDetailLoading.value = false;
}

async function handlePlaylistDetailTrackSelected(index) {
  const tracks = playlistDetail.value?.tracks;
  if (!tracks?.[index]) return;
  closePlaylistDetails();
  await handlePlaylistPlayback(tracks, index);
}

async function handlePlaylistPlayback(tracks, startIndex) {
  await playPlaylistTracks(tracks, startIndex);
}

function measureFps(now) {
  fpsFrameCount += 1;
  const elapsed = now - fpsSampleStartedAt;
  if (elapsed >= 500) {
    fps.value = Math.round((fpsFrameCount * 1000) / elapsed);
    fpsFrameCount = 0;
    fpsSampleStartedAt = now;
  }
  fpsAnimationFrame = window.requestAnimationFrame(measureFps);
}

watch(showFps, (enabled) => {
  if (enabled) {
    fpsFrameCount = 0;
    fpsSampleStartedAt = performance.now();
    fpsAnimationFrame = window.requestAnimationFrame(measureFps);
  } else if (fpsAnimationFrame !== null) {
    window.cancelAnimationFrame(fpsAnimationFrame);
    fpsAnimationFrame = null;
    fps.value = 0;
  }
});

let touchStartY = null;
let touchStartTarget = null;

function onWheel(event) {
  const searchEl = searchPanelRef.value?.panelEl;
  if (event.target instanceof Node && searchEl?.contains(event.target)) return;
  const detailModal = document.querySelector(".playlist-detail-modal");
  const artistModal = document.querySelector(".artist-detail-modal");
  if (
    event.target instanceof Node &&
    (detailModal?.contains(event.target) || artistModal?.contains(event.target))
  ) return;

  const listEl = playlistPanelRef.value?.listEl;
  const isOpen = playlistOpen.value;
  const scrolledPlaylist =
    event.target instanceof Node && listEl?.contains(event.target);

  if (isOpen && event.deltaY < 0 && !scrolledPlaylist) {
    setPlaylistOpen(false);
  } else if (!isOpen && event.deltaY > 0) {
    setPlaylistOpen(true);
  }
}

function onTouchStart(event) {
  touchStartY = event.touches[0]?.clientY ?? null;
  touchStartTarget = event.target;
}

function onTouchEnd(event) {
  if (touchStartY === null) return;
  const touchEndY = event.changedTouches[0]?.clientY;
  const isOpen = playlistOpen.value;
  const listEl = playlistPanelRef.value?.listEl;
  const searchEl = searchPanelRef.value?.panelEl;
  const startedInPlaylist =
    touchStartTarget instanceof Node && listEl?.contains(touchStartTarget);
  const startedInSearchPanel =
    touchStartTarget instanceof Node && searchEl?.contains(touchStartTarget);
  const detailModal = document.querySelector(".playlist-detail-modal");
  const artistModal = document.querySelector(".artist-detail-modal");
  const startedInPlaylistDetails =
    touchStartTarget instanceof Node &&
    (detailModal?.contains(touchStartTarget) ||
      artistModal?.contains(touchStartTarget));

  if (
    Number.isFinite(touchEndY) &&
    !startedInPlaylist &&
    !startedInSearchPanel &&
    !startedInPlaylistDetails &&
    ((isOpen && touchEndY - touchStartY > 40) ||
      (!isOpen && touchStartY - touchEndY > 40))
  ) {
    setPlaylistOpen(!isOpen);
  }
  touchStartY = null;
  touchStartTarget = null;
}

onMounted(() => {
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener("wheel", onWheel);
  window.removeEventListener("touchstart", onTouchStart);
  window.removeEventListener("touchend", onTouchEnd);
  if (fpsAnimationFrame !== null) {
    window.cancelAnimationFrame(fpsAnimationFrame);
  }
});
</script>

<template>
  <div id="stage">
    <div id="ambient"></div>
    <div id="grain"></div>
    <Visualizer ref="visualizerRef" :bar-count="BAR_COUNT" />
  </div>

  <section id="playback-dock" aria-label="Reproductor y playlist">
    <NowPlaying
      :track="currentTrack"
      :previous="playlistSnap.previous"
      :next="playlistSnap.next"
      :playlist-open="playlistOpen"
      @cover-ready="applyCoverPalette"
      @toggle-playlist="togglePlaylist()"
    >
      <PlayerControls
        :state="playbackState"
        :progress="progress"
        :has-current="!!playlistSnap.current"
        :has-next="playlistSnap.hasNext"
        @play-click="handlePlayButtonClick"
        @prev="handlePrevClick()"
        @next="handleNextClick()"
        @seek="seek"
      />
      <VolumeControl
        @volume-change="setVolume"
        @mute-change="(muted, volume) => setVolume(volume, muted)"
      />
      <FullscreenToggle />
    </NowPlaying>

    <PlaylistPanel
      ref="playlistPanelRef"
      :open="playlistOpen"
      :history="playlistSnap.history"
      :upcoming="playlistSnap.upcoming"
      @play-track="handleTrackSelected"
      @remove="removeTrack"
      @close="setPlaylistOpen(false)"
    />
  </section>

  <PanelActions
    :search-open="searchOpen"
    :settings-open="settingsOpen"
    @toggle-search="toggleSearch()"
    @toggle-settings="toggleSettings()"
  />

  <SearchPanel
    ref="searchPanelRef"
    :open="searchOpen"
    :status="searchStatus"
    @update:status="setSearchStatus"
    @track-selected="handleTrackSelected"
    @track-play-next="handleTrackPlayNext"
    @playlist-selected="handlePlaylistSelected"
    @playlist-detail="openPlaylistDetails"
    @artist-selected="handleArtistSelected"
    @artist-detail="openArtistDetails"
    @album-selected="handleAlbumSelected"
    @album-detail="openAlbumDetails"
  />

  <PlaylistDetailModal
    :open="playlistDetailOpen"
    :playlist="playlistDetail"
    :loading="playlistDetailLoading"
    :error="playlistDetailError"
    @close="closePlaylistDetails"
    @play-track="handlePlaylistDetailTrackSelected"
  />

  <AlbumDetailModal
    :open="albumDetailOpen"
    :album="albumDetail"
    :loading="albumDetailLoading"
    :error="albumDetailError"
    @close="closeAlbumDetails"
    @play-track="handleAlbumDetailTrackSelected"
  />

  <ArtistDetailModal
    :open="artistDetailOpen"
    :artist="artistDetail"
    :loading="artistDetailLoading"
    :error="artistDetailError"
    @close="closeArtistDetails"
    @play-track="handleArtistDetailTrackSelected"
  />

  <SettingsPanel
    :open="settingsOpen"
    :show-fps="showFps"
    @toggle-fps="showFps = $event"
  />

  <div v-if="showFps" id="fps-counter" aria-label="Fotogramas por segundo">
    FPS: {{ fps }}
  </div>
  <div id="loading-indicator" :class="{ active: loading }">
    <span class="spinner"></span><span>Cargando audio…</span>
  </div>
  <div id="status">Beta V.0.5.0</div>

  <UpdaterModal v-if="updaterApi" :api="updaterApi" />
</template>
