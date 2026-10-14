import { buildCacheKey, clearAllCache, getStaleEntry, registerCacheClearer, setCached, shouldCache } from "./cache";

// Persönliche Antworten (#1187, #1188): Rückblick mit „Du warst dabei“ und Freunde beim Event landen nie im
// Offline-Zwischenspeicher. Gegenprobe: die Event-Seite selbst, der Kalender und der Adventkalender (auch „private“
// vom Server) behalten ihren Offline-Stand.

beforeEach(async () => {
  await clearAllCache();
});

test.each([
  "/events/herbst-lan/recap", "/events/herbst-lan/friends", "/api/events/e1/recap", "https://lionsquad.at/api/events/e1/friends?x=1",
  // #1188 Teil 2: Freunde bei Turnier und Fast Lap, und ob der einmalige Hinweis fällig ist.
  "/tournaments/rl/friends", "/api/tournaments/t1/friends", "/f1/challenges/monza/friends", "https://lionsquad.at/api/f1/challenges/c1/friends",
  "/users/me/friends-hint",
])(
  "nicht zwischengespeichert: %s",
  async (url) => {
    expect(shouldCache(url)).toBe(false);
    const key = buildCacheKey(url, undefined, "user:u-1");
    await setCached(key, url, { friends: [{ id: "u-finn" }] });
    expect(await getStaleEntry(key, url)).toBeNull();
  },
);

test.each([
  "/events/herbst-lan", "/calendar", "/calendar/mine", "/seasonal/advent", "/friends", "/events/recap-party",
  "/tournaments/rl", "/tournaments/friends-cup", "/f1/challenges/monza", "/f1/challenges/monza/leaderboard", "/users/me",
])(
  "Gegenprobe – weiter zwischengespeichert: %s",
  async (url) => {
    expect(shouldCache(url)).toBe(true);
    const key = buildCacheKey(url, undefined, "user:u-1");
    await setCached(key, url, { ok: true });
    expect((await getStaleEntry(key, url))?.data).toEqual({ ok: true });
  },
);

// Sitzungsende (#1059): Abmelden und Kontowechsel warten, bis auch die Dateien weg sind - und ein Aufräumer, der
// scheitert, hält die anderen nicht auf.
test("clearAllCache wartet auf jeden Aufräumer, auch wenn einer scheitert", async () => {
  const done: string[] = [];
  registerCacheClearer(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    done.push("dateien");
  });
  registerCacheClearer(() => {
    throw new Error("kaputt");
  });
  registerCacheClearer(async () => {
    throw new Error("auch kaputt");
  });
  registerCacheClearer(() => {
    done.push("bilder");
  });
  await expect(clearAllCache()).resolves.toBeUndefined();
  expect(done.sort()).toEqual(["bilder", "dateien"]);
});
