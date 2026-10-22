import { formToRules, rulesToForm, seriesPayload, seriesToForm } from "./referenceSeries";
import { roundWhen } from "./referenceCalendar";
import { doubleUpLabel } from "./referenceSeriesTable";
import { doubleUpDayText } from "./seriesDays";

// #2015: Double-Up-Punkte als Regel der Saison, geplante Termine an der Saison und „Termin offen“ mit Uhrzeit. Gerechnet
// wird im Server - hier nur Formular und Beschriftungen. Nur erfundene Daten.

test("Double-Up-Punkte gehen vollständig hin und zurück, ohne Angabe die Vorgabe 2k−1", () => {
  expect(rulesToForm({}).double_up_points).toBe("best_player_place");
  expect(rulesToForm({ double_up_points: "team_place" }).double_up_points).toBe("team_place");
  expect(formToRules(rulesToForm({ double_up_points: "team_place" })).double_up_points).toBe("team_place");
  expect(formToRules(rulesToForm({})).double_up_points).toBe("best_player_place");
});

test("geplante Termine: leer heißt keine Zahl, sonst die Zahl", () => {
  expect(seriesToForm({ planned_rounds: 9 }).planned_rounds).toBe("9");
  expect(seriesToForm({}).planned_rounds).toBe("");
  expect(seriesPayload({ ...seriesToForm({}), planned_rounds: "9" }).planned_rounds).toBe(9);
  expect(seriesPayload({ ...seriesToForm({}), planned_rounds: "" }).planned_rounds).toBeNull();
});

test("Termin offen zeigt die gemerkte Uhrzeit", () => {
  expect(roundWhen({ club_day: null, time: "19:00" })).toBe("Termin offen · 19:00");
  expect(roundWhen({ club_day: null, time: null })).toBe("Termin offen");
});

test("Double Up in Worten: Regel der Saison und Tagesansicht", () => {
  const days = { day_rounds: { count: 5 } };
  expect(doubleUpLabel(days)).toBe("Team-Platz k zählt wie Einzelplatz 2k−1 (Team 2 → Platz 3) – für beide Spieler");
  expect(doubleUpLabel({ ...days, double_up_points: "team_place" })).toBe("Team-Platz k zählt wie Platz k – für beide Spieler");
  // Ohne Turniertage gibt es kein Double Up - keine Zeile.
  expect(doubleUpLabel({ day_rounds: { count: 0 } })).toBe("");
  expect(doubleUpDayText({})).toBe("Platz = Team-Platz, Punkte wie Einzelplatz 2k−1");
  expect(doubleUpDayText({ double_up_points: "team_place" })).toBe("Platz = Team-Platz, Punkte nach Team-Platz");
});
