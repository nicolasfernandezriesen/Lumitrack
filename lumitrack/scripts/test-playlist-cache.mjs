import assert from "node:assert/strict";
import * as audioCache from "../server/infrastructure/audioCache.js";
import * as playlistUrlCache from "../server/infrastructure/playlistUrlCache.js";
import { createPlaylistController } from "../public/scripts/services/playlist.js";

function buf(label) {
  return Buffer.from(label);
}

audioCache.clear();
playlistUrlCache.clear();

// --- audioCache: historial + actual + next ---
audioCache.markCurrent("aaa11111111");
audioCache.set("aaa11111111", buf("a"), "audio/webm", "current");
assert.equal(audioCache.has("aaa11111111"), true);

audioCache.markCurrent("bbb22222222");
audioCache.set("bbb22222222", buf("b"), "audio/webm", "current");
assert.equal(
  audioCache.has("aaa11111111"),
  true,
  "historial conserva la anterior",
);
assert.equal(audioCache.has("bbb22222222"), true);

audioCache.markNext("ccc33333333");
audioCache.set("ccc33333333", buf("c"), "audio/webm", "next");
assert.equal(audioCache.has("ccc33333333"), true);

for (const id of ["ddd44444444", "eee55555555", "fff66666666", "ggg77777777"]) {
  audioCache.markCurrent(id);
  audioCache.set(id, buf(id), "audio/webm", "current");
}

assert.ok(
  audioCache.size() <= 4,
  `size=${audioCache.size()} no debe crecer sin límite`,
);
assert.equal(
  audioCache.has("aaa11111111"),
  false,
  "conserva solo dos pistas escuchadas",
);
assert.equal(audioCache.has("ggg77777777"), true);

audioCache.markNext("hhh88888888");
audioCache.set("hhh88888888", buf("old next"), "audio/webm", "next");
audioCache.discardNext("hhh88888888");
assert.equal(
  audioCache.has("hhh88888888"),
  false,
  "la siguiente reemplazada sale de caché",
);
assert.equal(audioCache.getNextId(), null);

globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ results: [] }),
});
const playlist = createPlaylistController();
const current = { videoId: "cur00000001", title: "Actual" };
const generatedNext = { videoId: "gen00000001", title: "Generada" };
const selectedNext = { videoId: "sel00000001", title: "Elegida" };
await playlist.playFromSelection(current);
playlist.playNext(generatedNext);
playlist.playNext(selectedNext);
assert.deepEqual(
  playlist.snapshot().upcoming.map((track) => track.videoId),
  [selectedNext.videoId, generatedNext.videoId],
  "la elegida pasa al frente sin perder la cola generada",
);
assert.equal((await playlist.goNext()).videoId, selectedNext.videoId);
assert.equal(playlist.peekNext().videoId, generatedNext.videoId);
playlist.removeTrack(generatedNext.videoId);
assert.equal(
  playlist.snapshot().upcoming.length,
  0,
  "la canción se quita de la cola",
);

const queueSelection = createPlaylistController();
await queueSelection.playFromSelection(current);
const queuedTracks = Array.from({ length: 5 }, (_, index) => ({
  videoId: `queue${String(index + 1).padStart(7, "0")}`,
  title: `En cola ${index + 1}`,
}));
for (const track of queuedTracks.slice().reverse()) {
  queueSelection.playNext(track);
}
await queueSelection.playFromSelection(queuedTracks[3]);
assert.equal(
  queueSelection.snapshot().current.videoId,
  queuedTracks[3].videoId,
  "la canción seleccionada de la cola pasa a reproducirse",
);
assert.deepEqual(
  queueSelection.snapshot().upcoming.map((track) => track.videoId),
  [queuedTracks[0], queuedTracks[1], queuedTracks[2], queuedTracks[4]].map(
    (track) => track.videoId,
  ),
  "al seleccionar una canción de la cola, las demás conservan su orden",
);

const longPlaylist = createPlaylistController();
for (let index = 0; index < 12; index += 1) {
  const videoId = `old${String(index).padStart(8, "0")}`;
  await longPlaylist.playFromSelection({
    videoId,
    title: `Escuchada ${index}`,
  });
}
assert.equal(
  longPlaylist.snapshot().history.length,
  10,
  "conserva diez canciones escuchadas",
);
assert.equal(longPlaylist.snapshot().history[0].videoId, "old00000010");

const historySelection = createPlaylistController();
for (let index = 0; index < 12; index += 1) {
  await historySelection.playFromSelection({
    videoId: `heard${String(index).padStart(6, "0")}`,
    title: `Escuchada ${index}`,
  });
}
const historyBeforeSelection = historySelection.snapshot().history;
const selectedFromHistory = historyBeforeSelection[7];
const existingUpcoming = {
  videoId: "existing_queue",
  title: "Ya en cola",
};
historySelection.playNext(existingUpcoming);
await historySelection.playFromSelection(selectedFromHistory);
assert.equal(
  historySelection.snapshot().current.videoId,
  selectedFromHistory.videoId,
  "la canción elegida de escuchadas pasa a reproducirse",
);
assert.deepEqual(
  historySelection.snapshot().history.map((track) => track.videoId),
  historyBeforeSelection.slice(8).map((track) => track.videoId),
  "al repetir una canción, el historial conserva solo las más antiguas",
);
assert.deepEqual(
  historySelection.snapshot().upcoming.map((track) => track.videoId),
  [
    ...historyBeforeSelection
      .slice(0, 7)
      .reverse()
      .map((track) => track.videoId),
    existingUpcoming.videoId,
  ],
  "las más recientes vuelven a la cola en orden antes de las existentes",
);

longPlaylist.removeTrack("old00000010");
assert.equal(
  longPlaylist.snapshot().history.length,
  9,
  "permite quitar una canción escuchada",
);
assert.equal(
  longPlaylist
    .snapshot()
    .history.some((track) => track.videoId === "old00000010"),
  false,
);
const replayedTrack = longPlaylist.snapshot().history[0];
await longPlaylist.playFromSelection(replayedTrack);
assert.equal(
  longPlaylist.snapshot().current.videoId,
  replayedTrack.videoId,
  "permite reproducir una canción ya escuchada",
);
assert.equal(
  longPlaylist
    .snapshot()
    .history.some((track) => track.videoId === replayedTrack.videoId),
  false,
  "la canción reproducida sale del historial",
);

for (let index = 0; index < 22; index += 1) {
  longPlaylist.playNext({
    videoId: `next${String(index).padStart(7, "0")}`,
    title: `Próxima ${index}`,
  });
}
assert.equal(
  longPlaylist.snapshot().upcoming.length,
  20,
  "conserva hasta veinte próximas",
);

// --- playlistUrlCache: actual + 2 de historial + 20 próximas ---
const fake = (id) => ({
  url: `https://example.com/${id}`,
  contentType: "audio/webm",
  expiresAt: Date.now() + 60_000,
});

playlistUrlCache.setWindow({
  current: "cur000000001",
  history: [
    "h1________1",
    "h2________2",
    "h3________3",
    "h4________4",
    "h5________5",
    "h6________6",
    "h7________7",
    "h8________8",
    "h9________9",
    "h10_______0",
  ],
  upcoming: Array.from(
    { length: 22 },
    (_, index) => `u${String(index + 1).padStart(10, "0")}`,
  ),
});

const windowIds = playlistUrlCache.windowIds();
assert.equal(windowIds.length, 23);
assert.ok(windowIds.includes("cur000000001"));
assert.ok(windowIds.includes("h2________2"));
assert.ok(!windowIds.includes("h3________3"));
assert.ok(windowIds.includes("u0000000001"));
assert.ok(windowIds.includes("u0000000020"));
assert.ok(!windowIds.includes("u0000000021"));

for (const id of windowIds) playlistUrlCache.set(id, fake(id));
playlistUrlCache.set("outsider001", fake("outsider001"));
assert.equal(
  playlistUrlCache.get("outsider001"),
  null,
  "fuera de ventana se evicta",
);
assert.ok(playlistUrlCache.get("cur000000001"));

console.log("cache tests ok");
