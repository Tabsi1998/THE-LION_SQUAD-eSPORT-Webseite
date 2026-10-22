import { parseSeasonTablePaste } from "@/lib/resultPaste";
import {
  applyBody, applySummary, buildBody, decisionFor, decisionValue, defaultSelection, mergeDecisions, organizerDecisions,
  proposalDecisions, rememberCandidates, roundOption, targetText, totalText, totalsSummary, unclearCells,
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

test("Texte: Termin, Ziel, Abgleich und Rückmeldung", () => {
  expect(roundOption({ code: "R2", session: "Sprint", venue: "Probe Ring", club_day: "2026-03-08" })).toBe("R2 · Sprint · Probe Ring · So., 08.03.2026");
  expect(targetText(COLUMNS[1])).toBe("Entwurf neben dem veröffentlichten Ergebnis – du gibst ihn frei");
  expect(targetText(COLUMNS[3])).toBe("Spalte wird nicht übernommen");
  expect(targetText({ round: null, state: "unmatched" })).toBe("Bitte einen Termin wählen");
  expect(totalText({ state: "ok", reasons: [] })).toBe("stimmt");
  expect(totalText({ state: "explained", deviation: -16, explains: [{ text: "Streichresultate", points: -20 }, { text: "Aktivitätspunkte", points: 4 }] }))
    .toBe("−16: Streichresultate −20 · Aktivitätspunkte +4");
  expect(totalText({ state: "differs", deviation: 3, reasons: [] })).toBe("weicht +3 ab");
  expect(totalsSummary([{ state: "ok" }, { state: "differs", rank_differs: true }, { state: "no_total" }])).toEqual({ ok: 1, explained: 0, differs: 1, none: 1, ranks: 1 });
  expect(applySummary([{ status: "saved" }, { status: "saved" }, { status: "unclear" }])).toEqual({ ok: false, text: "2 Runden als Entwurf übernommen · 1 mit offenen gelben Zellen." });
  expect(applySummary([])).toEqual({ ok: true, text: "Nichts zu übernehmen – alles ist schon da." });
});
