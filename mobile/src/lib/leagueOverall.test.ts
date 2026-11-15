import {
  cellText, isOverallWinner, isStruck, levelState, overallApiPath, overallParams, overallWinner, pointsWord, rulesLine, seasonColumns, standingState,
} from "./leagueOverall";

// Gesamtwertung über Seasons (F.5, App: #2173): dieselben Wörter wie im Web (frontend/src/lib/leagueOverall.test.js). Wiener Zeit.

test("Profil und Team: Stand der Wertung, Gesamtsieger nur abgeschlossen, mit ganzer Sicht und auf Platz 1", () => {
  expect(standingState({ closed: false })).toBe("laufend");
  expect(standingState({ closed: true, complete: true })).toBe("Endstand");
  expect(standingState({ closed: true, complete: false })).toBe("Endstand ohne nicht öffentliche Seasons");
  expect(isOverallWinner({ closed: true, complete: true, place: 1 })).toBe(true);
  expect(isOverallWinner({ closed: true, complete: false, place: 1 })).toBe(false);
  expect(isOverallWinner({ closed: false, complete: false, place: 1 })).toBe(false);
  expect(isOverallWinner({ closed: true, complete: true, place: 2 })).toBe(false);
  // Ein älterer Server ohne `complete`: kein Gesamtsieger.
  expect(isOverallWinner({ closed: true, place: 1 })).toBe(false);
});

test("Ligaseite: Stand je Liga N und der Gesamtsieger nur, wenn genau einer vorn steht und alles sichtbar ist", () => {
  expect(levelState({ closed: false })).toBe("Laufende Wertung – rechnet mit jedem neuen Endstand einer Season neu.");
  expect(levelState({ closed: true, complete: true, final: { version: 2, closed_at: "2027-03-01T19:00:00Z" } })).toBe("Endstand seit 01.03.2027 · Fassung 2");
  expect(levelState({ closed: true, complete: false, final: { version: 1, closed_at: "2027-03-01T19:00:00Z" } })).toBe("Endstand ohne nicht öffentliche Seasons · abgeschlossen am 01.03.2027");
  const teams = [{ place: 1, total: 20, name: "Löwen" }, { place: 2, total: 12, name: "Falken" }];
  expect(overallWinner({ level: 1, closed: true, complete: true, teams })?.name).toBe("Löwen");
  expect(overallWinner({ level: 1, closed: true, complete: false, teams })).toBeNull();
  expect(overallWinner({ level: 1, closed: false, complete: false, teams })).toBeNull();
  expect(overallWinner({ level: 1, closed: true, complete: true, teams: [{ place: 1, total: 9 }, { place: 1, total: 9 }] })).toBeNull();
});

test("Zellen je Season: Punkte, Platz, Staffelsieg, Streichergebnis, ausgeschieden", () => {
  expect(pointsWord(1)).toBe("1 Punkt");
  expect(pointsWord(6)).toBe("6 Punkte");
  expect(cellText({ season_id: "s1", played: true, points: 10, place: 1, of: 8, champion: true, counted: true }, "Season 1")).toBe("Season 1: 10 Punkte · Platz 1 von 8 · Staffelsieg");
  expect(cellText({ season_id: "s2", played: true, points: 3, place: 6, of: 8, counted: false }, "Season 2")).toBe("Season 2: 3 Punkte · Platz 6 von 8 · Streichergebnis");
  expect(cellText({ season_id: "s3", played: true, points: 0, exit: "withdrawn", counted: true, co_team_name: "Löwen B" }, "Season 3")).toBe("Season 3: 0 Punkte · ausgeschieden · für Löwen B");
  expect(cellText({ season_id: "s4", played: false }, "Season 4")).toBe("Season 4: nicht dabei");
  expect(isStruck({ season_id: "s2", played: true, counted: false })).toBe(true);
  expect(isStruck({ season_id: "s4", played: false, counted: false })).toBe(false);
  expect(seasonColumns([{ id: "s1", name: "Season 1" }], ["s1", "x"])).toEqual([{ id: "s1", name: "Season 1" }, { id: "x", name: "Season" }]);
});

test("Rechnung in einem Satz", () => {
  expect(rulesLine({ points_mode: "teams", champion_bonus: 2, counting: "best", best_count: 3 }))
    .toBe("Punkte nach Teamzahl: Platz 1 bekommt so viele Punkte, wie die Staffel Teams hat, der Letzte 1, Platz 1 der Staffel +2. Es zählen die besten 3 Seasons.");
  expect(rulesLine({ points_mode: "table", points_table: [10, 8, 6], champion_bonus: 0, counting: "all" })).toBe("Punkte je Platz: 10, 8, 6. Es zählen alle Seasons.");
  expect(rulesLine(null)).toBe("");
});

test("Der Link des Servers öffnet die Gesamtwertung nur mit sauberen Teilen", () => {
  expect(overallParams("/liga/cod/season-2/gesamtwertung")).toEqual({ league: "cod", season: "season-2" });
  expect(overallParams("/liga/cod/season-2/gesamtwertung?x=1")).toEqual({ league: "cod", season: "season-2" });
  expect(overallParams("/liga/cod/season-2")).toBeNull();
  expect(overallParams("/liga/../season-2/gesamtwertung")).toBeNull();
  expect(overallParams("/liga/cod/%2e%2e/gesamtwertung")).toBeNull();
  expect(overallParams(null)).toBeNull();
  expect(overallApiPath("cod", "season-2")).toBe("/leagues/cod/season-2/overall");
});
