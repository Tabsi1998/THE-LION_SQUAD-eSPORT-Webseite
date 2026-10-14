import { describe, expect, it } from "vitest";
import LINES from "../../e2e/fixtures/bracketLines.json";
import { bracketEdges, heatText } from "./bracketGraph";
import { displayRoundLabels, matchName, treeSlotLabel } from "./bracketNames";
import { finderFor } from "./slotSource";

// Namen im Turnierbaum (#1591): fortlaufende Runden je Abschnitt, „Grand Final“ statt „Lauf FINAL“, klare Plätze.
const ffa = () => displayRoundLabels(structuredClone(LINES.ffa16de_start.matches_v2));
const byKey = (matches) => new Map(matches.map((match) => [match.match_key, match]));

describe("displayRoundLabels", () => {
  it("die erste sichtbare Loser-Runde heißt „Loser Runde 1“, fortlaufend je Abschnitt", () => {
    const keys = byKey(ffa());
    expect(["LA", "LC", "LE", "LF"].map((key) => keys.get(key).round_label)).toEqual(["Loser Runde 1", "Loser Runde 2", "Loser Runde 3", "Loser Runde 4"]);
    expect(["A", "E", "G", "FINAL"].map((key) => keys.get(key).round_label)).toEqual(["Runde 1", "Runde 2", "Finale", "Grand Final"]);
  });

  it("richtige Namen bleiben, wie sie sind", () => {
    const matches = structuredClone(LINES.de8_fixed.matches_v2);
    expect(displayRoundLabels(matches).map((match) => match.round_label)).toEqual(matches.map((match) => match.round_label));
  });

  it("ändert die Eingabe nicht", () => {
    const matches = structuredClone(LINES.ffa16de_start.matches_v2);
    displayRoundLabels(matches);
    expect(byKey(matches).get("LA").round_label).toBe("Loser Runde 2");
  });
});

describe("matchName", () => {
  it("kurze Kürzel bleiben, ein Wort als Kürzel nimmt den Rundennamen", () => {
    const keys = byKey(ffa());
    expect(matchName(keys.get("LA"))).toBe("LA");
    expect(matchName(keys.get("FINAL"))).toBe("Grand Final");
  });

  it("Lauf-Karte: „Grand Final“ statt „Lauf FINAL“, Weiterkommen „→ Grand Final“", () => {
    const matches = ffa();
    const keys = byKey(matches);
    const edges = bracketEdges(matches);
    expect(heatText(keys.get("FINAL"), edges, matches, keys.get("FINAL").id).name).toBe("Grand Final");
    expect(heatText(keys.get("G"), edges, matches).cut).toBe("2 kommen weiter → Grand Final");
    expect(heatText(keys.get("A"), edges, matches).name).toBe("Lauf A");
  });
});

describe("treeSlotLabel", () => {
  const labels = (key) => {
    const matches = ffa();
    const find = finderFor(matches);
    const match = byKey(matches).get(key);
    return match.slots.map((slot) => treeSlotLabel(slot, find(match)));
  };

  it("gemischt: wer kommt, statt „Platz aus Runde 1“", () => {
    expect(labels("E")).toEqual(Array(4).fill("Weiter aus Runde 1"));
    expect(labels("LA")).toEqual(Array(4).fill("Verlierer aus Runde 1"));
    expect(labels("LC")).toEqual(["Weiter aus Loser Runde 1", "Weiter aus Loser Runde 1", "Verlierer aus Runde 2", "Verlierer aus Runde 2"]);
  });

  it("aus einem Duell kommt der Sieger", () => {
    const matches = structuredClone(LINES.ffa16de_start.matches_v2).map((match) => (match.match_key === "A" ? { ...match, match_type: "duel", slots: match.slots.slice(0, 2) } : match));
    const find = finderFor(matches);
    const e = matches.find((match) => match.match_key === "E");
    expect(treeSlotLabel(e.slots[0], find(e))).toBe("Sieger aus Runde 1");
  });

  it("fester Baum bleibt bei „Sieger aus E“", () => {
    expect(labels("G")).toEqual(["Sieger aus E", "Platz 2 aus E", "Sieger aus F", "Platz 2 aus F"]);
  });
});
