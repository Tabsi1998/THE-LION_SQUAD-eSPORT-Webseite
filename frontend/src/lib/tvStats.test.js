// Statistik-Häppchen (#1124): die Zahlen stimmen mit den Ergebnissen; Freilos, abgesagte und nicht gespielte Spiele zählen
// nicht; bei Gleichstand alle Gleichen oder eine andere Zahl; vor dem ersten Ergebnis keine Folie.
import { decide, find, heats, singleElimination } from "../../e2e/fixtures/tvBrackets.mjs";
import { countsAsGame, statsTiles, wasPlayed } from "./tvStats";

function namer(bracket) {
  const names = new Map(bracket.registrations.map((reg) => [reg.id, reg.display_name]));
  return (id) => names.get(id) || "";
}

test("vor dem ersten Ergebnis gibt es keine Zahlen", () => {
  const bracket = singleElimination(8);
  expect(statsTiles(bracket.matches_v2, namer(bracket))).toEqual([]);
});

test("Duelle: gespielt von allen, meiste Siege, knappster Abstand mit Namen", () => {
  const bracket = singleElimination(8);
  decide(bracket, "A", ["r1", "r8"]);
  decide(bracket, "B", ["r4", "r5"]);
  decide(bracket, "E", ["r1", "r4"]);
  // Knapp: in B 3:2.
  find(bracket, "B").results = [{ registration_id: "r4", rank: 1, score: 3 }, { registration_id: "r5", rank: 2, score: 2 }];
  find(bracket, "A").results = [{ registration_id: "r1", rank: 1, score: 3 }, { registration_id: "r8", rank: 2, score: 0 }];
  find(bracket, "E").results = [{ registration_id: "r1", rank: 1, score: 3 }, { registration_id: "r4", rank: 2, score: 1 }];
  const tiles = statsTiles(bracket.matches_v2, namer(bracket));
  expect(tiles.map((tile) => tile.kind)).toEqual(["played", "wins", "closest"]);
  expect(tiles[0]).toMatchObject({ played: 3, total: 7 });
  expect(tiles[1]).toMatchObject({ names: ["NeonFalke"], wins: 2, text: "2 Spiele gewonnen" });
  expect(tiles[2]).toMatchObject({ gap: 1, big: "1 Punkt", text: "zwischen PixelPaula und DriftDaniel in Spiel B." });
});

test("Gleichstand: bis zu drei Namen - sind es mehr, fällt die Kachel weg", () => {
  const bracket = singleElimination(8);
  decide(bracket, "A", ["r1", "r8"]);
  decide(bracket, "B", ["r4", "r5"]);
  let tiles = statsTiles(bracket.matches_v2, namer(bracket));
  expect(tiles.find((tile) => tile.kind === "wins")).toMatchObject({ names: ["NeonFalke", "PixelPaula"], text: "je 1 Spiel gewonnen" });
  decide(bracket, "C", ["r2", "r7"]);
  tiles = statsTiles(bracket.matches_v2, namer(bracket));
  // Gleich knapp in bis zu drei Spielen: die Spiele, ohne Namen.
  expect(tiles.find((tile) => tile.kind === "closest")).toMatchObject({ gap: 10, big: "10 Punkte", text: "Abstand in Spiel A, Spiel B und Spiel C." });
  decide(bracket, "D", ["r3", "r6"]);
  tiles = statsTiles(bracket.matches_v2, namer(bracket));
  expect(tiles.find((tile) => tile.kind === "wins")).toBeUndefined();
  expect(tiles.find((tile) => tile.kind === "closest")).toBeUndefined();
  expect(tiles.map((tile) => tile.kind)).toEqual(["played"]);
});

test("Durchgänge: „Durchgänge gewonnen“, der knappste Abstand zwischen zwei Plätzen nacheinander", () => {
  const bracket = heats(8);
  decide(bracket, "A", ["r1", "r4", "r5", "r8"]);
  find(bracket, "A").results = [
    { registration_id: "r1", rank: 1, score: 54 }, { registration_id: "r4", rank: 2, score: 49 },
    { registration_id: "r5", rank: 3, score: 48 }, { registration_id: "r8", rank: 4, score: 30 },
  ];
  const tiles = statsTiles(bracket.matches_v2, namer(bracket));
  expect(tiles[1]).toMatchObject({ names: ["NeonFalke"], text: "1 Durchgang gewonnen" });
  expect(tiles[2]).toMatchObject({ big: "1 Punkt", text: "zwischen PixelPaula und DriftDaniel in Durchgang A." });
});

test("Freilos, abgesagt und kampflos zählen nicht - weder gespielt noch insgesamt", () => {
  const bracket = singleElimination(8);
  decide(bracket, "A", ["r1", "r8"]);
  find(bracket, "B").status = "cancelled";
  find(bracket, "C").status = "forfeit";
  find(bracket, "D").slots[1] = { ...find(bracket, "D").slots[1], registration_id: null, status: "bye" };
  expect(countsAsGame(find(bracket, "B"))).toBe(false);
  expect(countsAsGame(find(bracket, "C"))).toBe(false);
  expect(countsAsGame(find(bracket, "D"))).toBe(false);
  expect(wasPlayed(find(bracket, "A"))).toBe(true);
  expect(statsTiles(bracket.matches_v2, namer(bracket))[0]).toMatchObject({ played: 1, total: 4 });
});

test("ohne Punkte keine Abstand-Kachel; punktgleich sagt es so", () => {
  const bracket = singleElimination(8);
  decide(bracket, "A", ["r1", "r8"]);
  find(bracket, "A").results = [{ registration_id: "r1", rank: 1 }, { registration_id: "r8", rank: 2 }];
  expect(statsTiles(bracket.matches_v2, namer(bracket)).map((tile) => tile.kind)).toEqual(["played", "wins"]);
  find(bracket, "A").results = [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r8", rank: 2, score: 2 }];
  expect(statsTiles(bracket.matches_v2, namer(bracket))[2]).toMatchObject({ big: "Punktgleich", text: "NeonFalke und SchnellSchnecke in Spiel A – entschieden hat die Wertung." });
});
