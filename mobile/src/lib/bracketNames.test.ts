import fs from "fs";
import path from "path";
import { bracketEdges, heatText, type BracketMatch } from "./bracketGraph";
import { displayRoundLabels, matchName, treeSlotLabel } from "./bracketNames";
import { finderFor } from "./slotSource";

// Namen im Turnierbaum (#1633): dieselben Fälle wie im Web (frontend/src/lib/bracketNames.test.js, #1591) - auf den
// Bäumen aus dem echten Generator (frontend/e2e/fixtures/bracketLines.json, scripts/make_ffa_bracket_fixture.py --lines).
const LINES = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/e2e/fixtures/bracketLines.json"), "utf8"));
const clone = (state: string): BracketMatch[] => JSON.parse(JSON.stringify(LINES[state].matches_v2));
const ffa = () => displayRoundLabels(clone("ffa16de_start"));
const byKey = (matches: BracketMatch[]) => new Map(matches.map((match) => [match.match_key, match]));

describe("displayRoundLabels", () => {
  test("die erste sichtbare Loser-Runde heißt „Loser Runde 1“, fortlaufend je Abschnitt", () => {
    const keys = byKey(ffa());
    expect(["LA", "LC", "LE", "LF"].map((key) => keys.get(key)?.round_label)).toEqual(["Loser Runde 1", "Loser Runde 2", "Loser Runde 3", "Loser Runde 4"]);
    expect(["A", "E", "G", "FINAL"].map((key) => keys.get(key)?.round_label)).toEqual(["Runde 1", "Runde 2", "Finale", "Grand Final"]);
  });

  test("richtige Namen bleiben, wie sie sind - die Eingabe auch", () => {
    const matches = clone("de8_fixed");
    expect(displayRoundLabels(matches).map((match) => match.round_label)).toEqual(matches.map((match) => match.round_label));
    const raw = clone("ffa16de_start");
    displayRoundLabels(raw);
    expect(byKey(raw).get("LA")?.round_label).toBe("Loser Runde 2");
  });
});

describe("matchName", () => {
  test("kurze Kürzel bleiben, ein Wort als Kürzel nimmt den Rundennamen", () => {
    const keys = byKey(ffa());
    expect(matchName(keys.get("LA"))).toBe("LA");
    expect(matchName(keys.get("FINAL"))).toBe("Grand Final");
    // Abschnitt „FINAL“ (Abnahme-Cup) ist wie am Server das Grand Final.
    expect(matchName({ match_key: "GF", section: "FINAL", round_label: "Grand Final" })).toBe("Grand Final");
  });

  test("Lauf-Karte: „Grand Final“ statt „Lauf FINAL“, Weiterkommen „→ Grand Final“", () => {
    const matches = ffa();
    const keys = byKey(matches);
    const edges = bracketEdges(matches);
    const final = keys.get("FINAL") as BracketMatch;
    expect(heatText(final, edges, matches, final.id).name).toBe("Grand Final");
    expect(heatText(keys.get("G") as BracketMatch, edges, matches, null).cut).toBe("2 kommen weiter → Grand Final");
    expect(heatText(keys.get("A") as BracketMatch, edges, matches, null).name).toBe("Lauf A");
  });
});

describe("treeSlotLabel", () => {
  const labels = (key: string) => {
    const matches = ffa();
    const find = finderFor(matches);
    const match = byKey(matches).get(key) as BracketMatch;
    return (match.slots || []).map((slot) => treeSlotLabel(slot, find(match) as never));
  };

  test("gemischt: wer kommt, statt „Platz aus Runde 1“", () => {
    expect(labels("E")).toEqual(Array(4).fill("Weiter aus Runde 1"));
    expect(labels("LA")).toEqual(Array(4).fill("Verlierer aus Runde 1"));
    expect(labels("LC")).toEqual(["Weiter aus Loser Runde 1", "Weiter aus Loser Runde 1", "Verlierer aus Runde 2", "Verlierer aus Runde 2"]);
  });

  test("aus einem Duell kommt der Sieger", () => {
    const matches = displayRoundLabels(clone("ffa16de_start").map((match) => (match.match_key === "A" ? { ...match, match_type: "duel", slots: (match.slots || []).slice(0, 2) } : match)));
    const find = finderFor(matches);
    const e = byKey(matches).get("E") as BracketMatch;
    expect(treeSlotLabel((e.slots || [])[0], find(e) as never)).toBe("Sieger aus Runde 1");
  });

  test("fester Baum bleibt bei „Sieger aus E“", () => {
    expect(labels("G")).toEqual(["Sieger aus E", "Platz 2 aus E", "Sieger aus F", "Platz 2 aus F"]);
  });
});
