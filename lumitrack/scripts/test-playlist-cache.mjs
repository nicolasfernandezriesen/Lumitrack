import assert from "node:assert/strict";
import * as audioCache from "../server/infrastructure/audioCache.js";
import * as playlistUrlCache from "../server/infrastructure/playlistUrlCache.js";

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
assert.equal(audioCache.has("aaa11111111"), true, "historial conserva la anterior");
assert.equal(audioCache.has("bbb22222222"), true);

audioCache.markNext("ccc33333333");
audioCache.set("ccc33333333", buf("c"), "audio/webm", "next");
assert.equal(audioCache.has("ccc33333333"), true);

for (const id of ["ddd44444444", "eee55555555", "fff66666666", "ggg77777777"]) {
  audioCache.markCurrent(id);
  audioCache.set(id, buf(id), "audio/webm", "current");
}

assert.ok(audioCache.size() <= 5, `size=${audioCache.size()} no debe crecer sin límite`);
assert.equal(audioCache.has("ggg77777777"), true);

// --- playlistUrlCache: ventana 3+1+3 ---
const fake = (id) => ({
  url: `https://example.com/${id}`,
  contentType: "audio/webm",
  expiresAt: Date.now() + 60_000,
});

playlistUrlCache.setWindow({
  current: "cur000000001",
  history: ["h1________1", "h2________2", "h3________3", "h4________4"],
  upcoming: ["u1________1", "u2________2", "u3________3", "u4________4"],
});

const windowIds = playlistUrlCache.windowIds();
assert.equal(windowIds.length, 7);
assert.ok(windowIds.includes("cur000000001"));
assert.ok(!windowIds.includes("h4________4"));
assert.ok(!windowIds.includes("u4________4"));

for (const id of windowIds) playlistUrlCache.set(id, fake(id));
playlistUrlCache.set("outsider001", fake("outsider001"));
assert.equal(playlistUrlCache.get("outsider001"), null, "fuera de ventana se evicta");
assert.ok(playlistUrlCache.get("cur000000001"));

console.log("cache tests ok");
