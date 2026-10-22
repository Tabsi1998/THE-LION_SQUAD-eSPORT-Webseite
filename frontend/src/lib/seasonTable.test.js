import { parseSeasonTablePaste } from "@/lib/resultPaste";
import {
  applyBody, applySummary, buildBody, confirmTableNames, decisionFor, decisionValue, defaultSelection, imageTable, imageTeamRows, markText,
  lastTableRound, mergeDecisions, organizerDecisions, prefilledTableNames, proposalDecisions, rememberCandidates, roundOption, tableText,
  targetText, totalText, totalsSummary, unclearCells, undoTableNames,
} from "@/lib/seasonTable";

// Saisontabelle einlesen (#1928): Anfrage aus der eingefügten Tabelle, Auswahl, gelbe Zellen und Texte der Vorschau.
// Nur erfundene Namen.

const TEXT = "Pos\tFahrer\tTeam\tR1\tR2\tGesamt\n1\tAda Ausgedacht\tProbe Rot\t25\t21\t46\n2\tBruno Beispiel\t\t--\tOUT\t0\n\t\t\t\t\t";

test("die Anfrage nimmt nur Runden-Spalten mit gewähltem Termin, Name, Team, Gesamt und Platz", () => {
  const parsed = parseSeasonTablePaste(TEXT);
  const kinds = parsed.columns.map((column) => column.kind);
  expect(kinds).toEqual(["rank", "name", "team", "round", "round", "total"]);
  const body = buildBody(parsed, kinds, { 4: "r2", 3: undefined }, "scheme", []);
  expect(body.columns).toEqual([{ label: "R1" }, { label: "R2", round_id: "r2" }]);
  expect(body.rows).toEqual([
    { name: "Ada Ausgedacht", team: "Probe Rot", cells: ["25", "21"], total: 46, rank: 1 },
    { name: "Bruno Beispiel", team: null, cells: ["--", "OUT"], total: 0, rank: 2 },
  ]);
  expect(body.team_column).toBe(true);
  // „Nicht übernehmen“ ist "", ohne Team-Spalte belegt der Server das Stammteam vor.
  const skipped = buildBody(parsed, ["rank", "name", "ignore", "round", "round", "total"], { 3: "" }, "organizer");
  expect(skipped.columns[0]).toEqual({ label: "R1", round_id: "" });
  expect(skipped.team_column).toBe(false);
  expect(skipped.points).toBe("organizer");
});

const COLUMNS = [
  { index: 0, label: "R1", state: "new", round: { id: "r1", code: "R1" }, expected_version: 0, target: "sheet", cells: [] },
  { index: 1, label: "R2", state: "changed", round: { id: "r2", code: "R2" }, expected_version: 4, target: "pending_draft", cells: [] },
  { index: 2, label: "R3", state: "unclear", round: { id: "r3", code: "R3" }, expected_version: 0, target: "sheet", unclear: 2, cells: [
    { row: 0, text: "21", state: "unclear", code: "bonus", candidates: [{ place: 6, bonus_keys: ["bingo"], marks: [], label: "Platz 6 + Bingo" }] },
    { row: 1, text: "2", state: "unclear", code: "ambiguous", candidates: [{ place: 9, bonus_keys: [], marks: [], label: "Platz 9" }, { place: 10, bonus_keys: [], marks: ["fastest_lap"], label: "Platz 10 + schnellste Runde" }] },
    { row: 2, text: "25", state: "ok", code: "place", place: 1 },
  ] },
  { index: 3, label: "Spa", state: "skip", round: null, expected_version: 0, target: null, cells: [] },
];
const ROWS = [{ name: "Ada Ausgedacht" }, { name: "Bruno Beispiel" }, { name: "Cleo Muster" }];

test("vorgewählt ist nur Neues; Übernehmen schickt Spalte, Termin und Version", () => {
  expect(defaultSelection(COLUMNS)).toEqual([0]);
  const body = { columns: [], rows: [] };
  expect(applyBody(body, COLUMNS, [0, 1, 2, 3]).items).toEqual([
    { column: 0, round_id: "r1", expected_version: 0 }, { column: 1, round_id: "r2", expected_version: 4 }]);
});

test("gelbe Zellen mit Vorschlägen: eindeutige übernehmen, Rest laut Veranstalter, geklärte bleiben wählbar", () => {
  const cells = unclearCells(COLUMNS, ROWS);
  expect(cells.map((cell) => [cell.round, cell.name, cell.value, cell.code])).toEqual([
    ["R3", "Ada Ausgedacht", "21", "bonus"], ["R3", "Bruno Beispiel", "2", "ambiguous"]]);
  expect(proposalDecisions(cells)).toEqual([{ column: 2, row: 0, choice: "place", place: 6, bonus_keys: ["bingo"], marks: [] }]);
  expect(organizerDecisions(cells)).toEqual([{ column: 2, row: 0, choice: "organizer" }, { column: 2, row: 1, choice: "organizer" }]);
  const picked = decisionFor(cells[1], "c1");
  expect(picked).toEqual({ column: 2, row: 1, choice: "place", place: 10, bonus_keys: [], marks: ["fastest_lap"] });
  expect(decisionValue(picked, cells[1].candidates)).toBe("c1");
  expect(decisionValue({ choice: "organizer" })).toBe("organizer");
  expect(decisionFor(cells[1], "")).toBeNull();
  const merged = mergeDecisions([picked], [["2:1", null], ["2:0", { column: 2, row: 0, choice: "organizer" }]]);
  expect(merged).toEqual([{ column: 2, row: 0, choice: "organizer" }]);
  // Nach dem Klären schickt der Server „decided“ ohne Vorschläge - gemerkte Vorschläge halten die Auswahl.
  const known = rememberCandidates({}, COLUMNS);
  const decided = [{ ...COLUMNS[2], cells: [{ row: 0, text: "21", state: "ok", code: "decided", place: 6 }] }];
  expect(unclearCells(decided, ROWS, known)).toEqual([expect.objectContaining({ decided: true, code: "bonus", candidates: COLUMNS[2].cells[0].candidates })]);
  expect(unclearCells(decided, ROWS, {})).toEqual([]);
});

// Bild (#1999): wie die Bild-Erkennung eine Tabelle liefert - Spalten mit Art, Zellen als Text, gelbe Zellen je Zeile.
const IMAGE = {
  kind: "drivers", detected: "drivers",
  columns: [{ label: "Pos.", kind: "rank" }, { label: "Fahrer", kind: "name" }, { label: "Runde 1", kind: "round" },
    { label: "Runde 2", kind: "round" }, { label: "Punkte", kind: "total" }, { label: "Dif.", kind: "gap" }],
  rows: [
    { cells: ["1", "Ada Ausgedacht", "25", "18", "43", "--"], uncertain: [], read: {}, notes: [] },
    { cells: ["2", "Bruno Beispiel", "--", "25", "25", "-18"], uncertain: [3, 4], read: { 3: "23" }, notes: ["Summe der Runden 25 ≠ Punkte 25"] },
  ],
};

test("eine Fahrer-Tabelle aus dem Bild wird zur eingefügten Tabelle - mit den gelben Zellen je Zeile", () => {
  const { parsed, marks } = imageTable(IMAGE);
  expect(parsed.columns.map((column) => column.kind)).toEqual(["rank", "name", "round", "round", "total", "ignore"]);
  expect(parsed.rows[1]).toEqual({ line: 2, cells: ["2", "Bruno Beispiel", "--", "25", "25", "-18"] });
  expect(tableText(parsed).split("\n")[0]).toBe("Pos.\tFahrer\tRunde 1\tRunde 2\tPunkte\tDif.");
  expect(marks).toEqual([{ row: 1, name: "Bruno Beispiel", notes: ["Summe der Runden 25 ≠ Punkte 25"], cells: [
    { column: 3, kind: "round", label: "Runde 2", value: "25", read: "23" }, { column: 4, kind: "total", label: "Punkte", value: "25", read: "" }] }]);
  expect(markText(marks[0])).toBe("Runde 2: 25 (gelesen 23) · Punkte: 25");
  const many = { cells: Array.from({ length: 7 }, (_, index) => ({ label: `Runde ${index + 1}`, value: "10", read: index === 5 ? "16" : "" })) };
  expect(markText(many)).toBe("Runde 6: 10 (gelesen 16) · Runde 1: 10 · Runde 2: 10 · Runde 3: 10 · + 3 weitere");
  // Dieselbe Tabelle wie eingefügter Text ergibt dieselbe Anfrage.
  const body = buildBody(parsed, parsed.columns.map((column) => column.kind));
  expect(body.rows[1]).toEqual({ name: "Bruno Beispiel", team: null, cells: ["--", "25"], total: 25, rank: 2 });
});

test("eine Team-Tabelle aus dem Bild wird zur Teamwertung - gelb, wenn Team oder Punkte unsicher sind", () => {
  const teams = { ...IMAGE, kind: "teams", detected: "teams", columns: IMAGE.columns.map((column) => (column.kind === "name" ? { label: "Team", kind: "name" } : column)) };
  expect(imageTeamRows(teams)).toEqual([
    { team: "Ada Ausgedacht", points: "43", ocr: null, hint: "" },
    // Der Hinweis an der Summe geht mit (aktuelle Besetzung, #1960) - er macht nichts gelb.
    { team: "Bruno Beispiel", points: "25", ocr: { read: "", fields: ["points"] }, hint: "Summe der Runden 25 ≠ Punkte 25" },
  ]);
  expect(imageTeamRows({ columns: [{ label: "Team", kind: "name" }], rows: [] })).toEqual([]);
});

test("„Alle Namen bestätigen“ in der Tabelle aus dem Bild: nur die gelben Namen, mit Rückgängig (#2018)", () => {
  const image = { ...IMAGE, rows: [
    { cells: ["1", "Ada Ausgedacht", "25", "18", "43", "--"], uncertain: [1], read: { 1: "Ada Ausgedcht" }, notes: [] },
    { cells: ["2", "Bruno Beispiel", "--", "25", "25", "-18"], uncertain: [1, 3], read: {}, notes: [] },
    { cells: ["3", "", "10", "5", "15", "-28"], uncertain: [1], read: {}, notes: [] },
  ] };
  const { marks } = imageTable(image);
  expect(prefilledTableNames(marks)).toBe(2); // ein leerer Name zählt nicht
  const { marks: done, undo } = confirmTableNames(marks);
  expect(done.map((mark) => [mark.row, mark.cells.map((cell) => cell.column)])).toEqual([[1, [3]], [2, [1]]]);
  expect(undo.count).toBe(2);
  expect(undoTableNames(done, undo)).toEqual(marks);
  // Zeile 2 inzwischen mit „Passt so“ geprüft: sie bleibt geprüft, Zeile 1 kommt wieder.
  const back = undoTableNames(done.filter((mark) => mark.row !== 1), undo);
  expect(back.map((mark) => mark.row)).toEqual([0, 2]);
  expect(undoTableNames(marks, null)).toBe(marks);
});

test("das Bild hängt an der letzten Runde der Tabelle - im Kalender die späteste mit Spalte (#1933)", () => {
  expect(lastTableRound([
    { round: { id: "r3", position: 3 }, state: "new" }, { round: { id: "r9", position: 9 }, state: "skip" },
    { round: { id: "r5", position: 5 }, state: "same" }, { round: null, state: "unmatched" },
  ])).toEqual({ id: "r5", position: 5 });
  expect(lastTableRound([])).toBeNull();
});

test("Texte: Termin, Ziel, Abgleich und Rückmeldung", () => {
  expect(roundOption({ code: "R2", session: "Sprint", venue: "Probe Ring", club_day: "2026-03-08" })).toBe("R2 · Sprint · Probe Ring · So., 08.03.2026");
  expect(targetText(COLUMNS[1])).toBe("Entwurf neben dem veröffentlichten Ergebnis – du gibst ihn frei");
  expect(targetText(COLUMNS[3])).toBe("Spalte wird nicht übernommen");
  expect(targetText({ ...COLUMNS[0], state: "same" })).toBe("Ergebnis stimmt mit der Tabelle überein");
  expect(targetText({ round: null, state: "unmatched" })).toBe("Bitte einen Termin wählen");
  expect(totalText({ state: "ok", reasons: [] })).toBe("stimmt");
  expect(totalText({ state: "explained", deviation: -16, explains: [{ text: "Streichresultate", points: -20 }, { text: "Aktivitätspunkte", points: 4 }] }))
    .toBe("erklärt (−16): Streichresultate −20 · Aktivitätspunkte +4");
  expect(totalText({ state: "explained", deviation: -5, explains: [{ text: "Anpassungen", points: -5 }] })).toBe("erklärt: Anpassungen −5");
  expect(totalText({ state: "differs", deviation: 3, reasons: [] })).toBe("weicht +3 ab");
  expect(totalsSummary([{ state: "ok" }, { state: "differs", rank_differs: true }, { state: "no_total" }])).toEqual({ ok: 1, explained: 0, differs: 1, none: 1, ranks: 1 });
  expect(applySummary([{ status: "saved" }, { status: "saved" }, { status: "unclear" }])).toEqual({ ok: false, text: "2 Runden als Entwurf übernommen · 1 mit offenen gelben Zellen." });
  expect(applySummary([])).toEqual({ ok: true, text: "Nichts zu übernehmen – alles ist schon da." });
});
