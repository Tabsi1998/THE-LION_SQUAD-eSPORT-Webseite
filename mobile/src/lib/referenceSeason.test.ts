import {
  adjustmentLines,
  driverCards,
  gainedWords,
  mobileRows,
  raceCell,
  raceSummary,
  racingRuleLines,
  racingTableRows,
  roundRows,
  seasonFigures,
  seasonTabs,
  seasonTitle,
  seasonWebPath,
  tableKinds,
  teamRuleLabel,
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
  expect(seasonTabs(RACING).map((tab) => tab.label)).toEqual(["Kalender", "Tabelle", "Fahrer", "Statistik"]);
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
  expect(rows[0].results).toEqual([{ key: "r9-best", kind: "best", label: "Bester Vereinsfahrer", text: "Mira Stahl · P2" }]);
  // Gewinnt ein Vereinsfahrer, steht er als Sieger da - wie im Web kein zweiter „bester Vereinsfahrer“.
  expect(rows[1].results).toEqual([{ key: "r10-winner", kind: "winner", label: "Sieg", text: "Mira Stahl" }]);
  expect(rows[2].results).toEqual([]);
  // Ohne Läufe keine Chips; die Ergebnisseite nur mit Rundennummer vom Server (älterer Server: keine).
  expect(rows.every((row) => row.sessions.length === 0 && row.number === null)).toBe(true);
});

// ---------------------------------------------------------------- Runde mit Läufen (#1930)

const WEEKEND_ROUNDS = [
  { id: "q3", position: 5, code: "R3", venue: "Baku", club_day: "2026-10-08", time: "19:30", state: "scored", kind: "regular", counts: false, session: "Qualifying", session_kind: "qualifying", weekend: 3, country_code: "az" },
  { id: "s3", position: 6, code: "R3", club_day: "2026-10-08", time: "19:50", state: "scored", kind: "regular", counts: true, session: "Sprint", session_kind: "sprint", weekend: 3 },
  { id: "r3", position: 7, code: "R3", club_day: "2026-10-08", time: "20:30", state: "scored", kind: "regular", counts: true, session: "Rennen", session_kind: "race", weekend: 3 },
  { id: "q4", position: 8, code: "R4", venue: "Monza", club_day: "2026-10-15", time: "19:30", state: "planned", kind: "regular", counts: false, session: "Qualifying", session_kind: "qualifying", weekend: 4 },
  { id: "r4", position: 9, code: "R4", club_day: "2026-10-16", time: "20:00", state: "planned", kind: "regular", counts: true, session: "Rennen", session_kind: "race", weekend: 4, no_score_reason: "too_few", no_score_note: "Nur zwei am Start" },
];
const WEEKEND_ROWS = [
  { key: "ext1", rank: 1, points: 33, name: "Fremd Eins", club_member: false, results: [res("s3", 1, 8), res("r3", 1, 25)] },
  { key: "mira", rank: 2, points: 25, name: "Mira Stahl", club_member: true, results: [{ ...res("s3", 2, 7), grid: 3 }, { ...res("r3", 2, 18, ["fastest_lap"]), grid: 2 }],
    adjustment_points: -5, adjustments: [{ points: -5, reason: "Nichtteilnahme nach Anmeldung", day: "2026-11-02", round_id: "r3" }] },
  { key: "kai", rank: 3, points: 21, name: "Kai Funke", club_member: true, results: [{ ...res("s3", 3, 6), grid: 1 }, { ...res("r3", 3, 15, ["dnf"]), grid: 6 }] },
];
const WEEKEND: SeasonPage = {
  ...RACING,
  rounds: WEEKEND_ROUNDS,
  standings: { rows: WEEKEND_ROWS },
  series: { ...RACING.series, weekend: { formats: [{ from_round: 1, sessions: [{ label: "Qualifying", counts: false, points: "none" }, { label: "Sprint", counts: true, points: [8, 7, 6, 5], grid: "reverse_qualifying", reverse_top: 8 }, { label: "Rennen", counts: true, points: "series", grid: "qualifying" }] }] } },
  racing: {
    ...RACING.racing,
    drivers: { mira: { team: "TLS-Lions", team_since: "s3" }, kai: { team: "TLS-Lions" } },
    qualifying: [{ round_id: "q3", places: { ext1: 3, mira: 1, kai: 2 }, pole: "mira" }],
  },
};

test("Kalender je Runde (#1930): Läufe als Chips, Stand der Runde, Sieger je Rennen mit Lauf, ohne Wertung je Lauf", () => {
  const rows = roundRows(WEEKEND);
  expect(rows.map((row) => [row.code, row.place, row.state, row.when, row.number])).toEqual([
    ["R3", "Baku", "Gewertet", "Do., 08.10.2026", 3],
    ["R4", "Monza", "Geplant", "Do., 15.10.2026", 4],
  ]);
  expect(rows[0].sessions.map((round) => round.id)).toEqual(["q3", "s3", "r3"]);
  expect(rows[0].results.map((line) => `${line.label}: ${line.text}`)).toEqual(["Bester Vereinsfahrer · Sprint: Mira Stahl · P2", "Bester Vereinsfahrer · Rennen: Mira Stahl · P2"]);
  expect(rows[1].notes).toEqual(["Rennen: Ohne Wertung · Zu wenig Fahrer – Nur zwei am Start"]);
});

test("Wertung je Lauf (#1930): Gesamt · Rennen · Sprint - Punkte nur aus diesen Läufen, Anpassungen nur in Gesamt", () => {
  expect(tableKinds(WEEKEND)).toEqual([{ key: "all", label: "Gesamt" }, { key: "race", label: "Rennen" }, { key: "sprint", label: "Sprint" }]);
  expect(tableKinds(RACING)).toEqual([]);
  expect(racingTableRows(WEEKEND, "drivers", "sprint").map((row) => [row.pos, row.name, row.points])).toEqual([["1", "Fremd Eins", "8"], ["2", "Mira Stahl", "7"], ["3", "Kai Funke", "6"]]);
  const all = racingTableRows(WEEKEND, "drivers");
  expect(all[1].adjust?.adjustment_points).toBe(-5);
  expect(racingTableRows(WEEKEND, "drivers", "race")[1].adjust).toBeNull();
  expect(adjustmentLines(WEEKEND, "drivers")).toEqual([{ key: "mira-0", points: "−5", negative: true, text: "Mira Stahl · Nichtteilnahme nach Anmeldung · R3 · Rennen · 02.11.2026" }]);
  expect(racingRuleLines(WEEKEND)).toEqual([
    { key: "points", label: "Punkte je Lauf", text: "Sprint: 8 · 7 · 6 · 5" },
    { key: "grid", label: "Startaufstellung", text: "Sprint: Start in umgekehrter Quali-Reihenfolge (Top 8)" },
  ]);
});

test("Fahrer-Detail (#1930, #1960): Poles je Runde, Ø Start, Quali-Duell, „im Team seit“ und Anpassungen", () => {
  const [mira, kai] = driverCards(WEEKEND);
  expect(mira.meta).toBe("TLS-Lions · im Team seit R3 · Sprint · 25 Punkte");
  expect(mira.stats).toBe("2 Rennen · 2 Podien · 1 Pole · 1 schnellste Runde · 1 Platz gutgemacht · Ø Start 2,5 · Quali-Duell 1:0 gegen Kai Funke");
  expect(mira.adjustments).toEqual([{ key: "mira-0", points: "−5", negative: true, text: "Nichtteilnahme nach Anmeldung · R3 · Rennen · 02.11.2026", team: "" }]);
  expect(kai.stats).toBe("2 Rennen · 1 Podium · 1 Ausfall · 2 Plätze verloren · Ø Start 3,5 · Quali-Duell 0:1 gegen Mira Stahl");
  expect(kai.meta).toBe("TLS-Lions · 21 Punkte");
});

test("Teamwertung in Worten (#1960)", () => {
  expect(teamRuleLabel({ enabled: true, counting_drivers: 2, guests_count: false })).toBe("Je Rennen zählen die besten 2 Fahrer eines Teams. Gäste zählen nicht fürs Team.");
  expect(teamRuleLabel({ enabled: true, counting_drivers: 1, guests_count: true })).toBe("Je Rennen zählt der beste Fahrer eines Teams. Gäste zählen fürs Team.");
  expect(teamRuleLabel(null)).toBe("");
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
    { key: "mira", name: "Mira Stahl", pos: "P4", meta: "TLS-DarkFriday · 214 Punkte", stats: "2 Rennen · 1 Sieg · 2 Podien · 1 Pole · 1 schnellste Runde", adjustments: [] },
    { key: "kai", name: "Kai Funke", pos: "P6", meta: "TLS-Lions · 176 Punkte", stats: "2 Rennen · 1 Podium", adjustments: [] },
  ]);
  // Mit Rennergebnis (#1927): Fahrer des Tages und gutgemachte Plätze wie im Fahrer-Detail des Webs.
  const detailed: SeasonPage = { ...RACING, standings: { rows: [{ key: "mira", rank: 4, points: 43, name: "Mira Stahl", club_member: true, results: [{ ...res("r9", 2, 18), grid: 7, driver_of_the_day: true }, { ...res("r10", 1, 25), grid: 2 }] }] } };
  expect(driverCards(detailed)[0].stats).toBe("2 Rennen · 1 Sieg · 2 Podien · 1× Fahrer des Tages · 6 Plätze gutgemacht");
});

test("Kalender mit Land: Code und Name für die Flagge, auch ohne Ort", () => {
  const rows = roundRows({ rounds: [{ id: "x", code: "R1", state: "planned", country_code: "az" }, { id: "y", code: "R2", state: "planned", country_code: "zz" }] });
  expect(rows.map((row) => [row.country, row.countryName, row.place])).toEqual([["AZ", "Aserbaidschan", "Aserbaidschan"], ["", "", ""]]);
});
