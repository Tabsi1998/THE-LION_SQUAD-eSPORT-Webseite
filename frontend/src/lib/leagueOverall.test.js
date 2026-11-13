import { cellText, decisionProblem, periodsPayload, periodsProblem, periodsToForm, rulesLine, seasonColumns, settingsPayload, settingsProblem,
  settingsToForm, stateLine, takenBy, tiebreakLine } from "./leagueOverall";

// Gesamtwertung über Seasons (F.5, #2215): Wörter, Zellen und Formular - jede Regel mit Gegenprobe.

test("Zelle: Punkte, Platz, Staffelsieg, Streichergebnis und nicht dabei", () => {
  expect(cellText({ played: true, points: 6, place: 1, of: 4, champion: true, counted: true }, "Season 1")).toBe("Season 1: 6 Punkte · Platz 1 von 4 · Staffelsieg");
  expect(cellText({ played: true, points: 1, place: 4, of: 4, counted: false }, "Season 2")).toBe("Season 2: 1 Punkt · Platz 4 von 4 · Streichergebnis");
  expect(cellText({ played: true, points: 0, exit: "withdrawn", counted: true }, "S3")).toBe("S3: 0 Punkte · ausgeschieden");
  expect(cellText({ played: false }, "S4")).toBe("S4: nicht dabei");
  expect(cellText({ played: true, points: 3, place: 2, of: 4, counted: true, co_team_name: "Nordlicht" }, "S1")).toContain("für Nordlicht");
});

test("Regelzeile nach Teamzahl, eigener Tabelle und beste X", () => {
  expect(rulesLine({ points_mode: "teams", champion_bonus: 2, counting: "all" })).toContain("Platz 1 der Staffel +2. Es zählen alle Seasons.");
  expect(rulesLine({ points_mode: "table", points_table: [10, 6, 3], champion_bonus: 0, counting: "best", best_count: 3 }))
    .toBe("Punkte je Platz: 10, 6, 3. Es zählen die besten 3 Seasons.");
  expect(tiebreakLine({ tiebreakers: [{ key: "wins", label: "Mehr Staffelsiege" }, "latest"] }))
    .toBe("Bei Gleichstand: Mehr Staffelsiege, dann Mehr Punkte in der jüngsten Season, zuletzt Entscheid der Leitung.");
  expect(tiebreakLine({ tiebreakers: [] })).toBe("Bei Gleichstand entscheidet die Leitung.");
});

test("Formular der Einstellungen: Vorgaben, Prüfung und was an den Server geht", () => {
  const form = settingsToForm({});
  expect(form).toEqual({ points_mode: "teams", points_table: [], champion_bonus: "2", counting: "all", best_count: "", tiebreakers: ["wins", "best_place", "latest"] });
  expect(settingsProblem(form)).toBe("");
  expect(settingsProblem({ ...form, points_mode: "table" })).toMatch(/mindestens Platz 1/);
  expect(settingsProblem({ ...form, points_mode: "table", points_table: ["10", "x"] })).toMatch(/Platz 2/);
  expect(settingsProblem({ ...form, counting: "best", best_count: "0" })).toMatch(/1 bis 50/);
  expect(settingsProblem({ ...form, champion_bonus: "100" })).toMatch(/0 bis 99/);
  expect(settingsPayload({ ...form, points_mode: "table", points_table: ["10", "5"], counting: "best", best_count: "2" }))
    .toEqual({ points_mode: "table", points_table: [10, 5], champion_bonus: 2, counting: "best", best_count: 2, tiebreakers: ["wins", "best_place", "latest"] });
  expect(settingsPayload(form).best_count).toBeNull();
});

test("Zeiträume: eine Season gehört zu höchstens einem, Name Pflicht", () => {
  const rows = periodsToForm([{ id: "p1", name: "2027", season_ids: ["s1"], closed_levels: [1] }]);
  expect(rows[0]).toMatchObject({ key: "p1", id: "p1", closed_levels: [1] });
  expect(periodsProblem(rows)).toBe("");
  const twice = [...rows, { key: "neu", id: null, name: "2028", season_ids: ["s1"], closed_levels: [] }];
  expect(periodsProblem(twice, { s1: "Season 1" })).toMatch(/„Season 1“ steht schon im Zeitraum „2027“/);
  expect(takenBy(twice, "s1", "neu")).toBe("2027");
  expect(takenBy(twice, "s2", "neu")).toBe("");
  expect(periodsProblem([{ key: "x", name: " ", season_ids: [] }])).toMatch(/Namen/);
  expect(periodsPayload(twice)).toEqual([{ id: "p1", name: "2027", season_ids: ["s1"] }, { name: "2028", season_ids: ["s1"] }]);
});

test("Spalten, Stand und Entscheid", () => {
  expect(seasonColumns([{ id: "s1", name: "Season 1", url: "/liga/x/season-1" }], ["s1", "s9"])).toEqual([
    { id: "s1", name: "Season 1", url: "/liga/x/season-1" }, { id: "s9", name: "Season", url: null }]);
  expect(stateLine({ closed: false })).toMatch(/Laufende Wertung/);
  expect(stateLine({ closed: true, final: { version: 2, closed_at: "x" } }, () => "12.01.2027")).toBe("Endstand seit 12.01.2027 · Fassung 2");
  expect(decisionProblem({ method: "", reason: "Los gezogen" })).toMatch(/wie entschieden/);
  expect(decisionProblem({ method: "lot", reason: "Los" })).toMatch(/mindestens 5/);
  expect(decisionProblem({ method: "lot", reason: "Los gezogen" })).toBe("");
});
