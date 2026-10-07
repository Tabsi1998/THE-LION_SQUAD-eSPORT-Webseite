// Klartext statt Platzhalter (#1113): Sieger, Verlierer, Platz, Setzplatz, Freilos - und die Kürzel.
import { absoluteRank, describeSlot, finderFor, initials, normalizeSource, plannedText, sourceLabel, stationLabel } from "./slotSource";

const duel = (key, extra = {}) => ({ id: key, match_key: key, stage_id: "s1", slots: [{}, {}], settings: { match_size: 2, qualifiers_per_match: 1 }, ...extra });
const heat = (key, size = 4, qualifiers = 2) => ({ id: key, match_key: key, stage_id: "s1", slots: Array.from({ length: size }, () => ({})), settings: { match_size: size, qualifiers_per_match: qualifiers } });
const rank = (flow, key, value) => ({ type: "rank", flow, match_key: key, rank: value, raw: `${flow}:${key}:${value}` });

test("Sieger und Verlierer im Duell", () => {
  const find = finderFor([duel("A"), duel("E")])({ stage_id: "s1" });
  expect(sourceLabel(rank("W", "A", 1), find)).toBe("Sieger aus A");
  expect(sourceLabel(rank("L", "A", 1), find)).toBe("Verlierer aus A");
  expect(sourceLabel(rank("R", "A", 2), find)).toBe("Verlierer aus A");
  // Spiel um Platz 3, Herkunft unbekannt: wie im Duell.
  expect(sourceLabel(rank("L", "Z", 1))).toBe("Verlierer aus Z");
});

test("Plätze im Durchgang", () => {
  const find = finderFor([heat("A", 4, 2), heat("E", 8, 2)])({ stage_id: "s1" });
  expect(sourceLabel(rank("W", "A", 1), find)).toBe("Sieger aus A");
  expect(sourceLabel(rank("W", "A", 2), find)).toBe("Platz 2 aus A");
  // L zählt ab den Weiterkommern: im Durchgang mit 2 Weiterkommern ist L:A:1 Platz 3.
  expect(sourceLabel(rank("L", "A", 1), find)).toBe("Platz 3 aus A");
  // Ältere Schemata mit absolutem Platz nach L: über die Zahl der Nicht-Weiterkommer hinaus gilt der Platz selbst.
  expect(sourceLabel(rank("L", "A", 3), find)).toBe("Platz 3 aus A");
  expect(sourceLabel(rank("L", "E", 3), find)).toBe("Platz 5 aus E");
  expect(absoluteRank(rank("L", "E", 3), heat("E", 8, 2))).toBe(5);
  expect(absoluteRank(rank("L", "E", 3), { settings: {} })).toBe(3);
});

test("Setzplätze bleiben leer, Freilos bleibt, unbekannte Herkunft bleibt leer", () => {
  expect(sourceLabel({ type: "seed", seed: 3, raw: "3" })).toBe("");
  expect(sourceLabel({ type: "bye", raw: "bye" })).toBe("Freilos");
  expect(sourceLabel({ type: "direct", raw: "swiss" })).toBe("");
  expect(sourceLabel(null)).toBe("");
  // Ältere Daten mit nur dem Text.
  expect(normalizeSource({ raw: "W:A:1" })).toMatchObject({ type: "rank", flow: "W", match_key: "A", rank: 1 });
  expect(sourceLabel({ raw: "W:A:1" })).toBe("Sieger aus A");
  expect(sourceLabel({ raw: "7" })).toBe("");
  expect(sourceLabel({ raw: "-" })).toBe("Freilos");
  expect(sourceLabel({ raw: "WA2" })).toBe("");
});

test("ein Platz zeigt Name, Freilos, Klartext oder nichts", () => {
  const nameOf = (id) => ({ r1: "NeonFalke" }[id] || "");
  const find = finderFor([duel("A")])({ stage_id: "s1" });
  expect(describeSlot({ registration_id: "r1" }, nameOf, find)).toEqual({ kind: "player", label: "NeonFalke" });
  expect(describeSlot({ status: "bye", source: { type: "seed", seed: 8 } }, nameOf, find)).toEqual({ kind: "bye", label: "Freilos" });
  expect(describeSlot({ status: "pending", source: rank("W", "A", 1) }, nameOf, find)).toEqual({ kind: "pending", label: "Sieger aus A" });
  expect(describeSlot({ status: "preview", source: { type: "seed", seed: 2 } }, nameOf, find)).toEqual({ kind: "empty", label: "" });
});

test("Spiel-Kürzel gelten je Phase", () => {
  const first = duel("A", { stage_id: "phase-1" });
  const second = heat("A", 4, 2);
  second.stage_id = "phase-2";
  const finder = finderFor([first, second]);
  expect(finder({ stage_id: "phase-2" })("A")).toBe(second);
  expect(finder({ stage_id: "phase-1" })("A")).toBe(first);
  expect(finder({ stage_id: "andere" })("A")).toBe(first);
});

test("Kürzel aus zwei Buchstaben - auch zusammengeschrieben", () => {
  expect(initials("NeonFalke")).toBe("NF");
  expect(initials("KartKönigin")).toBe("KK");
  expect(initials("Max")).toBe("M");
  expect(initials("Neon Falke")).toBe("NF");
  expect(initials("lions_academy")).toBe("LA");
  expect(initials("  ")).toBe("");
});

test("Zeit und Dauer im Klartext, Station mit Wort", () => {
  const now = new Date("2026-10-10T08:00:00Z");
  expect(plannedText({ scheduled_at: "2026-10-10T14:20:00+02:00", duration_minutes: 30 }, now)).toBe("geplant ca. 14:20 · 30 Minuten");
  expect(plannedText({ scheduled_at: "2026-10-11T14:20:00+02:00", duration_minutes: 30 }, now)).toBe("geplant ca. 11.10. 14:20 · 30 Minuten");
  expect(plannedText({ settings: { duration_minutes: 20 } }, now)).toBe("20 Minuten");
  expect(plannedText({ status: "completed", scheduled_at: "2026-10-10T14:20:00+02:00", duration_minutes: 30 }, now)).toBe("");
  expect(stationLabel({ station_label: "1" })).toBe("Station 1");
  expect(stationLabel({ station_name: "Station B" })).toBe("Station B");
  expect(stationLabel({})).toBe("");
});
