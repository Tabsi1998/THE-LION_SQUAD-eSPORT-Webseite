import { eventDateLine, memberEvents } from "./memberArea";

const now = new Date("2026-09-16T10:00:00Z");

const halloween = { id: "e-hallo", name: "Halloween Gaming Night 2026", visibility: "members", start_date: "2026-10-31T18:00:00Z", end_date: "2026-11-01T02:00:00Z" };
const board = { id: "e-board", name: "Vorstandssitzung", visibility: "internal", start_date: "2026-09-20T17:00:00Z" };
const lan = { id: "e-lan", name: "LAN für alle", visibility: "public", start_date: "2026-09-18T10:00:00Z" };
const past = { id: "e-past", name: "Sommerfest", visibility: "members", start_date: "2026-08-01T10:00:00Z", end_date: "2026-08-01T20:00:00Z" };
const undated = { id: "e-open", name: "Ohne Termin", visibility: "members" };

test("nur Mitglieder- und interne Events, nichts Vergangenes, nach Datum", () => {
  expect(memberEvents([halloween, lan, board, past, undated], now).map((e) => e.id)).toEqual(["e-board", "e-hallo", "e-open"]);
});

test("ein Event, das heute noch läuft, bleibt drin", () => {
  const running = { id: "e-run", visibility: "members", start_date: "2026-09-16T08:00:00Z", end_date: "2026-09-16T12:00:00Z" };
  expect(memberEvents([running], now)).toHaveLength(1);
});

test("keine Liste ergibt keine Events", () => {
  expect(memberEvents({ detail: "nope" }, now)).toEqual([]);
  expect(memberEvents(null, now)).toEqual([]);
});

test("die Terminzeile nennt Start und bei mehrtägigen Events das Ende", () => {
  expect(eventDateLine(board)).toMatch(/20\.09\./);
  expect(eventDateLine(halloween)).toMatch(/31\.10\..*–.*01\.11\./);
  expect(eventDateLine(undated)).toBe("Termin folgt");
});
