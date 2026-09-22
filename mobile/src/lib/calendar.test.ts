import { calendarWindow, dayKey, googleCalendarUrl, icsFor, initialMonth, itemsByDay, monthMatrix, shiftMonth } from "./calendar";

// Kalender in der App (#216): Raster ab Montag, Termine je Tag, „In meinen Kalender“.

test("das Monatsraster beginnt am Montag und füllt die Ränder", () => {
  const weeks = monthMatrix(2026, 9); // Oktober 2026 beginnt an einem Donnerstag
  expect(weeks[0].map((cell) => cell.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
  expect(weeks[0].slice(0, 3).every((cell) => !cell.inMonth)).toBe(true);
  expect(weeks[0][3]).toMatchObject({ key: "2026-10-01", inMonth: true });
  expect(weeks.length).toBe(5);
  expect(weeks[4][6].key).toBe("2026-11-01");
  expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
});

test("ein mehrtägiger Termin steht an jedem Tag, offene Enden werden gekappt", () => {
  const map = itemsByDay([
    { id: "lan", kind: "event", title: "LAN", start: "2026-10-02T18:00:00+02:00", end: "2026-10-04T12:00:00+02:00" },
    { id: "cup", kind: "tournament", title: "Cup", start: "2026-10-03T10:00:00+02:00" },
    // Mittag statt Mitternacht: der Test läuft in der CI in UTC, und 00:00+02:00 ist dort noch der Vortag.
    { id: "endlos", kind: "fastlap", title: "Saison", start: "2026-10-01T12:00:00+02:00", end: "2027-06-01T12:00:00+02:00" },
    { id: "kaputt", kind: "event", title: "?", start: "kein Datum" },
  ]);
  expect(map.get("2026-10-02")?.map((item) => item.id)).toEqual(["endlos", "lan"]);
  expect(map.get("2026-10-03")?.map((item) => item.id)).toEqual(["endlos", "lan", "cup"]);
  expect(map.get("2026-10-04")?.map((item) => item.id)).toEqual(["endlos", "lan"]);
  expect(map.get("2026-10-31")?.map((item) => item.id)).toEqual(["endlos"]);
  expect(map.get("2026-11-01")).toBeUndefined();
  expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
});

test("der Kalender öffnet beim nächsten Termin, sonst heute", () => {
  const now = new Date(2026, 8, 22, 12);
  expect(initialMonth([{ id: "a", kind: "event", title: "A", start: "2026-11-05T18:00:00+01:00" }, { id: "b", kind: "event", title: "B", start: "2026-08-01T18:00:00+02:00" }], now)).toEqual({ year: 2026, month: 10 });
  expect(initialMonth([{ id: "b", kind: "event", title: "B", start: "2026-08-01T18:00:00+02:00" }], now)).toEqual({ year: 2026, month: 8 });
});

test("ics und Google-Link tragen Zeitfenster, Ort und Text - ohne Ende zwei Stunden", () => {
  const item = { id: "e1", kind: "event" as const, title: "Weihnachtsfeier, Vereinsheim", start: "2026-12-12T18:00:00+01:00", location: "Vereinsheim; Telfs", detail: "Essen & Getränke", url: "https://lionsquad.at/events/weihnachtsfeier" };
  const window = calendarWindow(item);
  expect(window?.end.getTime()).toBe(new Date("2026-12-12T19:00:00+01:00").getTime() + 60 * 60 * 1000);
  const ics = icsFor(item, new Date("2026-09-22T10:00:00Z"));
  expect(ics).toContain("DTSTART:20261212T170000Z");
  expect(ics).toContain("DTEND:20261212T190000Z");
  expect(ics).toContain("SUMMARY:Weihnachtsfeier\\, Vereinsheim");
  expect(ics).toContain("LOCATION:Vereinsheim\\; Telfs");
  expect(ics).toContain("UID:event-e1@lionsquad.at");
  const url = googleCalendarUrl(item);
  expect(url).toContain("dates=20261212T170000Z%2F20261212T190000Z");
  expect(url).toContain("location=Vereinsheim");
  expect(icsFor({ ...item, start: "x" })).toBe("");
});
