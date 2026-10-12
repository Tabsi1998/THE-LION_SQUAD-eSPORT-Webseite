import { calendarWindow, currentMonth, dayKey, googleCalendarUrl, icsFor, itemsByDay, monthMatrix, shiftMonth, splitSpans, weekBars } from "./calendar";

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
    // Mitternacht in Wien: in UTC ist das noch der Vortag - der Kalender zählt Wiener Tage.
    { id: "endlos", kind: "fastlap", title: "Saison", start: "2026-10-01T00:00:00+02:00", end: "2027-06-01T12:00:00+02:00" },
    { id: "kaputt", kind: "event", title: "?", start: "kein Datum" },
  ]);
  expect(map.get("2026-10-02")?.map((item) => item.id)).toEqual(["endlos", "lan"]);
  expect(map.get("2026-10-03")?.map((item) => item.id)).toEqual(["endlos", "lan", "cup"]);
  expect(map.get("2026-10-04")?.map((item) => item.id)).toEqual(["endlos", "lan"]);
  expect(map.get("2026-10-31")?.map((item) => item.id)).toEqual(["endlos"]);
  expect(map.get("2026-11-01")).toBeUndefined();
  expect(map.get("2026-09-30")).toBeUndefined();
  expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
});

test("ein Termin steht am Wiener Tag - auch kurz nach Mitternacht und über den Jahreswechsel", () => {
  const map = itemsByDay([
    { id: "nacht", kind: "event", title: "Nachtcup", start: "2026-10-04T00:30:00+02:00" },
    { id: "silvester", kind: "event", title: "Silvester", start: "2026-12-31T20:00:00+01:00", end: "2027-01-01T02:00:00+01:00" },
  ]);
  expect(map.get("2026-10-04")?.map((item) => item.id)).toEqual(["nacht"]);
  expect(map.get("2026-10-03")).toBeUndefined();
  expect(map.get("2027-01-01")?.map((item) => item.id)).toEqual(["silvester"]);
  // Halb eins am Neujahrstag in Wien: der Kalender steht im Jänner, auch wenn es in UTC noch Dezember ist.
  expect(currentMonth(new Date("2026-12-31T23:30:00Z"))).toEqual({ year: 2027, month: 0 });
});

test("der Kalender öffnet im aktuellen Monat (#1271)", () => {
  expect(currentMonth(new Date("2026-09-22T12:00:00+02:00"))).toEqual({ year: 2026, month: 8 });
});

test("Balken (#1271): mehrtägig über die Tage der Woche, über Monatsgrenzen, in eigenen Reihen; Eintägiges bleibt ein Punkt", () => {
  const lan = { id: "lan", kind: "event" as const, title: "LAN", start: "2026-10-30T18:00:00+01:00", end: "2026-11-02T12:00:00+01:00" };
  const lap = { id: "lap", kind: "fastlap" as const, title: "Fast Lap", start: "2026-10-31T10:00:00+01:00", end: "2026-11-05T20:00:00+01:00" };
  const single = { id: "abend", kind: "event" as const, title: "Abend", start: "2026-10-31T18:00:00+01:00" };
  // Über Mitternacht ist noch nicht mehrtägig: eine Schicht bis 1 Uhr bleibt ein Punkt.
  const night = { id: "nacht", kind: "club" as const, title: "Schicht", start: "2026-10-31T22:00:00+01:00", end: "2026-11-01T01:00:00+01:00" };
  const { spans, singles } = splitSpans([lan, lap, single, night]);
  expect(spans.map((item) => item.id)).toEqual(["lan", "lap"]);
  expect(singles.map((item) => item.id)).toEqual(["abend", "nacht"]);

  const october = monthMatrix(2026, 9);
  expect(weekBars(october[october.length - 1], spans).map(({ item, from, to, lane, continuesBefore, continuesAfter }) => [item.id, from, to, lane, continuesBefore, continuesAfter])).toEqual([
    ["lan", 4, 6, 0, false, true],
    ["lap", 5, 6, 1, false, true],
  ]);
  const november = monthMatrix(2026, 10);
  expect(weekBars(november[1], spans).map(({ item, from, to, lane, continuesBefore }) => [item.id, from, to, lane, continuesBefore])).toEqual([
    ["lan", 0, 0, 0, true],
    ["lap", 0, 3, 1, true],
  ]);
});

test("Tage eines Events (Codex-Prüfung #1460): gleiche Kennung ist ein Termin, mit Lücke zwei Balken", () => {
  // Die App liefert je Tag eines mehrtägigen Events einen Eintrag mit derselben Kennung - Do 11. und Sa 13. März 2027.
  const days = [11, 13].map((day) => ({ id: "messe", kind: "event" as const, title: "Gaming-Messe", start: `2027-03-${day}T09:00:00+01:00`, end: `2027-03-${day}T18:00:00+01:00`, mine: day === 13 }));
  const { spans, singles } = splitSpans(days);
  expect(singles).toEqual([]);
  expect(spans).toHaveLength(1);
  expect(spans[0]).toMatchObject({ id: "messe", start: "2027-03-11T09:00:00+01:00", end: "2027-03-13T18:00:00+01:00", mine: true, days: ["2027-03-11", "2027-03-13"] });
  const march = monthMatrix(2027, 2);
  expect(weekBars(march[1], spans).map(({ from, to }) => [from, to])).toEqual([[3, 3], [5, 5]]);
  // Zwei Tage ohne Lücke: ein Balken.
  const both = [11, 12].map((day) => ({ ...days[0], start: `2027-03-${day}T09:00:00+01:00`, end: `2027-03-${day}T18:00:00+01:00` }));
  expect(weekBars(march[1], splitSpans(both).spans).map(({ from, to }) => [from, to])).toEqual([[3, 4]]);
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
