import { finalNeeds, maxRoundPoints } from "./finalCalc";

// „Was braucht X fürs Finale“ (#1745): ein Richtwert aus dem gespeicherten Stand - Abstand zur Finalgrenze und der
// nötige Schnitt in den offenen Runden. Nur erfundene Namen.

const ROWS = [
  { key: "a", rank: 1, points: 30 },
  { key: "b", rank: 2, points: 24 },
  { key: "c", rank: 3, points: 20 },
  { key: "d", rank: 4, points: 12 },
];

test("ohne Finalgrenze gibt es keine Rechnung", () => {
  expect(finalNeeds(ROWS[3], ROWS, { topN: null, remaining: 2 })).toEqual({ status: "none" });
});

test("hinter der Grenze: Abstand und nötiger Schnitt je offener Runde", () => {
  const result = finalNeeds(ROWS[3], ROWS, { topN: 2, remaining: 2, maxPerRound: 10 });
  expect(result).toMatchObject({ status: "outside", gap: 12, perRound: 6, remaining: 2, reachable: true, approximate: true });
});

test("ein Schnitt über dem Höchstwert je Runde ist nicht mehr erreichbar", () => {
  expect(finalNeeds(ROWS[3], ROWS, { topN: 2, remaining: 1, maxPerRound: 10 })).toMatchObject({ status: "outside", gap: 12, reachable: false });
});

test("ohne Höchstwert (Punkte laut Veranstalter) bleibt erreichbar offen", () => {
  expect(finalNeeds(ROWS[2], ROWS, { topN: 2, remaining: 3, maxPerRound: null })).toMatchObject({ gap: 4, perRound: 4 / 3, reachable: null });
});

test("innerhalb der Grenze: Vorsprung auf den ersten dahinter", () => {
  expect(finalNeeds(ROWS[0], ROWS, { topN: 2, remaining: 1 })).toMatchObject({ status: "inside", lead: 10 });
  expect(finalNeeds(ROWS[1], ROWS, { topN: 2, remaining: 1 })).toMatchObject({ status: "inside", lead: 4 });
});

test("keine offenen Runden: der Stand entscheidet", () => {
  expect(finalNeeds(ROWS[1], ROWS, { topN: 2, remaining: 0 })).toEqual({ status: "qualified" });
  expect(finalNeeds(ROWS[3], ROWS, { topN: 2, remaining: 0 })).toEqual({ status: "out" });
});

test("gleich viele Punkte wie die Grenze: Gleichstand, der Vorrang entscheidet", () => {
  const rows = [{ key: "a", rank: 1, points: 10 }, { key: "b", rank: 2, points: 10 }];
  expect(finalNeeds(rows[1], rows, { topN: 1, remaining: 1, maxPerRound: 10 })).toMatchObject({ status: "outside", gap: 0, perRound: 0 });
});

test("weniger Spieler als Finalplätze: alle sind drin", () => {
  expect(finalNeeds(ROWS[3], ROWS, { topN: 8, remaining: 2 })).toMatchObject({ status: "inside", lead: null });
});

test("Höchstwert je Runde aus dem Punkteschlüssel samt Boni", () => {
  expect(maxRoundPoints({ points_mode: "scheme", points_by_place: [25, 18, 15], bonuses: { fastest_lap: { points: 1 }, pole: { points: 0 } } })).toBe(26);
  expect(maxRoundPoints({ points_mode: "organizer", points_by_place: [] })).toBeNull();
  expect(maxRoundPoints({ points_mode: "scheme", points_by_place: [], activity_points: { points: 2 } })).toBeNull();
  expect(maxRoundPoints({ points_mode: "scheme", points_by_place: [10, 8], activity_points: { points: 2 } })).toBe(12);
});
