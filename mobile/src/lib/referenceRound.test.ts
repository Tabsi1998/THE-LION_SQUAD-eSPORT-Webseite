import { gridWords } from "./raceWeekend";
import { noScoreText } from "./seriesSpecialRules";
import {
  countFrame,
  countShape,
  countsUp,
  emptyText,
  leaders,
  metricText,
  mobileMain,
  mobileSub,
  neighbourLabel,
  personLine,
  pickSession,
  posLabel,
  rankBy,
  roundEyebrow,
  roundHeading,
  roundSubline,
  rowBadges,
  sessionKey,
  summaryCards,
  type RoundPage,
} from "./referenceRound";

// Ergebnisseite einer Runde in der App (#1950, #1974) - dieselben Regeln wie im Web (frontend/src/lib/roundResults.js,
// countUp.js, seasonStatistics.js). Der Server rechnet alles; hier wird nur gewählt, beschriftet und hochgezählt.
// Außerhalb der Tabelle stehen mit Namen nur öffentliche Vereinsfahrer. Erfundene Namen.

const row = (key: string, place: number | null, extra: Record<string, unknown> = {}) => ({
  key, place, status: "finished", name: `Fahrer ${key}`, name_hidden: false, club_member: false, profile_slug: null, own: false,
  start_number: null, team: null, team_color: null, grid: null, gained: null, time: null, gap: null, penalty_seconds: null,
  points: null, marks: [], fastest_lap: false, fastest_lap_time: null, driver_of_the_day: false, ...extra,
});

const PAGE: RoundPage = {
  lineage: { title: "Probe Racing League", slug: "prl", kind: "racing" },
  series: { season: "2026", tier: "Liga 2", season_slug: "2026", status: "active" },
  own_teams: ["Löwen Racing"],
  round: { number: 3, total: 24, code: "R3", title: null, venue: "Baku City Circuit", country_code: "AZ", club_day: "2026-10-08", kind: "regular", cancelled: false, scored: true },
  previous: { number: 2, code: "R2", country_code: "SG" },
  next: null,
  main: "rennen",
  club_drivers: ["mira"],
  summary: {
    winner: { key: "ext", session: "rennen", grid: 2 },
    pole: { key: "ext", time: "1:41.233", session: "qualifying" },
    fastest_lap: { key: "mira", session: "rennen", time: "1:44.002" },
    driver_of_the_day: { key: "mira", session: "rennen" },
  },
  sessions: [
    { id: "q", key: "qualifying", session: "Qualifying", label: "Qualifying", kind: "qualifying", state: "scored", club_day: "2026-10-08", time: "19:30", counts: false, has_result: true, columns: ["time", "gap"],
      rows: [row("ext", 1, { time: "1:41.233", team: "Team Nord", team_color: "#00d2be" }), row("mira", 2, { gap: "+0.261", club_member: true, own: true, team: "Löwen Racing" })] },
    { id: "r", key: "rennen", session: "Rennen", label: "Rennen", kind: "race", state: "scored", club_day: "2026-10-08", time: "20:00", counts: true, has_result: true, columns: ["grid", "time", "gap", "points"], best_club: "mira",
      rows: [
        row("ext", 1, { time: "31:55.056", grid: 2, gained: 1, points: 25, team: "Team Nord", team_color: "#00d2be", marks: ["pole"] }),
        row("mira", 2, { gap: "+6.197", grid: 5, gained: 3, points: 18, club_member: true, own: true, team: "Löwen Racing", fastest_lap: true, driver_of_the_day: true, penalty_seconds: 5 }),
        row("dnf", null, { status: "dnf", points: 0 }),
      ] },
  ],
};

test("Lauf-Schlüssel wie im Server, gewählter Lauf aus der Adresse, sonst das Hauptrennen", () => {
  expect(sessionKey("Qualifying")).toBe("qualifying");
  expect(sessionKey("Lauf 1")).toBe("lauf-1");
  expect(sessionKey("Hauptrennen (Ü30)")).toBe("hauptrennen-ue30");
  expect(sessionKey("")).toBe("rennen");
  expect(pickSession(PAGE, "qualifying")?.key).toBe("qualifying");
  expect(pickSession(PAGE, "gibt-es-nicht")?.key).toBe("rennen");
  expect(pickSession({ sessions: [] }, "")).toBeNull();
});

test("Kopf: Land als Name, Runde von gesamt mit Tag, Nachbarn mit Kürzel und Land", () => {
  expect(roundHeading(PAGE.round)).toEqual({ heading: "Aserbaidschan", sub: "Baku City Circuit" });
  expect(roundEyebrow(PAGE.round)).toBe("Runde 3 von 24 · Do., 08.10.2026");
  expect(roundSubline(PAGE.round, "Baku City Circuit")).toBe("R3 · Do., 08.10.2026 · Baku City Circuit");
  expect(neighbourLabel(PAGE.previous)).toBe("R2 Singapur");
  expect(neighbourLabel(null)).toBe("");
  expect(roundHeading({ number: 4 })).toEqual({ heading: "Runde 4", sub: "" });
});

test("Zeilen: Platz oder DNF, Abzeichen, Zeit mit Komma und Abstand darunter", () => {
  const [winner, mira, out] = PAGE.sessions?.[1].rows || [];
  expect(posLabel(winner)).toBe("1");
  expect(posLabel(out)).toBe("DNF");
  expect(rowBadges(winner).map((badge) => badge.short)).toEqual(["Pole"]);
  expect(rowBadges(mira).map((badge) => badge.short)).toEqual(["Beste Runde", "Fahrer des Tages", "+5 s Strafe"]);
  expect(rowBadges(out).map((badge) => badge.short)).toEqual(["DNF"]);
  expect(mobileMain(winner)).toBe("31:55,056");
  expect(mobileMain(mira)).toBe("+6,197");
  expect(mobileMain(out)).toBe("Ausfall");
  expect(mobileSub(winner, { points: true })).toBe("25 P");
  expect(mobileSub({ ...mira, time: "32:01.253" }, { points: true })).toBe("+6,197 · 18 P");
});

test("Zusammenfassung: fremder Sieger nur mit Team, Vereinsfahrer mit Namen, Zeiten zum Hochzählen", () => {
  const cards = summaryCards(PAGE, pickSession(PAGE, ""));
  expect(cards.map((card) => [card.key, card.label, card.value, card.count || "", card.sub || ""])).toEqual([
    ["winner", "Sieger", "Team Nord", "", "von Startplatz 2"],
    ["pole", "Pole", "Team Nord", "1:41,233", ""],
    ["fastest_lap", "Schnellste Runde", "Fahrer mira", "1:44,002", ""],
    ["driver_of_the_day", "Fahrer des Tages", "Fahrer mira", "", "Löwen Racing"],
    ["best_club", "Bester Vereinsfahrer · Rennen", "Fahrer mira · P2", "", "Löwen Racing · 18 Punkte"],
  ]);
  expect(cards[0].color).toBe("#00d2be");
  // Ohne Team und ohne Nummer: nur ein Strich, nie der fremde Name.
  expect(personLine(row("x", 1), [])).toMatchObject({ value: "–", named: false });
});

test("Leerer Lauf: abgesagt, Ergebnis folgt oder noch kein Ergebnis mit Tag und Uhrzeit", () => {
  expect(emptyText(null)).toBe("Für diese Runde gibt es noch keine Läufe.");
  expect(emptyText({ key: "s", label: "Sprint", state: "cancelled" })).toBe("Sprint abgesagt.");
  expect(emptyText({ key: "s", label: "Sprint", state: "missing", club_day: "2026-10-08", time: "20:00" })).toBe("Ergebnis folgt – Sprint am Do., 08.10.2026, 20:00 Uhr.");
  expect(emptyText({ key: "s", label: "Sprint", state: "planned" })).toBe("Noch kein Ergebnis – Sprint.");
});

test("Sonderregeln am Lauf (#1960): ohne Wertung mit Grund, umgekehrte Startaufstellung mit Top N", () => {
  expect(noScoreText({ no_score_reason: "too_few", no_score_note: "Nur zwei am Start" })).toBe("Ohne Wertung · Zu wenig Fahrer – Nur zwei am Start");
  expect(noScoreText({ no_score_reason: null })).toBe("");
  expect(gridWords("reverse_qualifying", 8)).toBe("Start in umgekehrter Quali-Reihenfolge (Top 8)");
  expect(gridWords("reverse_standings")).toBe("Start in umgekehrter WM-Reihenfolge vor der Runde");
  expect(gridWords("qualifying")).toBe("");
});

test("Hochzählen: Form der Zeit, Start bei null, am Ende genau der Text - Wörter zählen nicht", () => {
  const shape = countShape("31:55,056");
  expect(shape?.total).toBe(1915056);
  expect(countFrame(shape, 0)).toBe("00:00,000");
  expect(countFrame(shape, 1)).toBe("31:55,056");
  expect(countFrame(countShape("+6,197"), 0)).toBe("+0,000");
  expect(countFrame(countShape("1:32:15,123"), 0.5)).toMatch(/^\d:\d{2}:\d{2},\d{3}$/);
  for (const text of ["+2 Runden", "Ausfall", "DNF", "–", "", "0", "+0,000", "1:2", "12 s", "1,2,3"]) expect(countShape(text)).toBeNull();
});

test("Statistik (#1950): Rang je Kennzahl mit geteiltem Platz, Ø-Werte aufsteigend, „+/−“ mit Zeichen", () => {
  const rows = [
    { key: "a", name: "Anna Probe", wins: 2, avg_grid: 4.5, gained: 3 },
    { key: "b", name: "Bert Probe", wins: 2, avg_grid: 2.0, gained: -2 },
    { key: "c", name: "Cleo Probe", wins: 0, avg_grid: null, gained: null },
  ];
  expect(rankBy(rows, "wins").map((entry) => [entry.row.key, entry.rank])).toEqual([["a", 1], ["b", 1], ["c", null]]);
  expect(leaders(rows, "avg_grid").map((entry) => entry.row.key)).toEqual(["b", "a"]);
  expect(metricText(rows[0], "avg_grid")).toBe("4,5");
  expect(metricText(rows[0], "gained")).toBe("+3");
  expect(metricText(rows[1], "gained")).toBe("−2");
  expect(metricText(rows[2], "wins")).toBe("–");
});

test("nur die ersten 24 Zeilen zählen hoch - große Felder starten keine 60 Animationen", () => {
  expect(countsUp(0)).toBe(true);
  expect(countsUp(23)).toBe(true);
  expect(countsUp(24)).toBe(false);
  expect(countsUp(59)).toBe(false);
  expect(countsUp(-1)).toBe(false);
});
