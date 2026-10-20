import { autoPlaces, emptyRow, formToPayload, pastedToRows, problemsByRow, scoredText, sheetToForm } from "@/lib/referenceResults";
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
  expect(organizer[1].points_source).toBe("organizer");
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
  const rows = pastedToRows(parseResultPaste("1. alpha 25\n2. Unbekannt DNF").rows, PEOPLE);
  expect(rows.map((row) => [row.participant_id, row.name, row.place, row.points, row.marks])).toEqual([
    ["p1", "alpha", "1", "25", []],
    ["", "Unbekannt", "2", "", ["dnf"]],
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
