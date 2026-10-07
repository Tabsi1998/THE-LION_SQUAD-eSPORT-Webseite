// Durchgänge als Startaufstellung (#1120): Raster und Beschriftung (weiter, Loser Bracket, raus), Weiterkommer nach der
// Einstellung des Durchgangs, 6 und 8 Spieler in zwei versetzten Reihen; was an einer Station läuft oder als Nächstes kommt.
import { gridSubline, isDuelMatch, startGrid, stationLineup } from "./tvGrid";
import { decide, find, heatDoubleElimination, heats, singleElimination, start } from "../../e2e/fixtures/tvBrackets.mjs";

test("vor dem Ergebnis: Startplatz 1 links vorn, 2 rechts dahinter, 3 links in der zweiten Reihe …", () => {
  const bracket = heatDoubleElimination();
  const grid = startGrid(find(bracket, "A"), bracket.matches_v2);
  expect(grid.decided).toBe(false);
  expect(grid.places.map((place) => [place.registrationId, place.col, place.row])).toEqual([["r1", 0, 0], ["r4", 1, 0], ["r5", 0, 1], ["r8", 1, 1]]);
  expect(grid.rows).toBe(2);
  expect(grid.places.map(gridSubline)).toEqual(["Startplatz 1", "Startplatz 2", "Startplatz 3", "Startplatz 4"]);
});

test("nach dem Ergebnis: die Weiterkommer rücken mit „weiter“ nach vorn, die anderen mit „→ Loser Bracket“ zur Seite", () => {
  const bracket = heatDoubleElimination();
  decide(bracket, "A", ["r5", "r1", "r8", "r4"]);
  const grid = startGrid(find(bracket, "A"), bracket.matches_v2);
  expect(grid.decided).toBe(true);
  expect(grid.frontRows).toBe(1);
  expect(grid.places.map((place) => [place.registrationId, place.label, place.back, place.row, place.col])).toEqual([
    ["r5", "weiter", false, 0, 0],
    ["r1", "weiter", false, 0, 1],
    ["r8", "→ Loser Bracket", true, 1, 0],
    ["r4", "→ Loser Bracket", true, 1, 1],
  ]);
  // So viele Weiterkommer, wie der Durchgang einstellt (hier 2).
  expect(grid.places.filter((place) => place.label === "weiter")).toHaveLength(find(bracket, "A").settings.qualifiers_per_match);
  expect(gridSubline(grid.places[0])).toBe("Platz 1 · 42 Punkte");
});

test("ohne Loser Bracket: weiter oder raus; Weiterkommer nach Einstellung (3 von 6)", () => {
  const bracket = heats(12, { size: 6, qualifiers: 3 });
  decide(bracket, "A");
  const grid = startGrid(find(bracket, "A"), bracket.matches_v2);
  expect(grid.places.map((place) => place.label)).toEqual(["weiter", "weiter", "weiter", "raus", "raus", "raus"]);
  expect(grid.frontRows).toBe(2);
  expect(grid.rows).toBe(4);
});

test("6 und 8 Spieler: zwei versetzte Reihen, nie mehr als zwei nebeneinander", () => {
  for (const count of [6, 8]) {
    const bracket = heats(count, { size: count, qualifiers: 2 });
    const grid = startGrid(find(bracket, "A"), bracket.matches_v2);
    expect(grid.places).toHaveLength(count);
    expect(new Set(grid.places.map((place) => place.col))).toEqual(new Set([0, 1]));
    expect(grid.rows).toBe(count / 2);
    // Das Finale (einziger Durchgang) vergibt Endplätze: der Sieger rückt nach vorn.
    decide(bracket, "A");
    const after = startGrid(find(bracket, "A"), bracket.matches_v2);
    expect(after.places[0]).toEqual(expect.objectContaining({ registrationId: "r1", label: "Platz 1", back: false }));
    expect(after.places.slice(1).every((place) => place.back)).toBe(true);
  }
});

test("Duelle bleiben „A gegen B“", () => {
  const bracket = singleElimination(4);
  expect(isDuelMatch(find(bracket, "A"))).toBe(true);
  expect(isDuelMatch(find(heatDoubleElimination(), "A"))).toBe(false);
});

test("an der Station: was läuft, sonst was eingeplant ist, sonst das früheste offene Spiel", () => {
  const bracket = singleElimination(8);
  const stationId = "st-pc-3";
  expect(stationLineup(stationId, { id: stationId }, bracket.matches_v2)).toEqual({ mode: null, match: null });
  find(bracket, "C").station_id = stationId;
  find(bracket, "C").scheduled_at = "2026-10-10T15:00:00+02:00";
  find(bracket, "D").station_id = stationId;
  find(bracket, "D").scheduled_at = "2026-10-10T14:30:00+02:00";
  expect(stationLineup(stationId, { id: stationId }, bracket.matches_v2)).toEqual({ mode: "next", match: find(bracket, "D") });
  // Die Warteschlange der Stationsverwaltung geht vor der Uhrzeit.
  expect(stationLineup(stationId, { id: stationId, queue_match_ids: [find(bracket, "C").id] }, bracket.matches_v2).match).toBe(find(bracket, "C"));
  start(bracket, "B", { station: "PC 3" });
  expect(stationLineup(stationId, { id: stationId }, bracket.matches_v2)).toEqual({ mode: "live", match: find(bracket, "B") });
  decide(bracket, "B");
  expect(stationLineup(stationId, { id: stationId, current_match_id: find(bracket, "B").id }, bracket.matches_v2).match).toBe(find(bracket, "D"));
});
