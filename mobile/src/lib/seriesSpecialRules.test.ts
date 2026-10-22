import { adjustmentTeamText, driverAdjustmentMarks } from "./seriesSpecialRules";

// Fahrer-Anpassung in der Teamwertung (#2000) - dieselben Texte wie im Web (frontend/src/lib/seriesSpecialRules.js).

const ROUNDS = [{ id: "r4", code: "R4", session: null }];

test("Fahrer-Detail: für welches Team bzw. warum für keines - leer ohne Haken", () => {
  expect(adjustmentTeamText({ counts_for_team: true, credited_team: "Team Adler" })).toBe("zählt auch fürs Team · Team Adler");
  expect(adjustmentTeamText({ counts_for_team: true, team_note: "substitute" })).toBe("zählt für kein Team – im Termin als Ersatz gefahren");
  expect(adjustmentTeamText({ counts_for_team: true, team_note: "no_team" })).toBe("zählt für kein Team – ohne Team gefahren");
  expect(adjustmentTeamText({ counts_for_team: true, team_note: "no_ride" })).toBe("zählt für kein Team – bis dahin keine Fahrt mit Team");
  expect(adjustmentTeamText({ counts_for_team: true, team_note: "guest" })).toBe("zählt für kein Team – Gäste zählen nicht fürs Team");
  expect(adjustmentTeamText({ counts_for_team: true })).toBe("zählt auch fürs Team");
  expect(adjustmentTeamText({ counts_for_team: false, credited_team: "Team Adler" })).toBe("");
  // Älterer Server: keine Felder.
  expect(adjustmentTeamText({ points: -5, reason: "Video fehlt" })).toBe("");
  expect(adjustmentTeamText(null)).toBe("");
});

test("Teamtabelle: „−5 (Fahrer)“ mit Grund - ausgeblendete und unbekannte Namen bleiben ausgeblendet", () => {
  const rows = [{ key: "p1", name: "Anna Probe" }, { key: "p2", name: "Geheim", name_hidden: true }];
  const team = { driver_adjustments: [
    { points: -5, reason: "Video fehlt", day: "2026-03-04", round_id: "r4", driver: "p1" },
    { points: 2, reason: "Korrektur", day: "2026-03-05", round_id: null, driver: "p2" },
    { points: -1, reason: "Strafe", day: "2026-03-06", round_id: null, driver: "weg" },
  ] };
  expect(driverAdjustmentMarks(team, rows, ROUNDS)).toEqual([
    { key: "p1-0", negative: true, text: "−5 (Anna Probe)", title: "Anpassung −5 · Video fehlt · R4 · 04.03.2026 – Anna Probe, zählt auch fürs Team" },
    { key: "p2-1", negative: false, text: "+2 (Name ausgeblendet)", title: "Anpassung +2 · Korrektur · 05.03.2026 – Name ausgeblendet, zählt auch fürs Team" },
    { key: "weg-2", negative: true, text: "−1 (Name ausgeblendet)", title: "Anpassung −1 · Strafe · 06.03.2026 – Name ausgeblendet, zählt auch fürs Team" },
  ]);
  // Älterer Server: keine Liste an der Teamzeile.
  expect(driverAdjustmentMarks({}, rows, ROUNDS)).toEqual([]);
  expect(driverAdjustmentMarks(null)).toEqual([]);
});
