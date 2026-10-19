import fs from "fs";
import path from "path";
import { absoluteRank, describeSlot, finderFor, normalizeSource, plannedText, sourceLabel } from "./slotSource";

// Klartext statt Kürzel (#1140): dieselben Fälle wie Website und TV (frontend/src/lib/slotSource.cases.json) - gleiche
// Daten ergeben in App und Web denselben Text.
type Cases = {
  matchSets: Record<string, any[]>;
  sourceLabel: Array<{ name: string; set: string; stage: string; source: any; text: string }>;
  describeSlot: Array<{ name: string; set: string; slot: any; result: { kind: string; label: string } }>;
  plannedText: Array<{ name: string; now: string; match: any; text: string }>;
};
const CASES: Cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/slotSource.cases.json"), "utf8"));
const nameOf = (id: string) => ({ r1: "NeonFalke" } as Record<string, string>)[id] || "";

test.each(CASES.sourceLabel)("Herkunft: $name", ({ set, stage, source, text }) => {
  expect(sourceLabel(source, finderFor(CASES.matchSets[set])({ stage_id: stage }))).toBe(text);
});

test.each(CASES.describeSlot)("Platz: $name", ({ set, slot, result }) => {
  expect(describeSlot(slot, nameOf, finderFor(CASES.matchSets[set])({ stage_id: "s1" }))).toEqual(result);
});

test.each(CASES.plannedText)("Zeit: $name", ({ match, now, text }) => {
  expect(plannedText(match, new Date(now))).toBe(text);
});

test("ältere Daten und absolute Plätze wie im Web", () => {
  expect(normalizeSource({ raw: "W:A:1" })).toMatchObject({ type: "rank", flow: "W", match_key: "A", rank: 1 });
  expect(absoluteRank({ type: "rank", flow: "L", match_key: "E", rank: 3 }, { settings: { match_size: 8, qualifiers_per_match: 2 } })).toBe(5);
  expect(absoluteRank({ type: "rank", flow: "L", match_key: "E", rank: 3 }, { settings: {} })).toBe(3);
});

// Spieldauer (#1554): ohne eingefrorenen Wert am Spiel nennt der Server die Dauer, die gilt.
test("Zeit: die Dauer vom Server geht vor", () => {
  const now = new Date("2026-10-10T08:00:00Z");
  expect(plannedText({ scheduled_at: "2026-10-10T14:20:00+02:00", effective_duration_minutes: 15 }, now)).toBe("geplant ca. 14:20 · 15 Minuten");
  expect(plannedText({ duration_minutes: 20, effective_duration_minutes: 20 }, now)).toBe("20 Minuten");
});

// Vorgeplant im Vorschau-Baum oder nur vom Planer vorhergesagt (#1613, App #1633): „voraussichtlich“ - wie im Web.
test("Zeit: vorgeplant oder Prognose heißt „voraussichtlich“", () => {
  const now = new Date("2026-10-10T08:00:00Z");
  expect(plannedText({ scheduled_at: "2026-10-10T14:20:00+02:00", is_preview: true }, now)).toBe("voraussichtlich ca. 14:20");
  expect(plannedText({ scheduled_at: "2026-10-10T14:20:00+02:00", schedule_forecast: true, effective_duration_minutes: 15 }, now)).toBe("voraussichtlich ca. 14:20 · 15 Minuten");
  expect(plannedText({ scheduled_at: "2026-10-10T14:20:00+02:00", schedule_forecast: false }, now)).toBe("geplant ca. 14:20");
});
