import { describe, expect, it } from "vitest";
import {
  MAPS_TIEBREAKERS, byMaps, hidesDraws, pointsModeChange, pointsNote, pointsSummary, standingNotes, tableRulesPayload, tableRulesToForm, tiebreakOrder,
} from "./leagueTable";

describe("Tabelle der Liga-Staffel (E.1, #1625)", () => {
  it("nennt, was den Gleichstand entschied - mit Grund beim Entscheid der Leitung", () => {
    expect(standingNotes({ tiebreak: "head_to_head" }).map((note) => note.text)).toEqual(["Direkter Vergleich"]);
    const decided = standingNotes({ tiebreak: "lead_decision", lead_decision: { reason: "Los vor beiden Captains" } });
    expect(decided[0]).toMatchObject({ text: "Platz durch Entscheid der Leitung", reason: "Los vor beiden Captains" });
    // Art des Entscheids (F.1, Nr. 156): Entscheidungsspiel und Los heißen so.
    expect(standingNotes({ tiebreak: "lead_decision", lead_decision: { reason: "2:1", method: "playoff" } })[0].text).toBe("Platz durch Entscheidungsspiel");
    expect(standingNotes({ tiebreak: "lead_decision", lead_decision: { reason: "Münze", method: "lot" } })[0].text).toBe("Platz durch Losentscheid");
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
    // #2312: die Punkteart fehlt bei älteren Seasons - dann Sieg/Remis/Niederlage, wie der Server rechnet.
    expect(tableRulesToForm({})).toEqual({ match_points_mode: "result", table_tiebreakers: ["score_diff", "score_for"],
      head_to_head_criteria: ["points", "score_diff", "score_for"], allow_draws: true, forfeit_score: "recorded", exit_rule: "half" });
    const form = tableRulesToForm({ table_tiebreakers: ["head_to_head", "lead_decision"], allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" });
    expect(tableRulesPayload(form)).toEqual({ match_points_mode: "result", table_tiebreakers: ["head_to_head", "lead_decision"],
      head_to_head_criteria: ["points", "score_diff", "score_for"], allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" });
    expect(tiebreakOrder(["head_to_head", "score_diff", "lead_decision"])).toBe("Punkte → Direkter Vergleich → Map-Differenz → Entscheid der Leitung");
  });
});

describe("Punkte nach gewonnenen Maps (#2312)", () => {
  it("schlägt beim Wechsel die Reihenfolge und kampflos 3:0 vor, zurück nur die Art", () => {
    expect(pointsModeChange("maps")).toEqual({ match_points_mode: "maps", table_tiebreakers: ["wins", "head_to_head", "score_diff", "lead_decision"],
      forfeit_score: "best_of" });
    expect(pointsModeChange("result")).toEqual({ match_points_mode: "result" });
    expect(pointsModeChange("maps").table_tiebreakers).not.toBe(MAPS_TIEBREAKERS);
    expect(tiebreakOrder(MAPS_TIEBREAKERS)).toBe("Punkte → Mehr Siege → Direkter Vergleich → Map-Differenz → Entscheid der Leitung");
  });

  it("liest und schreibt die Art", () => {
    const form = tableRulesToForm({ match_points_mode: "maps", table_tiebreakers: [...MAPS_TIEBREAKERS] });
    expect(form.match_points_mode).toBe("maps");
    expect(tableRulesPayload(form).match_points_mode).toBe("maps");
    expect(tableRulesToForm({ match_points_mode: "unsinn" }).match_points_mode).toBe("result");
  });

  it("sagt öffentlich, was die Punkte zählen", () => {
    expect(byMaps({ match_points_mode: "maps" })).toBe(true);
    expect(byMaps(null)).toBe(false);
    expect(pointsNote({ match_points_mode: "maps" })).toBe("Punkte = gewonnene Maps (3:2 ergibt 3 und 2, kampflos 3:0)");
    expect(pointsNote({ match_points_mode: "result" })).toBe("");
    expect(pointsSummary({ match_points_mode: "maps", match_points: { win: 3, draw: 0, loss: 0 } })).toBe("Punkte je gewonnene Map");
    expect(pointsSummary({ match_points: { win: 3, draw: 1, loss: 0 } })).toBe("Sieg / Remis / Niederlage: 3 / 1 / 0");
    expect(pointsSummary({})).toBe("");
  });
});
