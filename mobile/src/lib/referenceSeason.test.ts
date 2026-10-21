import {
  driverCards,
  gainedWords,
  leagueTableRows,
  matchdayRows,
  mobileRows,
  raceCell,
  raceSummary,
  racingTableRows,
  roundRows,
  seasonFigures,
  seasonTabs,
  seasonTitle,
  seasonWebPath,
  type SeasonPage,
} from "./referenceSeason";

// Saison einer Serie in der App (#1945, nur lesen) - dieselben Regeln wie die Serienseite im Web
// (frontend/src/lib/racingLeague.js, teamLeague.js, referenceCalendar.js, referenceSeriesTable.js). Alles kommt
// gespeichert vom Server; fremde Namen stehen nur in Tabellen, außerhalb nur öffentliche Vereinsfahrer. Erfundene Namen.

const res = (round_id: string, place: number | null, points: number, marks: string[] = []) => ({ round_id, place, points, marks, counted: true, dropped: false });

const ROUNDS = [
  { id: "r9", position: 9, code: "R9", venue: "Barcelona", club_day: "2026-04-30", time: "20:00", state: "scored", kind: "regular", counts: true, country_code: "es" },
  { id: "r10", position: 10, code: "R10", venue: "Spielberg", club_day: "2026-05-07", time: "20:00", state: "scored", kind: "regular", counts: true },
  { id: "r11", position: 11, code: "R11", venue: "Budapest", club_day: "2026-05-14", time: "20:00", state: "cancelled", kind: "regular", counts: true },
  { id: "r12", position: 12, code: "", title: "Zandvoort", club_day: "2026-05-21", time: "20:00", state: "today", kind: "regular", counts: true },
  { id: "r13", position: 13, code: "R13", venue: "Monza", club_day: null, time: null, state: "planned", kind: "regular", counts: true },
];

const ROWS = [
  { key: "ext1", rank: 1, points: 268, name: "Fremd Eins", club_member: false, results: [res("r9", 1, 25), res("r10", 2, 18)] },
  { key: "mira", rank: 4, points: 214, name: "Mira Stahl", club_member: true, results: [res("r9", 2, 18, ["pole"]), res("r10", 1, 25, ["fastest_lap"])] },
  { key: "kai", rank: 6, points: 176, name: "Kai Funke", club_member: true, results: [res("r9", 6, 8), res("r10", 3, 15)] },
  { key: "intern", rank: 7, points: 160, name: "Intern Ohne Profil", club_member: true, results: [res("r9", 3, 15)] },
  { key: "hidden", rank: 9, points: 12, name: null, name_hidden: true, club_member: false, results: [] },
];

const RACING: SeasonPage = {
  lineage: { title: "Probe Racing League", slug: "prl", kind: "racing", game_name: "F1 26", label: "PRL" },
  series: { season: "2026", tier: "Liga 1", title: null, season_slug: "2026" },
  progress: { total: 24, scored: 11 },
  rounds: ROUNDS,
  standings: { rows: ROWS },
  racing: {
    club_drivers: ["mira", "kai"],
    club_teams: ["TLS-Lions"],
    drivers: { mira: { team: "TLS-DarkFriday" }, kai: { team: "TLS-Lions" }, ext1: { team: "Team Nord" } },
    teams: { rows: [{ team: "Team Nord", rank: 1, points: 400 }, { team: "TLS-Lions", rank: 2, points: 390 }] },
  },
};

test("Kopf und Reiter je Art: Rennliga mit Kalender, Tabelle und Fahrern", () => {
  expect(seasonTitle(RACING)).toBe("Probe Racing League 2026 · Liga 1");
  expect(seasonTitle({ ...RACING, series: { ...RACING.series, title: "PRL 35 · Season 2026" } })).toBe("PRL 35 · Season 2026");
  expect(seasonTabs(RACING).map((tab) => tab.label)).toEqual(["Kalender", "Tabelle", "Fahrer"]);
  expect(seasonTabs({ ...RACING, racing: null, lineage: { kind: "team_league" }, team_league: { matchdays: [] } }).map((tab) => tab.label)).toEqual(["Spieltage", "Tabelle"]);
  expect(seasonTabs({ lineage: { kind: "series" } }).map((tab) => tab.label)).toEqual(["Termine", "Tabelle"]);
  expect(seasonWebPath("prl", "2026")).toBe("/references/series/prl/2026");
});

test("Kennzahlen ohne Nullen: Runden, bester Vereinsfahrer und bestes Vereinsteam", () => {
  expect(seasonFigures(RACING)).toEqual([
    { key: "progress", value: "11/24", label: "Runden" },
    { key: "driver", value: "P4", label: "Bester Fahrer" },
    { key: "team", value: "P2", label: "Bestes Team" },
  ]);
  // Ohne Stand und ohne Vereinsfahrer: nur, was da ist.
  expect(seasonFigures({ ...RACING, progress: { total: 0, scored: 0 }, standings: null, racing: { club_teams: [] } })).toEqual([]);
  const league: SeasonPage = {
    lineage: { kind: "team_league" },
    team_league: {
      matchdays: [{ round: { id: "a", state: "scored" }, match: { outcome: "win", score_for: 3, score_against: 1, points: 3 } }, { round: { id: "b", state: "planned" }, match: null }],
      table: { rows: [{ key: "Fremd", team: "Fremd", rank: 1, points: 6, played: 2, own: false }, { key: "Lions", team: "Lions", rank: 2, points: 3, played: 1, own: true }] },
    },
  };
  expect(seasonFigures(league)).toEqual([
    { key: "progress", value: "1/2", label: "Spieltage" },
    { key: "rank", value: "2.", label: "von 2 Teams" },
    { key: "points", value: "3", label: "Punkte" },
  ]);
});

test("Kalender: Kürzel, Ort, Land, Stand, Tag - heute als „Heute“; ohne Land kein Platzhalter", () => {
  const rows = roundRows(RACING);
  expect(rows.map((row) => [row.code, row.place, row.country, row.state, row.when])).toEqual([
    ["R9", "Barcelona", "ES", "Gewertet", "Do., 30.04.2026 · 20:00"],
    ["R10", "Spielberg", "", "Gewertet", "Do., 07.05.2026 · 20:00"],
    ["R11", "Budapest", "", "Abgesagt", "Do., 14.05.2026 · 20:00"],
    ["Termin 12", "Zandvoort", "", "Heute", "Heute · 20:00"],
    ["R13", "Monza", "", "Geplant", "Termin offen"],
  ]);
  expect(rows.map((row) => row.tone)).toEqual(["done", "done", "cancelled", "today", "planned"]);
  // Gewertet: der beste öffentliche Vereinsfahrer - ein fremder Sieger bleibt ohne Namen.
  expect(rows[0].best).toBe("Mira Stahl · P2");
  expect(rows[0].winner).toBe("");
  expect(rows[1].winner).toBe("Mira Stahl");
  // Gewinnt ein Vereinsfahrer, steht er als Sieger da - wie im Web kein zweiter „bester Vereinsfahrer“.
  expect(rows[1].best).toBe("");
  expect(rows[2].best).toBe("");
});

test("Rennzelle und Rennen auf einen Blick: nur öffentliche Vereinsfahrer außerhalb der Tabelle", () => {
  expect(raceCell(res("r1", 2, 0, ["dnf"]))).toMatchObject({ text: "DNF", status: "dnf", medal: null });
  expect(raceCell(res("r1", 1, 25, ["fastest_lap"]))).toMatchObject({ text: "1", medal: "gold", fastest: true });
  // Rennergebnis (#1927), wenn eingetragen: Startplatz, gutgemachte Plätze (nur im Ziel), Zeit, Abstand, Startnummer,
  // schnellste Runde mit Zeit und Fahrer des Tages. Zeiten mit Komma wie beim Veranstalter (#1981).
  expect(raceCell({ ...res("r1", 2, 18, ["fastest_lap"]), grid: 6, time: "1:32:10.456", gap: "+3.2", start_number: "44", fastest_lap_time: "1:31.456", driver_of_the_day: true }))
    .toMatchObject({ grid: 6, gained: 4, time: "1:32:10,456", gap: "+3,2", startNumber: "44", fastestTime: "1:31,456", dotd: true });
  // Ein Platzhalter beim Sieger heißt „keine Zeit“.
  expect(raceCell({ ...res("r1", 1, 25), gap: "+--:--,---" })).toMatchObject({ gap: "" });
  expect(raceCell({ ...res("r1", 3, 0, ["dnf"]), grid: 1 })).toMatchObject({ grid: 1, gained: null });
  expect(raceCell(res("r1", 4, 12))).toMatchObject({ grid: null, gained: null, dotd: false, time: "" });
  expect(gainedWords(3)).toBe("3 Plätze gutgemacht");
  expect(gainedWords(-1)).toBe("1 Platz verloren");
  expect(gainedWords(0)).toBe("Platz gehalten");
  const summary = raceSummary(ROWS, "r9", ["mira", "kai"]);
  expect(summary.winner).toBeNull();
  expect(summary.bestClub?.row.key).toBe("mira");
});

test("Tabelle am Handy: die ersten zehn und jedes Vereinsmitglied dahinter - aufgeklappt alle", () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({ key: `k${index}`, rank: index + 1, club_member: index === 12 }));
  expect(mobileRows(rows).map((row) => row.key)).toEqual([...Array.from({ length: 10 }, (_, index) => `k${index}`), "k12"]);
  expect(mobileRows(rows, { expanded: true })).toHaveLength(14);
});

test("Fahrer- und Teamwertung als Zeilen: Name (ausgeblendet als Hinweis), Team, Punkte und Verein", () => {
  expect(racingTableRows(RACING, "drivers").map((row) => [row.pos, row.name, row.team, row.points, row.club])).toEqual([
    ["1", "Fremd Eins", "Team Nord", "268", false],
    ["4", "Mira Stahl", "TLS-DarkFriday", "214", true],
    ["6", "Kai Funke", "TLS-Lions", "176", true],
    ["7", "Intern Ohne Profil", "", "160", true],
    ["9", "Name ausgeblendet", "", "12", false],
  ]);
  expect(racingTableRows(RACING, "teams").map((row) => [row.pos, row.name, row.points, row.club])).toEqual([["1", "Team Nord", "400", false], ["2", "TLS-Lions", "390", true]]);
});

test("Fahrer (Garage): nur öffentliche Vereinsfahrer, mit Platz, Team, Punkten und ihrer Saison ohne Nullen", () => {
  expect(driverCards(RACING)).toEqual([
    { key: "mira", name: "Mira Stahl", pos: "P4", meta: "TLS-DarkFriday · 214 Punkte", stats: "2 Rennen · 1 Sieg · 2 Podien · 1 Pole · 1 schnellste Runde" },
    { key: "kai", name: "Kai Funke", pos: "P6", meta: "TLS-Lions · 176 Punkte", stats: "2 Rennen · 1 Podium" },
  ]);
  // Mit Rennergebnis (#1927): Fahrer des Tages und gutgemachte Plätze wie im Fahrer-Detail des Webs.
  const detailed: SeasonPage = { ...RACING, standings: { rows: [{ key: "mira", rank: 4, points: 43, name: "Mira Stahl", club_member: true, results: [{ ...res("r9", 2, 18), grid: 7, driver_of_the_day: true }, { ...res("r10", 1, 25), grid: 2 }] }] } };
  expect(driverCards(detailed)[0].stats).toBe("2 Rennen · 1 Sieg · 2 Podien · 1× Fahrer des Tages · 6 Plätze gutgemacht");
});

test("Kalender mit Land: Code und Name für die Flagge, auch ohne Ort", () => {
  const rows = roundRows({ rounds: [{ id: "x", code: "R1", state: "planned", country_code: "az" }, { id: "y", code: "R2", state: "planned", country_code: "zz" }] });
  expect(rows.map((row) => [row.country, row.countryName, row.place])).toEqual([["AZ", "Aserbaidschan", "Aserbaidschan"], ["", "", ""]]);
});

test("Team-Liga: Spieltage mit Gegner, Ergebnis aus eigener Sicht und Tabelle mit eigenem Team", () => {
  const page: SeasonPage = {
    lineage: { kind: "team_league" },
    team_league: {
      matchdays: [
        { round: { id: "a", code: "ST1", club_day: "2026-10-01", time: "20:00", state: "scored" }, match: { opponent: "Fremd Adler", home: true, outcome: "win", score_for: 3, score_against: 1, points: 3, maps: [{ name: "Hacienda", score_for: 6, score_against: 2, outcome: "win" }] } },
        { round: { id: "b", code: "ST2", club_day: "2026-10-08", time: "20:00", state: "planned", opponent: "Fremd Bären" }, match: null },
      ],
      table: { rows: [{ key: "Fremd", team: "Fremd Adler", rank: 1, points: 6, played: 2, won: 2, drawn: 0, lost: 0, own: false }, { key: "Lions", team: "Lions Probe", rank: 2, points: 3.5, played: 1, own: true }] },
    },
  };
  const days = matchdayRows(page);
  expect(days.map((day) => [day.code, day.opponent, day.side, day.score, day.outcome, day.state])).toEqual([
    ["ST1", "gegen Fremd Adler", "Heim", "3:1", "Sieg", ""],
    ["ST2", "gegen Fremd Bären", "", "", "", "Geplant"],
  ]);
  expect(days[0].maps).toEqual(["Hacienda 6:2"]);
  // Mehrere eigene Teams (#1926): vor dem Gegner steht, welches eigene Team gespielt hat.
  const two: SeasonPage = { ...page, team_league: { ...page.team_league, own_teams: ["Lions A", "Lions B"], matchdays: [{ round: { id: "a", code: "ST1", state: "scored" }, match: { team: "Lions B", opponent: "Fremd Adler", home: false, outcome: "loss", score_for: 1, score_against: 3 } }] } };
  expect(matchdayRows(two)[0].opponent).toBe("Lions B gegen Fremd Adler");
  expect(days[0].opponent).toBe("gegen Fremd Adler");
  expect(leagueTableRows(page).map((row) => [row.pos, row.name, row.played, row.points, row.own])).toEqual([["1", "Fremd Adler", "2", "6", false], ["2", "Lions Probe", "1", "3,5", true]]);
  // Alter Server ohne Team-Liga-Teil: leer, kein Absturz.
  expect(matchdayRows({ lineage: { kind: "team_league" } })).toEqual([]);
  expect(leagueTableRows({})).toEqual([]);
});
