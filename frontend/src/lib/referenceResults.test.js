import { autoPlaces, countFieldErrors, emptyMap, emptyMatch, emptyRow, fieldErrors, formToPayload, pastedToRows, problemsByRow, scoredText, sheetToForm } from "@/lib/referenceResults";
import { parseResultPaste } from "@/lib/resultPaste";

// Ergebnisse eintragen (#1744): Formular ↔ Vertrag des Servers. Nur erfundene Namen.

const PEOPLE = [
  { id: "p1", name: "Alpha", default_team: "Probe Racing" },
  { id: "p2", name: "Beta", default_team: "Test GP" },
];

test("Platz aus der Reihenfolge, Nichtstart ohne Platz, leere Zeilen fallen weg", () => {
  const rows = [emptyRow({ name: "Alpha" }), emptyRow(), emptyRow({ name: "Gamma", marks: ["dns"] }), emptyRow({ name: "Delta" })];
  expect(Object.values(autoPlaces(rows))).toEqual([1, null, 3]);
  const { payload, rowKeys } = formToPayload({ rows, matches: [], table: [], note: "" }, { points_mode: "scheme" });
  expect(payload.rows.map((row) => [row.name, row.place])).toEqual([["Alpha", 1], ["Gamma", null], ["Delta", 3]]);
  expect(rowKeys).toEqual([rows[0].key, rows[2].key, rows[3].key]);
  expect(payload.note).toBeNull();
});

test("Punkte: leer nach Schlüssel, eingetragen laut Veranstalter, „überschreiben“ zählt", () => {
  const rows = [
    emptyRow({ participant_id: "p1", name: "Alpha", place: "2", points: "18" }),
    emptyRow({ name: "Beta", points: "12,5", override: true, penalty_points: "5", start_number: "7" }),
    emptyRow({ name: "Gamma" }),
  ];
  const scheme = formToPayload({ rows, matches: [], table: [], note: "" }, { points_mode: "scheme" }).payload.rows;
  expect(scheme[0]).toMatchObject({ participant_id: "p1", place: 2, points: 18, points_source: "organizer" });
  expect(scheme[0].name).toBeUndefined();
  expect(scheme[1]).toMatchObject({ name: "Beta", start_number: "7", points: 12.5, points_source: "manual", penalty_points: 5 });
  expect(scheme[2]).toMatchObject({ points: null, points_source: "scheme" });
  const organizer = formToPayload({ rows, matches: [], table: [], note: "" }, { points_mode: "organizer" }).payload.rows;
  expect(organizer.map((row) => row.points_source)).toEqual(["organizer", "manual", "scheme"]);
});

test("gespeichertes Blatt zurück ins Formular – Namen aus den Teilnehmern, offizieller Gesamtstand", () => {
  const form = sheetToForm({
    rows: [{ participant_id: "p2", place: 1, team: "Test GP", points: 25, points_source: "manual", marks: ["pole"], penalty_points: 0 }],
    official_totals: { p2: 50 }, matches: [], official_table: [], note: "vorläufig",
  }, PEOPLE);
  expect(form.rows[0]).toMatchObject({ participant_id: "p2", name: "Beta", place: "1", points: "25", override: true, marks: ["pole"], official_total: "50" });
  expect(form.note).toBe("vorläufig");
  expect(sheetToForm(null, PEOPLE).rows).toHaveLength(1);
  const league = sheetToForm(null, PEOPLE, { kind: "team_league", teamName: "Probe Lions", opponent: "Test Eagles" });
  expect(league.rows).toEqual([]);
  expect(league.matches[0]).toMatchObject({ home: "Probe Lions", away: "Test Eagles" });
});

test("Team-Liga: Spiel mit Maps und Aufstellung, Tabelle ohne leere Werte", () => {
  const form = sheetToForm(null, PEOPLE, { kind: "team_league", teamName: "Probe Lions", opponent: "Test Eagles" });
  form.matches[0] = { ...form.matches[0], home_score: "2", away_score: "1", maps: [{ key: "m", name: "Probe Map", home_score: "13", away_score: "9" }, { key: "x", name: "", home_score: "", away_score: "" }], lineup: [{ participant_id: "p1", name: "Alpha" }, { participant_id: "", name: "Neu" }] };
  form.table = [{ rank: 1, team: "Probe Lions", played: 3, won: 2, drawn: null, lost: 1, score_for: null, score_against: null, score_diff: null, points: 6 }];
  const { payload } = formToPayload(form, {});
  expect(payload.matches).toEqual([{ home: "Probe Lions", away: "Test Eagles", home_score: 2, away_score: 1, maps: [{ name: "Probe Map", home_score: 13, away_score: 9 }], lineup: [{ participant_id: "p1" }, { name: "Neu" }] }]);
  expect(payload.official_table).toEqual([{ team: "Probe Lions", rank: 1, played: 3, won: 2, lost: 1, points: 6 }]);
});

test("eingefügte Liste: bekannte Namen gleich mit Kennung", () => {
  const rows = pastedToRows(parseResultPaste("1. alpha  25\n2. Unbekannt DNF\n3. Probe 7").rows, PEOPLE);
  expect(rows[2].points_hint).toEqual({ points: 7, text: "7" });
  expect(rows.map((row) => [row.participant_id, row.name, row.place, row.points, row.marks])).toEqual([
    ["p1", "alpha", "1", "25", []],
    ["", "Unbekannt", "2", "", ["dnf"]],
    ["", "Probe 7", "3", "", []],
  ]);
});

test("Meldungen der Vorschau landen an der richtigen Formularzeile, Spiele und Allgemeines oben", () => {
  const { byRow, general } = problemsByRow({
    errors: [{ code: "duplicate", message: "Teilnehmer doppelt.", rows: [0, 1] }, { code: "empty", message: "Leer.", rows: [] }],
    warnings: [{ code: "lineup", message: "Aufstellung fehlt.", rows: [], match: 0 }],
  }, ["a", "b"]);
  expect(byRow).toEqual({ a: [{ level: "error", message: "Teilnehmer doppelt." }], b: [{ level: "error", message: "Teilnehmer doppelt." }] });
  expect(general).toEqual([{ level: "error", message: "Leer.", match: undefined }, { level: "warning", message: "Aufstellung fehlt.", match: 0 }]);
  expect(scoredText({ points: 25.5, base: 25, bonus: 1, penalty: 0.5 })).toBe("25,5 Pkt (25 + 1 Bonus − 0,5 Strafe)");
  expect(scoredText({ points: 18, base: 18, bonus: 0, penalty: 0 })).toBe("18 Pkt");
});

// Was der Server aus einem Body speichert (series_results.Resolution.content) – so lässt sich prüfen, dass Öffnen und
// Speichern ohne Änderung genau das gespeicherte Blatt ergibt.
function storedFrom(payload) {
  const totals = {};
  const rows = payload.rows.map(({ official_total, participant_id, place, team, points, points_source, marks, penalty_points, note }) => {
    if (official_total !== null && official_total !== undefined) totals[participant_id] = official_total;
    return { participant_id, place, team, points, points_source, marks, penalty_points, note };
  });
  return {
    rows,
    matches: payload.matches.map((match) => ({ ...match, lineup: match.lineup.map((ref) => ref.participant_id) })),
    official_totals: totals,
    official_team_totals: payload.official_team_totals,
    official_table: payload.official_table,
    note: payload.note,
  };
}

test("Öffnen und Speichern ohne Änderung ergibt dasselbe Blatt – jedes Feld des Vertrags bleibt", () => {
  const sheet = {
    rows: [
      { participant_id: "p1", place: 1, team: "Probe Racing", points: 26, points_source: "manual", marks: ["fastest_lap", "pole"], penalty_points: 0, note: "Zeitstrafe zurückgenommen" },
      { participant_id: "p2", place: 2, team: null, points: 18, points_source: "organizer", marks: [], penalty_points: 5, note: null },
      { participant_id: "p3", place: null, team: "Test GP", points: null, points_source: "scheme", marks: ["dnf"], penalty_points: 0, note: null },
      { participant_id: "p4", place: null, team: null, points: null, points_source: "organizer", marks: ["dns"], penalty_points: 0, note: null },
      { participant_id: "p5", place: 3, team: null, points: null, points_source: "scheme", marks: [], penalty_points: 0, note: null },
    ],
    matches: [{ home: "Probe Lions", away: "Test Eagles", home_score: 2, away_score: 1, maps: [{ name: "Probe Map", home_score: 13, away_score: 9 }], lineup: ["p1", "p2"] }],
    official_totals: { p1: 51, p2: 30.5 },
    official_team_totals: { "Probe Racing": 77, "Test GP": 40 },
    official_table: [{ team: "Probe Lions", rank: 1, played: 3, won: 2, drawn: 0, lost: 1, score_for: 5, score_against: 3, score_diff: 2, points: 6 }],
    note: "vorläufig",
  };
  const people = [...PEOPLE, { id: "p3", name: "Gamma" }, { id: "p4", name: "Delta" }, { id: "p5", name: "Epsilon" }];
  for (const mode of ["scheme", "organizer"]) {
    const { payload } = formToPayload(sheetToForm(sheet, people), { points_mode: mode });
    expect(storedFrom(payload)).toEqual(sheet);
  }
});

test("ungültige Zahlen werden nie still umgedeutet: Feldfehler je Zeile, Spiel und Map", () => {
  const rows = [
    emptyRow({ name: "Alpha", place: "1,5", points: "12,5" }),
    emptyRow({ name: "Beta", place: "0", points: "zwölf", penalty_points: "-1", official_total: "1.2.3" }),
    emptyRow({ name: "Gamma", place: "3.", points: "-2", penalty_points: "2,5", official_total: "40" }),
  ];
  const match = { ...emptyMatch({ home: "Probe Lions", away: "Test Eagles" }), home_score: "2", away_score: "",
    maps: [{ ...emptyMap(), name: "Probe Map", home_score: "13", away_score: "x" }, { ...emptyMap(), name: "", home_score: "5", away_score: "" }] };
  const errors = fieldErrors({ rows, matches: [match], table: [], note: "" });
  expect(errors[rows[0].key]).toEqual({ place: "Platz als ganze Zahl von 1 bis 1000." });
  expect(Object.keys(errors[rows[1].key])).toEqual(["place", "points", "penalty_points", "official_total"]);
  expect(errors[rows[2].key]).toBeUndefined();
  expect(errors[match.key]).toEqual({ away_score: "Ergebnis fehlt." });
  expect(errors[match.maps[0].key]).toEqual({ away_score: "Stand als Zahl ab 0." });
  expect(errors[match.maps[1].key]).toEqual({ name: "Name der Map fehlt." });
  expect(countFieldErrors(errors)).toBe(8);
  // Gültig: Dezimalkomma bei Punkten, Platz mit Punkt dahinter.
  const { payload } = formToPayload({ rows: [rows[2]], matches: [], table: [], note: "" });
  expect(payload.rows[0]).toMatchObject({ place: 3, points: -2, penalty_points: 2.5, official_total: 40 });
});

// ---------------------------------------------------------------- Rennergebnis (#1927)
test("Rennergebnis: Startnummer, Startplatz, Zeit, Abstand, schnellste Runde und Fahrer des Tages gehen hin und zurück", () => {
  const sheet = {
    rows: [
      { participant_id: "p1", place: 1, team: null, points: null, points_source: "scheme", marks: [], penalty_points: 0, note: null, start_number: "7", grid: 3, time: "1:32:45.123" },
      { participant_id: "p2", place: 2, team: null, points: null, points_source: "scheme", marks: ["fastest_lap"], penalty_points: 0, note: null, grid: 1, gap: "+5.204" },
    ],
    fastest_lap: { participant_id: "p2", time: "1:31.456" },
    driver_of_the_day: "p1",
  };
  const form = sheetToForm(sheet, PEOPLE);
  expect(form.rows.map((row) => [row.start_number, row.grid, row.time, row.gap])).toEqual([["7", "3", "1:32:45.123", ""], ["", "1", "", "+5.204"]]);
  expect(form.fastestLap).toEqual({ name: "Beta", time: "1:31.456" });
  expect(form.driverOfTheDay).toBe("Alpha");
  const { payload } = formToPayload(form);
  expect(payload.rows[0]).toMatchObject({ participant_id: "p1", start_number: "7", grid: 3, time: "1:32:45.123" });
  expect(payload.rows[0]).not.toHaveProperty("gap");
  expect(payload.rows[1]).toMatchObject({ participant_id: "p2", grid: 1, gap: "+5.204" });
  expect(payload.rows[1]).not.toHaveProperty("start_number");
  expect(payload.fastest_lap).toEqual({ participant_id: "p2", time: "1:31.456" });
  expect(payload.driver_of_the_day).toEqual({ participant_id: "p1" });
});

test("Rennergebnis: neue Namen gehen als Name, ohne Angaben fehlen die Felder, ein falscher Startplatz ist ein Feldfehler", () => {
  const rows = [emptyRow({ name: "Neu Nora", grid: "x" }), emptyRow({ name: "Alpha", participant_id: "p1" })];
  const form = { rows, matches: [], table: [], note: "", fastestLap: { name: " neu nora ", time: " 1:31.4 " }, driverOfTheDay: "Gar Keiner" };
  expect(fieldErrors(form)[rows[0].key]).toEqual({ grid: "Startplatz als ganze Zahl von 1 bis 1000." });
  const { payload } = formToPayload(form);
  expect(payload.fastest_lap).toEqual({ name: "Neu Nora", time: "1:31.4" });
  expect(payload.driver_of_the_day).toEqual({ name: "Gar Keiner" });
  const plain = formToPayload({ rows: [emptyRow({ name: "Alpha" })], matches: [], table: [], note: "" }).payload;
  expect(plain).not.toHaveProperty("fastest_lap");
  expect(plain).not.toHaveProperty("driver_of_the_day");
  expect(Object.keys(plain.rows[0])).not.toContain("grid");
});

test("eingefügte Liste mit Rennspalten: Startplatz, Zeit und Abstand landen in den Zeilen", () => {
  const parsed = parseResultPaste("Pos\tNr\tFahrer\tStart\tZeit\tAbstand\n1\t7\tAlpha\t3\t1:32:45.1\t\n2\t12\tBeta\t1\t\t+5.2");
  const rows = pastedToRows(parsed.rows, PEOPLE);
  expect(rows.map((row) => [row.participant_id, row.start_number, row.grid, row.time, row.gap])).toEqual([
    ["p1", "7", "3", "1:32:45.1", ""], ["p2", "12", "1", "", "+5.2"]]);
});
