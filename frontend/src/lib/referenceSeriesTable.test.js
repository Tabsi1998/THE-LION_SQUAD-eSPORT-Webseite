import {
  HIDDEN_NAME, countLabel, cutlineAfter, mobileRows, nameOf, resultIn, resultLabel, roundColumns, schemeLabel,
  tiebreakHint, tiebreakLabel, visibleRows,
} from "./referenceSeriesTable";

// Gesamtwertung der Serienseite (#1745): Filter „Nur Vereinsspieler“, Finalgrenze, Handy-Auswahl und Beschriftungen.
// Nur erfundene Namen.

const ROWS = Array.from({ length: 14 }, (_, index) => ({
  key: `p${index + 1}`, rank: index + 1, name: `Probe ${index + 1}`, club_member: index === 2 || index === 12,
}));

test("Filter: nur Vereinsspieler, der Rang bleibt", () => {
  expect(visibleRows(ROWS, { clubOnly: true }).map((row) => [row.key, row.rank])).toEqual([["p3", 3], ["p13", 13]]);
  expect(visibleRows(ROWS)).toHaveLength(14);
  expect(visibleRows(null)).toEqual([]);
});

test("Finalgrenze: nach der letzten Zeile innerhalb, auch gefiltert", () => {
  expect(cutlineAfter(ROWS, 8)).toBe("p8");
  expect(cutlineAfter(visibleRows(ROWS, { clubOnly: true }), 8)).toBe("p3");
  expect(cutlineAfter(ROWS, null)).toBeNull();
  expect(cutlineAfter(ROWS, 20)).toBeNull();
  expect(cutlineAfter(ROWS.slice(10), 8)).toBeNull();
  // Gleichstand auf der Grenze: beide Zeilen mit Rang 2 sind drin.
  const tied = [{ key: "a", rank: 1 }, { key: "b", rank: 2 }, { key: "c", rank: 2 }, { key: "d", rank: 4 }];
  expect(cutlineAfter(tied, 2)).toBe("c");
});

test("Handy: Top 10 plus Vereinsspieler dahinter, aufgeklappt alles", () => {
  expect(mobileRows(ROWS).map((row) => row.key)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p13"]);
  expect(mobileRows(ROWS, { expanded: true })).toHaveLength(14);
});

test("ein ausgeblendeter Name bleibt ausgeblendet", () => {
  expect(nameOf({ name: null, name_hidden: true })).toBe(HIDDEN_NAME);
  expect(nameOf({ name: "Probe Alpha" })).toBe("Probe Alpha");
});

test("Ergebniszelle: Punkte, Platz und gestrichen für Screenreader", () => {
  const row = { results: [{ round_id: "r1", place: 2, points: 8, dropped: true }, { round_id: "r2", place: 1, points: 10.5 }] };
  expect(resultIn(row, "r1").points).toBe(8);
  expect(resultIn(row, "r9")).toBeNull();
  expect(resultLabel(resultIn(row, "r1"), "Q1")).toBe("Q1: 8 Punkte, Platz 2, gestrichen");
  expect(resultLabel(resultIn(row, "r2"), "Q2")).toBe("Q2: 10,5 Punkte, Platz 1");
  expect(resultLabel(null, "Q3")).toBe("Q3: nicht dabei");
  expect(resultLabel({ round_id: "r4", place: 10, points: 1 }, "Q4")).toBe("Q4: 1 Punkt, Platz 10");
});

test("Spalten: ohne Finale und ohne Runden außerhalb der Wertung", () => {
  const rounds = [{ id: "a" }, { id: "b", counts: false }, { id: "c", kind: "final", counts: false }, { id: "d", kind: "regular" }];
  expect(roundColumns(rounds).map((round) => round.id)).toEqual(["a", "d"]);
});

test("Regeln in Worten", () => {
  expect(schemeLabel({ points_mode: "scheme", points_by_place: [10, 8, 6] })).toBe("Platz 1 bis 3: 10 · 8 · 6");
  expect(schemeLabel({ points_mode: "organizer" })).toBe("Punkte laut Veranstalter");
  expect(countLabel({ count_mode: "drop_n", count_n: 1 })).toBe("Ein Streichergebnis");
  expect(countLabel({ count_mode: "drop_n", count_n: 2 })).toBe("2 Streichergebnisse");
  expect(countLabel({ count_mode: "best_n", count_n: 5 })).toBe("Die besten 5 Ergebnisse zählen");
  expect(countLabel({ count_mode: "all" })).toBe("Alle Runden zählen");
  expect(tiebreakLabel({ tiebreakers: ["wins", "latest_result"] })).toBe("mehr Siege, dann besseres Ergebnis in der letzten Runde");
  expect(tiebreakLabel({ tiebreakers: [] })).toBe("Gleichstand teilt den Platz");
  expect(tiebreakHint("wins")).toBe("Gleich viele Punkte – dahinter wegen: mehr Siege");
  expect(tiebreakHint(null)).toBe("");
});
