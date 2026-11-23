import { describe, expect, it } from "vitest";
import {
  SWISS_BEFORE, SWISS_RECOMMENDED, SWISS_TIEBREAK_KEYS, TABLE_BEFORE, TABLE_RECOMMENDED, TABLE_TIEBREAK_KEYS,
  recommendedSwissRounds, swissForm, swissFormError, swissPayload, swissRuleText, swissStateText, swissStatusNote,
  tableRuleLines, tiebreakOrderText, usesTableTiebreakers,
} from "./tournamentTableSettings";
import { STANDING_COLUMNS, tableKind } from "./standingsTable";

describe("Schweizer Einstellungen im Formular (#1559)", () => {
  it("zeigt ohne gespeicherte Einstellung den Stand von vorher", () => {
    expect(swissForm(null)).toEqual(SWISS_BEFORE);
    expect(swissForm(undefined, SWISS_RECOMMENDED)).toEqual(SWISS_RECOMMENDED);
  });

  it("liest gespeicherte Werte und lässt leere Zahlen leer", () => {
    const form = swissForm({ end_rule: "rounds", rounds: 5, top_n: null, wins_to_advance: 2, losses_to_exit: 4, auto_next_round: true, tiebreakers: ["median_buchholz"] });
    expect(form).toEqual({ end_rule: "rounds", rounds: "5", top_n: "", wins_to_advance: "2", losses_to_exit: "4", auto_next_round: true, tiebreakers: ["median_buchholz"] });
  });

  it("schickt Zahlen als Zahlen und Leeres als null", () => {
    expect(swissPayload({ ...SWISS_RECOMMENDED, rounds: "5", top_n: "" })).toEqual({
      end_rule: "rounds", rounds: 5, top_n: null, wins_to_advance: 3, losses_to_exit: 3, auto_next_round: true,
      tiebreakers: ["median_buchholz", "buchholz", "head_to_head", "wins"],
    });
    expect(swissPayload(null)).toBeNull();
  });

  it("sagt, was an den Zahlen nicht passt", () => {
    expect(swissFormError(SWISS_RECOMMENDED)).toBe("");
    expect(swissFormError(null)).toBe("");
    expect(swissFormError({ ...SWISS_RECOMMENDED, rounds: "0" })).toMatch(/Runden/);
    expect(swissFormError({ ...SWISS_RECOMMENDED, rounds: "31" })).toMatch(/Runden/);
    expect(swissFormError({ ...SWISS_RECOMMENDED, top_n: "-1" })).toMatch(/kommen weiter/);
    expect(swissFormError({ ...SWISS_RECOMMENDED, end_rule: "wins_losses", wins_to_advance: "" })).toMatch(/Siege/);
    expect(swissFormError({ ...SWISS_RECOMMENDED, end_rule: "wins_losses", losses_to_exit: "21" })).toMatch(/Niederlagen/);
    // Die Grenzen zählen nur bei ihrer Regel.
    expect(swissFormError({ ...SWISS_RECOMMENDED, end_rule: "rounds", wins_to_advance: "" })).toBe("");
  });

  it("schlägt die Rundenzahl nach der Feldgröße vor", () => {
    expect([2, 4, 8, 9, 16, 17, 32, 33].map(recommendedSwissRounds)).toEqual([1, 2, 3, 4, 4, 5, 5, 6]);
    expect(recommendedSwissRounds("")).toBe(1);
  });

  it("kennt dieselben Kriterien wie der Server", () => {
    expect(SWISS_TIEBREAK_KEYS).toEqual(["median_buchholz", "buchholz", "head_to_head", "wins"]);
    expect(TABLE_TIEBREAK_KEYS).toEqual(["head_to_head", "score_diff", "score_for", "wins"]);
    expect(SWISS_BEFORE.tiebreakers).toEqual(["buchholz", "wins"]);
    expect(TABLE_BEFORE).toEqual(["wins", "score_diff"]);
    expect(TABLE_RECOMMENDED[0]).toBe("head_to_head");
  });
});

describe("Regeln in Worten", () => {
  it("nennt die Abschlussregel", () => {
    expect(swissRuleText({ end_rule: "rounds", rounds: 5, top_n: 8 })).toBe("Gespielt werden 5 Runden. Die besten 8 kommen weiter.");
    expect(swissRuleText({ end_rule: "rounds", rounds: 1 })).toBe("Gespielt wird 1 Runde.");
    expect(swissRuleText({ end_rule: "rounds" })).toBe("Die Zahl der Runden richtet sich nach der Größe des Felds.");
    expect(swissRuleText({ end_rule: "wins_losses", wins_to_advance: 3, losses_to_exit: 3 })).toBe("Wer 3 Siege hat, ist weiter. Wer 3 Niederlagen hat, ist raus.");
    expect(swissRuleText({ end_rule: "wins_losses", wins_to_advance: 1, losses_to_exit: 1 })).toBe("Wer 1 Sieg hat, ist weiter. Wer 1 Niederlage hat, ist raus.");
    expect(swissRuleText({ end_rule: "manual" })).toBe("");
    expect(swissRuleText(null)).toBe("");
  });

  it("schreibt die Reihenfolge mit den Punkten vorn", () => {
    expect(tiebreakOrderText(["head_to_head", "score_diff"], "table")).toBe("Punkte → Direkter Vergleich → Differenz");
    expect(tiebreakOrderText(["median_buchholz", "buchholz", "wins"], "swiss")).toBe("Punkte → Median-Buchholz → Buchholz → Mehr Siege");
    expect(tiebreakOrderText([], "swiss")).toBe("Punkte");
  });

  it("erklärt die Tabelle einer Gruppenphase - mit und ohne Einstellung", () => {
    expect(tableRuleLines({ format: "groups" }, "league").map((line) => line.text)).toEqual([
      "Reihenfolge: Punkte → Mehr Siege → Differenz",
    ]);
    const lines = tableRuleLines({ format: "round_robin", table_tiebreakers: ["head_to_head", "score_diff"] }, "league");
    expect(lines.map((line) => line.key)).toEqual(["order", "head_to_head"]);
    expect(lines[1].text).toMatch(/nur die Spiele der Punktgleichen untereinander/);
  });

  it("erklärt die Schweizer Tabelle samt Abschlussregel", () => {
    const before = tableRuleLines({ format: "swiss" }, "swiss");
    expect(before.map((line) => line.key)).toEqual(["order", "buchholz"]);
    expect(before[0].text).toBe("Reihenfolge: Punkte → Buchholz → Mehr Siege");

    const lines = tableRuleLines({ format: "swiss", swiss_settings: { end_rule: "rounds", rounds: 4, top_n: 4,
      tiebreakers: ["median_buchholz", "buchholz", "head_to_head"] } }, "swiss_median");
    expect(lines.map((line) => line.key)).toEqual(["rule", "order", "median_buchholz", "buchholz", "head_to_head"]);
    expect(lines[0].text).toBe("Gespielt werden 4 Runden. Die besten 4 kommen weiter.");
    expect(lines[4].text).toMatch(/wenn sich alle Punktgleichen getroffen haben/);
  });

  it("schweigt bei K.-o., Läufen und in der Liga-Staffel", () => {
    expect(tableRuleLines({ format: "single_elim" }, "knockout")).toEqual([]);
    expect(tableRuleLines({ format: "ffa" }, "ffa")).toEqual([]);
    expect(tableRuleLines({ format: "league", league_context: { season_id: "s1" } }, "league")).toEqual([]);
    expect(tableRuleLines({ format: "league", scoring_rules: {} }, "league")).toEqual([]);
    expect(tableRuleLines(null, "league")).toEqual([]);
  });

  it("weiß, welche Formate die Tabellen-Einstellung haben", () => {
    expect(["groups", "round_robin", "league"].every(usesTableTiebreakers)).toBe(true);
    expect(["swiss", "single_elim", "ffa", undefined].some(usesTableTiebreakers)).toBe(false);
  });
});

describe("Stand des Schweizer Systems für die Turnierleitung", () => {
  const base = { end_rule: "rounds", rounds_played: 2, rounds_total: 5, round_open: true, complete: false, auto_next_round: true, advanced: 0, eliminated: 0, active: 8 };

  it("führt zum Knopf, wenn die Runde gewertet ist und trotz „automatisch“ keine neue da ist", () => {
    // Etwa pausiert oder gesperrt: automatisch gepaart wird nur im laufenden Turnier.
    expect(swissStateText({ ...base, round_open: false })).toBe("Runde 2 von 5 ist gewertet · die nächste Runde startest du mit „Schweizer Runde“");
  });

  it("nennt Runde, Ziel und ob die nächste von selbst kommt", () => {
    expect(swissStateText(base)).toBe("Runde 2 von 5 läuft · die nächste Runde entsteht automatisch");
    expect(swissStateText({ ...base, round_open: false, auto_next_round: false })).toBe("Runde 2 von 5 ist gewertet · die nächste Runde startest du mit „Schweizer Runde“");
    expect(swissStateText({ ...base, rounds_played: 0, round_open: false })).toBe("Noch keine Runde · die erste startest du mit „Schweizer Runde“");
  });

  it("sagt, wenn Schluss ist", () => {
    expect(swissStateText({ ...base, rounds_played: 5, round_open: false, complete: true })).toBe("Schweizer System abgeschlossen: alle 5 Runden gespielt");
    expect(swissStateText({ ...base, end_rule: "wins_losses", rounds_total: null, rounds_played: 5, round_open: false, complete: true, advanced: 4, eliminated: 4, active: 0 }))
      .toBe("Schweizer System abgeschlossen: 4 weiter, 4 raus");
  });

  it("zählt bei Siegen und Niederlagen, wer weiter, raus und offen ist", () => {
    expect(swissStateText({ ...base, end_rule: "wins_losses", rounds_total: null, rounds_played: 3, round_open: false, advanced: 2, eliminated: 1, active: 5 }))
      .toBe("Runde 3 ist gewertet · 2 weiter, 1 raus, 5 offen · die nächste Runde startest du mit „Schweizer Runde“");
    expect(swissStateText({ ...base, end_rule: "wins_losses", rounds_total: null, rounds_played: 3, advanced: 2, eliminated: 1, active: 5 }))
      .toBe("Runde 3 läuft · 2 weiter, 1 raus, 5 offen · die nächste Runde entsteht automatisch");
    expect(swissStateText({ ...base, end_rule: "manual", rounds_total: null, auto_next_round: false }))
      .toBe("Runde 2 läuft");
    expect(swissStateText(null)).toBe("");
  });
});

describe("Zeile und Spalten", () => {
  it("markiert, wer weiter oder raus ist", () => {
    expect(swissStatusNote({ swiss_status: "advanced" })).toMatchObject({ key: "swiss", tone: "advance", text: "Weiter" });
    expect(swissStatusNote({ swiss_status: "eliminated" })).toMatchObject({ key: "swiss", tone: "exit", text: "Ausgeschieden" });
    expect(swissStatusNote({})).toBeNull();
  });

  it("zeigt Median-Buchholz als eigene Spalte, wenn die Zeilen ihn tragen", () => {
    expect(tableKind([{ buchholz: 3, points: 2 }])).toBe("swiss");
    expect(tableKind([{ buchholz: 3, median_buchholz: 1, points: 2 }])).toBe("swiss_median");
    const keys = STANDING_COLUMNS.swiss_median.map((column) => column.key);
    expect(keys).toEqual(["played", "won", "drawn", "lost", "median_buchholz", "buchholz", "form", "points"]);
    // Am Handy bleibt nur ein Buchholz-Wert stehen - der, der zuerst zählt.
    expect(STANDING_COLUMNS.swiss_median.find((column) => column.key === "buchholz").wide).toBe(true);
  });
});
