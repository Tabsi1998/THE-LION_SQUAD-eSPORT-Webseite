import { leaders, metricText, rankBy } from "./seasonStatistics";

// Statistik der Saison (#1950): Rangliste je Kennzahl, Gleichstand teilt den Platz, Nullen als Strich. Nur erfundene
// Namen.

const rows = [
  { key: "a", name: "Probe Anna", wins: 2, poles: 0, avg_grid: 3.5, gained: -2 },
  { key: "b", name: "Probe Ben", wins: 1, poles: 3, avg_grid: 1.5, gained: 5 },
  { key: "c", name: "Probe Cleo", wins: 2, poles: 1, avg_grid: null, gained: 0 },
  { key: "d", name: null, name_hidden: true, wins: 0, poles: 0, avg_grid: 6, gained: null },
];

test("Rangliste: meiste Siege zuerst, Gleichstand teilt den Platz, ohne Wert hinten", () => {
  const ranked = rankBy(rows, "wins");
  expect(ranked.map((entry) => [entry.row.key, entry.rank])).toEqual([["a", 1], ["c", 1], ["b", 3], ["d", null]]);
});

test("Durchschnitt: der kleinste ist der beste", () => {
  expect(rankBy(rows, "avg_grid").map((entry) => [entry.row.key, entry.rank])).toEqual([["b", 1], ["a", 2], ["d", 3], ["c", null]]);
});

test("Spitze je Kennzahl nur mit Wert", () => {
  expect(leaders(rows, "poles").map((entry) => entry.row.key)).toEqual(["b", "c"]);
  expect(leaders(rows, "poles", 1).map((entry) => entry.row.key)).toEqual(["b"]);
});

test("Werte als Text: Komma, Vorzeichen, Strich statt Null", () => {
  expect(metricText(rows[0], "avg_grid")).toBe("3,5");
  expect(metricText(rows[1], "gained")).toBe("+5");
  expect(metricText(rows[0], "gained")).toBe("−2");
  expect(metricText(rows[2], "gained")).toBe("–");
  expect(metricText(rows[3], "wins")).toBe("–");
});
