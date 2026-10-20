import {
  buildCacheKey,
  cacheStats,
  clearAllCache,
  getStaleEntry,
  LIVE_MAX_AGE_MS,
  MAX_AGE_MS,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  maxAgeFor,
  registerCacheClearer,
  setCached,
  shouldCache,
} from "./cache";

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
  "/calendar/hint", "/api/calendar/personal",
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
  "/events/herbst-lan", "/calendar", "/calendar/mine", "/calendar/me", "/seasonal/advent", "/friends", "/events/recap-party",
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

// Höchstalter und Obergrenze (#1058): offline nie unbemerkt sehr alte Daten, und der Speicher wächst nicht ohne Ende.
describe("Höchstalter und Obergrenze", () => {
  let now = 1_800_000_000_000;
  let clock: jest.SpyInstance;
  const HOUR = 60 * 60 * 1000;

  beforeEach(() => {
    now = 1_800_000_000_000;
    clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => clock.mockRestore());

  const put = (url: string, data: unknown = { ok: true }) => setCached(buildCacheKey(url, undefined, "user:u-1"), url, data);
  const get = (url: string) => getStaleEntry(buildCacheKey(url, undefined, "user:u-1"), url);

  test("ein Eintrag gilt 24 Stunden, danach wird er verworfen", async () => {
    await put("/events");
    expect((await get("/events"))?.ttl).toBe(MAX_AGE_MS);
    now += MAX_AGE_MS;
    expect((await get("/events"))?.data).toEqual({ ok: true });
    now += 1;
    expect(await get("/events")).toBeNull();
    // Entfernt, nicht nur verborgen: auch mit zurückgedrehter Uhr bleibt er weg.
    now -= 2 * HOUR;
    expect(await get("/events")).toBeNull();
    expect(cacheStats().entries).toBe(0);
  });

  test.each([
    "/tournaments/t-1/bracket", "/tournaments/t-1/standings", "/api/tournaments/t-1/registrations", "/matches/m-1/page",
    "/streams/live", "/notifications", "/mobile/notifications", "/team-day/t-1", "/seasons/s-1/standings",
  ])("schnelllebiger Pfad %s hat das kürzere Höchstalter", async (url) => {
    expect(maxAgeFor(url)).toBe(LIVE_MAX_AGE_MS);
    await put(url);
    now += LIVE_MAX_AGE_MS;
    expect(await get(url)).not.toBeNull();
    now += 1;
    expect(await get(url)).toBeNull();
  });

  test.each(["/tournaments/t-1", "/tournaments", "/events/herbst-lan", "/news", "/matches-archiv"])(
    "Gegenprobe: %s behält 24 Stunden",
    (url) => {
      expect(maxAgeFor(url)).toBe(MAX_AGE_MS);
    },
  );

  test("bei der Zahlgrenze fliegt der am längsten ungenutzte Eintrag, der zuletzt gelesene bleibt", async () => {
    for (let index = 0; index < MAX_ENTRIES; index += 1) {
      await put(`/news/${index}`);
      now += 1;
    }
    expect(cacheStats().entries).toBe(MAX_ENTRIES);
    // Der älteste wird gelesen und damit wieder frisch genutzt.
    expect(await get("/news/0")).not.toBeNull();
    await put("/news/neu");
    expect(cacheStats().entries).toBe(MAX_ENTRIES);
    expect(await get("/news/0")).not.toBeNull();
    expect(await get("/news/1")).toBeNull();
    expect(await get("/news/neu")).not.toBeNull();
  });

  test("bei der Größengrenze werden die ältesten verdrängt, bis es passt", async () => {
    const chunk = "x".repeat(Math.floor(MAX_ENTRY_BYTES * 0.9));
    const count = Math.ceil(MAX_TOTAL_BYTES / chunk.length) + 3;
    for (let index = 0; index < count; index += 1) await put(`/gallery/${index}`, { chunk });
    expect(cacheStats().bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(cacheStats().entries).toBeLessThan(count);
    expect(await get("/gallery/0")).toBeNull();
    expect(await get(`/gallery/${count - 1}`)).not.toBeNull();
  });

  test("eine zu große Einzelantwort wird nicht abgelegt, ein alter Stand desselben Pfads auch nicht behalten", async () => {
    await put("/gallery", { small: true });
    await put("/gallery", { chunk: "x".repeat(MAX_ENTRY_BYTES + 1) });
    expect(await get("/gallery")).toBeNull();
    expect(cacheStats()).toEqual({ entries: 0, bytes: 0 });
  });

  test("Überschreiben zählt die Größe nicht doppelt, clearAllCache leert alles", async () => {
    await put("/news", { a: "x".repeat(1000) });
    const once = cacheStats().bytes;
    await put("/news", { a: "x".repeat(1000) });
    expect(cacheStats()).toEqual({ entries: 1, bytes: once });
    await clearAllCache();
    expect(cacheStats()).toEqual({ entries: 0, bytes: 0 });
  });
});
