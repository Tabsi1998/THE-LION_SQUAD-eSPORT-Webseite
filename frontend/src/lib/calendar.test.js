import { dayKey, feedUrls, filterKinds, initialMonth, itemsByDay, monthMatrix, shiftMonth, upcomingItems } from "./calendar";

// Kalender auf der Website (#402): Raster ab Montag, Termine je Tag, Abo-Adressen - dieselbe
// Rechnung wie in der App.

test("das Monatsraster beginnt am Montag und füllt die Ränder", () => {
  const weeks = monthMatrix(2026, 9); // Oktober 2026 beginnt an einem Donnerstag
  expect(weeks[0].map((cell) => cell.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
  expect(weeks[0].slice(0, 3).every((cell) => !cell.inMonth)).toBe(true);
  expect(weeks[0][3]).toMatchObject({ key: "2026-10-01", inMonth: true });
  expect(weeks.length).toBe(5);
  expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
});

test("ein mehrtägiger Termin steht an jedem Tag, offene Enden werden gekappt", () => {
  const map = itemsByDay([
    { id: "lan", kind: "event", title: "LAN", start: "2026-10-02T18:00:00+02:00", end: "2026-10-04T12:00:00+02:00" },
    { id: "cup", kind: "tournament", title: "Cup", start: "2026-10-03T10:00:00+02:00" },
    // Mittag statt Mitternacht: die CI läuft in UTC, und 00:00+02:00 ist dort noch der Vortag.
    { id: "endlos", kind: "fastlap", title: "Saison", start: "2026-10-01T12:00:00+02:00", end: "2027-06-01T12:00:00+02:00" },
    { id: "kaputt", kind: "event", title: "?", start: "kein Datum" },
  ]);
  expect(map.get("2026-10-02")?.map((item) => item.id)).toEqual(["endlos", "lan"]);
  expect(map.get("2026-10-03")?.map((item) => item.id)).toEqual(["endlos", "lan", "cup"]);
  expect(map.get("2026-10-31")?.map((item) => item.id)).toEqual(["endlos"]);
  expect(map.get("2026-11-01")).toBeUndefined();
  expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
});

test("der Kalender öffnet beim nächsten Termin; „als Nächstes“ zeigt Laufendes und Kommendes", () => {
  const now = new Date(2026, 8, 22, 12);
  const items = [
    { id: "a", kind: "event", title: "A", start: "2026-11-05T18:00:00+01:00" },
    { id: "b", kind: "event", title: "B", start: "2026-08-01T18:00:00+02:00" },
    { id: "c", kind: "fastlap", title: "C", start: "2026-09-01T12:00:00+02:00", end: "2026-09-30T12:00:00+02:00" },
  ];
  expect(initialMonth(items, now)).toEqual({ year: 2026, month: 10 });
  expect(initialMonth([items[1]], now)).toEqual({ year: 2026, month: 8 });
  expect(upcomingItems(items, now).map((item) => item.id)).toEqual(["c", "a"]);
  expect(upcomingItems(items, now, 1).map((item) => item.id)).toEqual(["c"]);
  expect(filterKinds(items, ["fastlap"]).map((item) => item.id)).toEqual(["c"]);
});

test("Abo-Adressen: https zum Kopieren, webcal zum Öffnen", () => {
  expect(feedUrls("https://lionsquad.at/")).toEqual({ https: "https://lionsquad.at/api/calendar/feed.ics", webcal: "webcal://lionsquad.at/api/calendar/feed.ics" });
  expect(feedUrls("http://localhost:3000").webcal).toBe("webcal://localhost:3000/api/calendar/feed.ics");
});
