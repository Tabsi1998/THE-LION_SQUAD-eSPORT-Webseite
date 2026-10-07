// Sponsoren am TV (#1125): welche Schalter-Kombination was zeigt, Sponsoren der Reihe nach, „präsentiert von“ solange die
// Runde läuft - und weg, wenn sie fertig ist.
import { decide, doubleElimination, play, singleElimination, start } from "../../e2e/fixtures/tvBrackets.mjs";
import { currentRound, presentedBy, sponsorFor, sponsorPlan, tvSponsors } from "./tvSponsors";

const SPONSORS = [
  { id: "sp1", name: "Pixelwerk", logo_url: "/a.png" },
  { id: "sp2", name: "Morgenrot", logo_url: "/b.png" },
  { id: "sp3", name: "Ohne Logo", logo_url: "" },
  { id: "sp1", name: "Pixelwerk doppelt", logo_url: "/a.png" },
];

test("jede Kombination der drei Schalter - alle aus heißt keine Sponsoren am TV", () => {
  const list = tvSponsors(SPONSORS);
  for (const moment of [true, false]) {
    for (const presented of [true, false]) {
      for (const ticker of [true, false]) {
        const plan = sponsorPlan({ sponsor_moment: moment, sponsor_presented: presented, sponsor_ticker: ticker }, list);
        expect(plan).toEqual({ moment, presented, ticker });
      }
    }
  }
  // Ohne Sponsoren mit Logo gibt es keinen Moment, auch wenn er eingeschaltet ist.
  expect(sponsorPlan({ sponsor_moment: true }, []).moment).toBe(false);
  // Standard (Wahl C): Moment an, „präsentiert von“ an, Laufband aus.
  expect(sponsorPlan({ sponsor_moment: true, sponsor_presented: true, sponsor_ticker: false }, list)).toEqual({ moment: true, presented: true, ticker: false });
});

test("die Sponsoren kommen der Reihe nach dran - nur mit Logo, jeder einmal", () => {
  const list = tvSponsors(SPONSORS);
  expect(list.map((sponsor) => sponsor.id)).toEqual(["sp1", "sp2"]);
  expect([0, 1, 2, 3].map((count) => sponsorFor(list, count).id)).toEqual(["sp1", "sp2", "sp1", "sp2"]);
  expect(sponsorFor([], 0)).toBeNull();
});

test("die Runde im Bild: die mit einem laufenden Spiel, sonst die nächste bereite - nie eine fertige", () => {
  const bracket = singleElimination(8);
  expect(currentRound(bracket.matches_v2).first.round).toBe(1);
  play(bracket, ["A", "B", "C", "D"]);
  expect(currentRound(bracket.matches_v2).first.round).toBe(2);
  start(bracket, "E", { station: "PC 1" });
  expect(currentRound(bracket.matches_v2).live).toBe(true);
});

test("„präsentiert von“ steht, solange die Runde läuft, und verschwindet, wenn sie fertig ist", () => {
  const bracket = singleElimination(8);
  play(bracket, ["A", "B", "C", "D"]);
  const tournament = { round_sponsors: [{ stage_id: "stage-1", section: "WB", round: 2, sponsor_id: "sp2" }] };
  const list = tvSponsors(SPONSORS);
  expect(presentedBy(tournament, bracket.matches_v2, list)).toMatchObject({ label: "Runde 2", sponsor: { id: "sp2" } });
  // Runde 1 hatte keinen Sponsor - vorher stand nichts.
  expect(presentedBy(tournament, singleElimination(8).matches_v2, list)).toBeNull();
  // Runde 2 fertig: weg.
  decide(bracket, "E");
  decide(bracket, "F");
  expect(presentedBy(tournament, bracket.matches_v2, list)).toBeNull();
  // Ein Sponsor, der nicht (mehr) in der TV-Liste steht, wird nicht gezeigt.
  const other = singleElimination(8);
  play(other, ["A", "B", "C", "D"]);
  expect(presentedBy({ round_sponsors: [{ section: "WB", round: 2, sponsor_id: "weg" }] }, other.matches_v2, list)).toBeNull();
  // Ohne Phase im Eintrag gilt er für jede Phase.
  expect(presentedBy({ round_sponsors: [{ section: "WB", round: 2, sponsor_id: "sp1" }] }, other.matches_v2, list).sponsor.id).toBe("sp1");
});

test("Loser Bracket: die Runde heißt, wie sie im Baum steht", () => {
  const bracket = doubleElimination(8);
  play(bracket, ["A", "B", "C", "D"]);
  start(bracket, "LA", { station: "PC 2" });
  const tournament = { round_sponsors: [{ section: "LB", round: 2, sponsor_id: "sp1" }] };
  const shown = presentedBy(tournament, bracket.matches_v2, tvSponsors(SPONSORS));
  expect(shown).toMatchObject({ label: "Loser Runde 1", sponsor: { id: "sp1" } });
});
