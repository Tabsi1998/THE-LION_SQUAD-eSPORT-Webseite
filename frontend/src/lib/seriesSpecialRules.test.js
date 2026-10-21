import { describe, expect, test } from "vitest";
import {
  adjustmentErrors, adjustmentLine, adjustmentPayload, adjustmentSum, adjustmentText, adjustmentTitle, adjustmentToForm, cancelledText, emptyAdjustment,
  noScoreText, parseTeamTotals, ruleChangeLines, successorLink, teamCountHint, teamDeviationText, teamModeLabel, teamSinceLabel, teamSourceLabel,
  teamTotalsObject,
} from "@/lib/seriesSpecialRules";

test("Ergebnisblatt: leeres Team zählt für kein Team - mit Stammteam zum Eintragen; „Ersatzfahrer“ ebenso (#1960)", () => {
  const scoring = { enabled: true, no_team_names: ["Ersatzfahrer"] };
  const people = [{ id: "p1", name: "Chris Probe", default_team: "Turbo Probe" }, { id: "p2", name: "Ohne Stamm" }];
  const none = (default_team) => ({ text: "zählt für kein Team", default_team });
  expect(teamCountHint({ participant_id: "p1", team: "" }, people, scoring)).toEqual(none("Turbo Probe"));
  expect(teamCountHint({ participant_id: "", name: "chris  probe", team: "" }, people, scoring)).toEqual(none("Turbo Probe"));
  // Erst die Vorschau hat den Namen zugeordnet (etwa über einen Alias): ihre Kennung zählt.
  expect(teamCountHint({ participant_id: "", name: "Chrissi", team: "" }, people, scoring, "p1")).toEqual(none("Turbo Probe"));
  expect(teamCountHint({ participant_id: "p2", team: "" }, people, scoring)).toEqual(none(""));
  expect(teamCountHint({ participant_id: "p1", team: " ersatzfahrer " }, people, scoring)).toEqual({ text: "zählt für kein Team (Ersatz)", default_team: "" });
  expect(teamCountHint({ participant_id: "p1", team: "Löwen Probe" }, people, scoring)).toBeNull();
  expect(teamCountHint({ participant_id: "", name: " ", team: "" }, people, scoring)).toBeNull();
  expect(teamCountHint({ participant_id: "p1", team: "" }, people, { enabled: false })).toBeNull();
});

// Sonderregeln einer Rennliga (#1960) - nur erfundene Namen.
const ROUNDS = [
  { id: "r4", code: "R4", position: 4 },
  { id: "r12s", code: "R12", position: 12, session: "Sprint" },
];

describe("Anpassungen", () => {
  test("öffentlich als „−5“ mit Grund, Termin und Tag", () => {
    expect(adjustmentText(-5)).toBe("−5");
    expect(adjustmentText(2.5)).toBe("+2,5");
    const item = { points: -5, reason: "Nichtteilnahme nach Anmeldung", round_id: "r4", day: "2026-03-12" };
    expect(adjustmentLine(item, ROUNDS)).toBe("−5 · Nichtteilnahme nach Anmeldung · R4 · 12.03.2026");
    expect(adjustmentTitle({ adjustments: [item, { points: 3, reason: "Korrektur", day: "2026-03-13" }] }, ROUNDS))
      .toBe("Anpassung −5 · Nichtteilnahme nach Anmeldung · R4 · 12.03.2026; Anpassung +3 · Korrektur · 13.03.2026");
    expect(adjustmentSum({ adjustment_points: -5 })).toBe(-5);
    expect(adjustmentSum({ adjustments: [{ points: -5 }, { points: 2 }] })).toBe(-3);
  });

  test("Formular: Punkte mit echtem Minus, Grund und Tag sind Pflicht, Team oder Teilnehmer", () => {
    const form = emptyAdjustment({ participant_id: "p1", points: "−5", reason: "  Video   fehlt ", day: "2026-03-04" });
    expect(adjustmentErrors(form)).toEqual({});
    expect(adjustmentPayload(form)).toEqual({ kind: "participant", participant_id: "p1", team: null, points: -5, reason: "Video fehlt", day: "2026-03-04", round_id: null });
    const team = { ...form, kind: "team", team: " Probe Löwen ", participant_id: "", points: "2,5", round_id: "r4" };
    expect(adjustmentPayload(team)).toMatchObject({ kind: "team", participant_id: null, team: "Probe Löwen", points: 2.5, round_id: "r4" });
    expect(Object.keys(adjustmentErrors({ ...form, points: "0", reason: " ", day: "", participant_id: "" })).sort()).toEqual(["day", "points", "reason", "who"]);
    expect(adjustmentToForm({ id: "a1", kind: "team", team: "Fremd Rot", points: -4, reason: "Regel", day: "2026-03-01", round_id: null }))
      .toMatchObject({ id: "a1", kind: "team", team: "Fremd Rot", points: "-4", reason: "Regel", round_id: "" });
  });
});

describe("Teamwertung", () => {
  test("Modus, Quelle und „im Team seit“", () => {
    expect(teamModeLabel({ mode: "current_lineup" })).toBe("Aktuelle Besetzung: alle Saisonpunkte der Fahrer, die jetzt im Team sind");
    expect(teamModeLabel({})).toBe("Je Rennen für das gefahrene Team");
    expect(teamSourceLabel({ source: "official", round_id: "r12s" }, ROUNDS)).toBe("laut Veranstalter (nach R12 · Sprint)");
    expect(teamSourceLabel({ source: "computed" }, ROUNDS)).toBe("berechnet");
    expect(teamSinceLabel({ team_since: "r12s" }, ROUNDS)).toBe("im Team seit R12 · Sprint");
    expect(teamSinceLabel({ team_since: null }, ROUNDS)).toBe("");
    expect(teamDeviationText({ team: "Probe Löwen", official_points: 30, computed_points: 26, deviation: 4 })).toBe("Probe Löwen: laut Veranstalter 30, berechnet 26 (+4)");
    expect(teamDeviationText({ team: "Probe Löwen", official_points: null, deviation: null })).toBe("");
  });

  test("Teamwertung laut Veranstalter einfügen: Platz vorn fällt weg, die letzte Zahl sind die Punkte", () => {
    const parsed = parseTeamTotals("Pl\tTeam\tPkt\n1.\tFremd Rot\t40\n2 | Probe Löwen | 30,5\nFremd Blau;3\nOhne Punkte");
    expect(parsed.rows).toEqual([{ team: "Fremd Rot", points: 40 }, { team: "Probe Löwen", points: 30.5 }, { team: "Fremd Blau", points: 3 }]);
    expect(parsed.errors).toEqual([{ line: 5, text: "Ohne Punkte", message: "Punkte am Ende der Zeile fehlen." }]);
    expect(teamTotalsObject(parsed.rows)).toEqual({ "Fremd Rot": 40, "Probe Löwen": 30.5, "Fremd Blau": 3 });
  });
});

describe("Saison, Termin und Regeländerungen", () => {
  test("abgebrochene Saison mit Nachfolger", () => {
    expect(cancelledText({ status: "cancelled", cancelled_on: "2026-11-20", cancel_reason: "Neustart mit anderem Auto" }))
      .toBe("Saison abgebrochen am 20.11.2026 – Neustart mit anderem Auto");
    expect(cancelledText({ status: "completed" })).toBe("");
    expect(successorLink({ lineage_slug: "probe-racing", season_slug: "2026-f1-neustart", season: "2026", tier: "F1 Neustart" }))
      .toEqual({ href: "/references/series/probe-racing/2026-f1-neustart", label: "2026 · F1 Neustart" });
    expect(successorLink(null)).toBeNull();
  });

  test("Termin ohne Wertung mit Grund - unterschieden von abgesagt", () => {
    expect(noScoreText({ no_score_reason: "too_few", no_score_note: "Nur zwei am Start" })).toBe("Ohne Wertung · Zu wenig Fahrer – Nur zwei am Start");
    expect(noScoreText({ no_score_reason: "outage" })).toBe("Ohne Wertung · Serverausfall bzw. Nachholung");
    expect(noScoreText({ counts: false })).toBe("");
  });

  test("Regeländerung ab Runde X mit Tag und Hinweis, Regel-Version mit Hinweis", () => {
    const lines = ruleChangeLines([
      { kind: "format", from_round: 5, to_round: 8, day: "2026-11-12", note: "Ab R5 kein Qualifying", sessions: ["Sprint", "Hauptrennen"] },
      { kind: "format", from_round: 9, to_round: null, day: null, note: null, sessions: ["Rennen"] },
      { kind: "rules", version: 2, day: "2026-11-20", note: "Ein Streichergebnis" },
      { kind: "rules", version: 3, day: "2026-11-21", note: "" },
    ]);
    expect(lines.map((line) => [line.head, line.text])).toEqual([
      ["R5–R8 · 12.11.2026", "Ab R5 kein Qualifying"],
      ["Ab R9", "Ablauf: Rennen"],
      ["Regeländerung · 20.11.2026", "Ein Streichergebnis"],
    ]);
  });
});
