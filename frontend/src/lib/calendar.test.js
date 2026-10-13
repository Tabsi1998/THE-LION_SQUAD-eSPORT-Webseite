import {
  agenda, currentMonth, dayKey, dayLabel, feedUrls, filterKinds, filterMine, itemsByDay, mergeEventDays, monthMatrix, nextAfter, preferredView, shiftMonth,
  spanLabel, splitSpans, startPhrase, upcomingItems, weekBars,
} from "./calendar";

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
    // Mitternacht in Wien: in UTC ist das noch der Vortag - der Kalender zählt Wiener Tage.
    { id: "endlos", kind: "fastlap", title: "Saison", start: "2026-10-01T00:00:00+02:00", end: "2027-06-01T12:00:00+02:00" },
    { id: "kaputt", kind: "event", title: "?", start: "kein Datum" },
  ]);
  expect(map.get("2026-10-02")?.map((item) => item.id)).toEqual(["endlos", "lan"]);
  expect(map.get("2026-10-03")?.map((item) => item.id)).toEqual(["endlos", "lan", "cup"]);
  expect(map.get("2026-10-31")?.map((item) => item.id)).toEqual(["endlos"]);
  expect(map.get("2026-11-01")).toBeUndefined();
  expect(map.get("2026-09-30")).toBeUndefined();
  expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
});

test("ein Termin steht am Wiener Tag und der Tag heißt, wie er im Raster steht", () => {
  const map = itemsByDay([
    { id: "nacht", kind: "event", title: "Nachtcup", start: "2026-10-04T00:30:00+02:00" },
    { id: "silvester", kind: "event", title: "Silvester", start: "2026-12-31T20:00:00+01:00", end: "2027-01-01T02:00:00+01:00" },
  ]);
  expect(map.get("2026-10-04")?.map((item) => item.id)).toEqual(["nacht"]);
  expect(map.get("2026-10-03")).toBeUndefined();
  expect(map.get("2027-01-01")?.map((item) => item.id)).toEqual(["silvester"]);
  expect(dayLabel("2026-10-04")).toBe("Sonntag, 4. Oktober");
  expect(dayLabel("2027-01-01")).toBe("Freitag, 1. Jänner");
  // Halb eins am Neujahrstag in Wien: der Kalender steht im Jänner, auch wenn es in UTC noch Dezember ist.
  expect(currentMonth(new Date("2026-12-31T23:30:00Z"))).toEqual({ year: 2027, month: 0 });
});

test("der Kalender öffnet im aktuellen Monat (#1271); „als Nächstes“ zeigt Laufendes und Kommendes", () => {
  const now = new Date("2026-09-22T12:00:00+02:00");
  const items = [
    { id: "a", kind: "event", title: "A", start: "2026-11-05T18:00:00+01:00" },
    { id: "b", kind: "event", title: "B", start: "2026-08-01T18:00:00+02:00" },
    { id: "c", kind: "fastlap", title: "C", start: "2026-09-01T12:00:00+02:00", end: "2026-09-30T12:00:00+02:00" },
  ];
  expect(currentMonth(now)).toEqual({ year: 2026, month: 8 });
  expect(upcomingItems(items, now).map((item) => item.id)).toEqual(["c", "a"]);
  expect(upcomingItems(items, now, 1).map((item) => item.id)).toEqual(["c"]);
  expect(filterKinds(items, ["fastlap"]).map((item) => item.id)).toEqual(["c"]);
});

// Eine viertägige Messe, wie der Server sie liefert: ein Eintrag je Tag mit Name und Kennung des Events (#884, #1271).
const MESSE = [11, 12, 13, 14].map((day, index) => ({
  id: `e-messe-tag-${index + 1}`, kind: "event", title: `Gaming-Messe – Tag ${index + 1}/4`, marker: "event_day", event_id: "e-messe", event_name: "Gaming-Messe",
  start: `2027-03-${day}T09:00:00+01:00`, end: `2027-03-${day}T18:00:00+01:00`, path: "/events/messe", mine: index === 2,
}));

test("die Tage eines Events werden eine Zeile: Name, erster Beginn, letztes Ende", () => {
  const cup = { id: "t-cup", kind: "tournament", title: "Cup", start: "2027-03-12T10:00:00+01:00" };
  const merged = mergeEventDays([...MESSE, cup]);
  expect(merged.map((item) => item.id)).toEqual(["e-messe", "t-cup"]);
  expect(merged[0]).toMatchObject({ title: "Gaming-Messe", start: "2027-03-11T09:00:00+01:00", end: "2027-03-14T18:00:00+01:00", mine: true, marker: null });
  expect(merged[0].parts).toHaveLength(4);
  expect(spanLabel(merged[0], new Date("2027-01-15T10:00:00Z"))).toBe("Do 11. – So 14. März");
  // Aus einem anderen Jahr gesehen steht das Jahr dabei (#1307).
  expect(spanLabel(merged[0], new Date("2026-10-13T10:00:00Z"))).toBe("Do 11. – So 14. März 2027");
  expect(startPhrase(merged[0], new Date("2027-01-15T10:00:00Z"))).toBe("Do 11. März");
  expect(spanLabel({ start: "2026-10-30T18:00:00+01:00", end: "2026-11-02T12:00:00+01:00" }, new Date("2026-10-13T10:00:00Z"))).toBe("Fr 30. Oktober – Mo 2. November");
  expect(spanLabel({ start: "2027-03-12T00:00:00+01:00", all_day: true, day: "2027-03-12" }, new Date("2027-01-15T10:00:00Z"))).toBe("Fr 12. März · ganztägig");
  expect(spanLabel({ start: "2027-03-12T18:00:00+01:00" }, new Date("2027-01-10T12:00:00Z"))).toBe("Fr 12. März · 18:00");
  // Über Mitternacht ist noch nicht mehrtägig: Schicht bis 1 Uhr.
  expect(spanLabel({ start: "2026-10-10T22:00:00+02:00", end: "2026-10-11T01:00:00+02:00" }, new Date("2026-01-01T12:00:00Z"))).toBe("Sa 10. Oktober · 22:00");
});

test("Balken: mehrtägig über die Tage der Woche, über Monatsgrenzen, in eigenen Reihen; Eintägiges bleibt ein Punkt", () => {
  const lan = { id: "lan", kind: "event", title: "LAN", start: "2026-10-30T18:00:00+01:00", end: "2026-11-02T12:00:00+01:00" };
  const overlap = { id: "lap", kind: "fastlap", title: "Fast Lap", start: "2026-10-31T10:00:00+01:00", end: "2026-11-05T20:00:00+01:00" };
  const single = { id: "abend", kind: "event", title: "Abend", start: "2026-10-31T18:00:00+01:00" };
  const night = { id: "nacht", kind: "club", title: "Schicht", start: "2026-10-31T22:00:00+01:00", end: "2026-11-01T01:00:00+01:00" };
  const { spans, singles } = splitSpans([lan, overlap, single, night]);
  expect(spans.map((item) => item.id)).toEqual(["lan", "lap"]);
  expect(singles.map((item) => item.id)).toEqual(["abend", "nacht"]);

  const october = monthMatrix(2026, 9);
  const last = weekBars(october[october.length - 1], spans);
  expect(last.map(({ item, from, to, lane, continuesBefore, continuesAfter }) => [item.id, from, to, lane, continuesBefore, continuesAfter])).toEqual([
    ["lan", 4, 6, 0, false, true],
    ["lap", 5, 6, 1, false, true],
  ]);
  const november = monthMatrix(2026, 10);
  expect(weekBars(november[1], spans).map(({ item, from, to, lane, continuesBefore }) => [item.id, from, to, lane, continuesBefore])).toEqual([
    ["lan", 0, 0, 0, true],
    ["lap", 0, 3, 1, true],
  ]);

  // Eine Messe ist ein Balken Do–So; ein Event mit Lücke zwischen den Tagen zwei.
  const march = monthMatrix(2027, 2);
  expect(weekBars(march[1], splitSpans(MESSE).spans).map(({ item, from, to }) => [item.id, item.title, from, to])).toEqual([["e-messe", "Gaming-Messe", 3, 6]]);
  const gap = splitSpans([MESSE[0], MESSE[2]]).spans;
  expect(weekBars(march[1], gap).map(({ from, to }) => [from, to])).toEqual([[3, 3], [5, 5]]);
});

test("Liste: Kommendes nach Monat, Laufendes im aktuellen Monat; leerer Monat zeigt den nächsten Termin", () => {
  const now = new Date("2027-02-20T12:00:00+01:00");
  const running = { id: "lap", kind: "fastlap", title: "Saison", start: "2027-01-15T12:00:00+01:00", end: "2027-03-01T12:00:00+01:00" };
  const old = { id: "alt", kind: "event", title: "Alt", start: "2027-01-02T12:00:00+01:00" };
  const groups = agenda([...MESSE, running, old], now);
  expect(groups.map((group) => [group.key, group.label, group.items.map((item) => item.id)])).toEqual([
    ["2027-02", "Februar 2027", ["lap"]],
    ["2027-03", "März 2027", ["e-messe"]],
  ]);
  expect(nextAfter([...MESSE, old], 2027, 1)?.id).toBe("e-messe");
  expect(nextAfter([...MESSE, old], 2027, 2)).toBeNull();
  expect(nextAfter([old], 2027, 1)).toBeNull();
});

test("am Handy startet die Liste, sonst der Monat; die letzte Wahl gewinnt", () => {
  expect(preferredView(null, 390)).toBe("list");
  expect(preferredView(null, 768)).toBe("month");
  expect(preferredView("month", 390)).toBe("month");
  expect(preferredView("list", 1440)).toBe("list");
  expect(preferredView("unsinn", 1440)).toBe("month");
});

test("Abo-Adressen: https zum Kopieren, webcal zum Öffnen", () => {
  expect(feedUrls("https://lionsquad.at/")).toEqual({ https: "https://lionsquad.at/api/calendar/feed.ics", webcal: "webcal://lionsquad.at/api/calendar/feed.ics" });
  expect(feedUrls("http://localhost:3000").webcal).toBe("webcal://localhost:3000/api/calendar/feed.ics");
});

test("„Nur meine“ (#1189) behält nur, was der Server als „angemeldet“ kennzeichnet", () => {
  const rows = [{ id: "a", kind: "event", mine: true }, { id: "b", kind: "tournament", mine: false }, { id: "c", kind: "club", mine: true }];
  expect(filterMine(rows, true).map((row) => row.id)).toEqual(["a", "c"]);
  expect(filterMine(rows, false)).toBe(rows);
  expect(filterMine(null, true)).toEqual([]);
});
