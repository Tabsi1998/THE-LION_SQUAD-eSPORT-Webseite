import { SEASON_RESULT_LABELS, defaultTierOrder, moveTier, seasonNote, tierOrderList, tierRank, tierRankFromName } from "./seriesTiers";

// Auf- und Abstieg je Saison (#1898): zuerst der Vermerk der Saison, dann die eigene Reihenfolge der Spur, erst dann
// die Zahl im Stufennamen.

test("die Zahl im Namen ist der Rückfall: Liga 1 vor Liga 2, Jahreszahlen und Formate zählen nicht", () => {
  expect(tierRankFromName("Division 2")).toBe(2);
  expect(tierRankFromName("1. Liga")).toBe(1);
  expect(tierRankFromName("4v4 Liga 3")).toBe(3);
  expect(tierRankFromName("Saison 2026")).toBe(Infinity);
  expect(tierRankFromName("Gold")).toBe(Infinity);
});

test("eine eigene Reihenfolge der Spur gilt vor der Zahl im Namen", () => {
  expect(tierRank("Gold", ["Gold", "Silber"])).toBe(1);
  expect(tierRank(" silber ", ["Gold", "Silber"])).toBe(2);
  expect(tierRank("Bronze", ["Gold", "Silber"])).toBe(Infinity);
  // Die Spur dreht die Zahl um: „Liga 3“ ist hier die höchste Stufe.
  expect(tierRank("Liga 3", ["Liga 3", "Liga 1"])).toBeLessThan(tierRank("Liga 1", ["Liga 3", "Liga 1"]));
  expect(tierRank("Liga 1", [])).toBe(1);
  expect(tierRank("Liga 1", null)).toBe(1);
});

test("Vermerk „Aufstieg“ zeigt Aufstieg, auch wenn die Namen keine Zahl tragen", () => {
  expect(seasonNote({ tier: "Gold", season_result: "promoted" }, { tier: "Platin" })).toBe("Aufstieg");
  expect(seasonNote({ tier: "Liga 2", season_result: "relegated" }, { tier: "Liga 1" })).toBe("Abstieg");
  expect(seasonNote({ tier: "Liga 1", season_result: "champion" }, null)).toBe("Meister");
  expect(seasonNote({ tier: "Liga 1", season_result: "stayed" }, { tier: "Liga 1" })).toBe("Klassenerhalt");
  expect(SEASON_RESULT_LABELS).toEqual({ promoted: "Aufstieg", relegated: "Abstieg", stayed: "Klassenerhalt", champion: "Meister" });
});

test("ohne Vermerk: erst die eigene Reihenfolge, dann die Ableitung aus dem Namen", () => {
  expect(seasonNote({ tier: "Silber" }, { tier: "Gold" }, ["Gold", "Silber"])).toBe("Aufstieg");
  expect(seasonNote({ tier: "Gold" }, { tier: "Silber" })).toBe("");
  expect(seasonNote({ tier: "Liga 2" }, { tier: "Liga 1" })).toBe("Aufstieg");
  expect(seasonNote({ tier: "Liga 1" }, { tier: "Liga 2" })).toBe("Abstieg");
  expect(seasonNote({ tier: "Liga 1" }, { tier: "Liga 1" })).toBe("");
  expect(seasonNote({ tier: "Liga 1" }, null)).toBe("");
});

test("Formular: Vorgabe nach der Zahl, eigene Reihenfolge vorne, fehlende Stufen dahinter, verschieben", () => {
  expect(defaultTierOrder(["Liga 3", "Liga 1", "liga 1", "", "Gold", "Liga 2"])).toEqual(["Liga 1", "Liga 2", "Liga 3", "Gold"]);
  expect(tierOrderList(["Liga 2", "Liga 1", "Gold"], ["Gold", "Liga 2"])).toEqual(["Gold", "Liga 2", "Liga 1"]);
  expect(tierOrderList(["Liga 2", "Liga 1"], null)).toEqual(["Liga 1", "Liga 2"]);
  expect(moveTier(["A", "B", "C"], 2, -1)).toEqual(["A", "C", "B"]);
  expect(moveTier(["A", "B"], 0, -1)).toEqual(["A", "B"]);
});
