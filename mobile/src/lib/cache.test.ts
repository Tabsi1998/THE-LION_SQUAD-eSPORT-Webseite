import { buildCacheKey, clearAllCache, getStaleEntry, setCached, shouldCache } from "./cache";

// Persönliche Antworten (#1187, #1188): Rückblick mit „Du warst dabei“ und Freunde beim Event landen nie im
// Offline-Zwischenspeicher. Gegenprobe: die Event-Seite selbst, der Kalender und der Adventkalender (auch „private“
// vom Server) behalten ihren Offline-Stand.

beforeEach(async () => {
  await clearAllCache();
});

test.each(["/events/herbst-lan/recap", "/events/herbst-lan/friends", "/api/events/e1/recap", "https://lionsquad.at/api/events/e1/friends?x=1"])(
  "nicht zwischengespeichert: %s",
  async (url) => {
    expect(shouldCache(url)).toBe(false);
    const key = buildCacheKey(url, undefined, "user:u-1");
    await setCached(key, url, { friends: [{ id: "u-finn" }] });
    expect(await getStaleEntry(key, url)).toBeNull();
  },
);

test.each(["/events/herbst-lan", "/calendar", "/calendar/mine", "/seasonal/advent", "/friends", "/events/recap-party"])(
  "Gegenprobe – weiter zwischengespeichert: %s",
  async (url) => {
    expect(shouldCache(url)).toBe(true);
    const key = buildCacheKey(url, undefined, "user:u-1");
    await setCached(key, url, { ok: true });
    expect((await getStaleEntry(key, url))?.data).toEqual({ ok: true });
  },
);
