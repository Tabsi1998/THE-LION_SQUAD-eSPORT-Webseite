import { describe, expect, it } from "vitest";
import { hidesDraws, standingNotes, tableRulesPayload, tableRulesToForm, tiebreakOrder } from "./leagueTable";

describe("Tabelle der Liga-Staffel (E.1, #1625)", () => {
  it("nennt, was den Gleichstand entschied - mit Grund beim Entscheid der Leitung", () => {
    expect(standingNotes({ tiebreak: "head_to_head" }).map((note) => note.text)).toEqual(["Direkter Vergleich"]);
    const decided = standingNotes({ tiebreak: "lead_decision", lead_decision: { reason: "Los vor beiden Captains" } });
    expect(decided[0]).toMatchObject({ text: "Platz durch Entscheid der Leitung", reason: "Los vor beiden Captains" });
    expect(standingNotes({ tiebreak: null })).toEqual([]);
    expect(standingNotes(null)).toEqual([]);
  });

  it("zeigt kampflos, Abzug und das Tabellenende", () => {
    const texts = standingNotes({ forfeit_won: 2, forfeit_lost: 1, deducted_points: 3 }).map((note) => note.text);
    expect(texts).toEqual(["2× kampflos gewonnen", "1× kampflos verloren", "−3 Punkte Abzug"]);
    const gone = standingNotes({ exit: { kind: "disqualified" }, forfeit_lost: 5 }).map((note) => note.text);
    expect(gone).toEqual(["Disqualifiziert"]);
    expect(standingNotes({ exit: { kind: "withdrawn" } })[0].text).toBe("Ausgetreten");
  });

  it("blendet „U“ nur aus, wenn die Season kein Remis kennt und keines vorkommt", () => {
    expect(hidesDraws({ allow_draws: false }, [{ drawn: 0 }])).toBe(true);
    expect(hidesDraws({ allow_draws: false }, [{ drawn: 1 }])).toBe(false);
    expect(hidesDraws({ allow_draws: true }, [])).toBe(false);
    expect(hidesDraws(null, [])).toBe(false);
  });

  it("liest ältere Seasons wie der Server und schreibt alle Felder zurück", () => {
    expect(tableRulesToForm({})).toEqual({ table_tiebreakers: ["score_diff", "score_for"], head_to_head_criteria: ["points", "score_diff", "score_for"],
      allow_draws: true, forfeit_score: "recorded", exit_rule: "half" });
    const form = tableRulesToForm({ table_tiebreakers: ["head_to_head", "lead_decision"], allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" });
    expect(tableRulesPayload(form)).toEqual({ table_tiebreakers: ["head_to_head", "lead_decision"], head_to_head_criteria: ["points", "score_diff", "score_for"],
      allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" });
    expect(tiebreakOrder(["head_to_head", "score_diff", "lead_decision"])).toBe("Punkte → Direkter Vergleich → Map-Differenz → Entscheid der Leitung");
  });
});
