import { cleanText, parseMark, parseNumber, parsePlace, parseResultPaste, parseTablePaste } from "@/lib/resultPaste";

// Ergebnisliste einfügen (#1744): der einzige Text-Parser für Ergebnisse externer Serien. Nur erfundene Namen.

const pick = (rows, ...keys) => rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])));

test("Bausteine: Leerraum, Zahlen, Plätze und Marken", () => {
  expect(cleanText("  Probe  Fahrer\t ")).toBe("Probe Fahrer");
  expect(parseNumber("25")).toBe(25);
  expect(parseNumber("12,5")).toBe(12.5);
  expect(parseNumber("-3")).toBe(-3);
  expect(parseNumber("1.2.3")).toBeNull();
  expect(parseNumber("12,")).toBeNull();
  expect(parseNumber("abc")).toBeNull();
  expect(parsePlace("1.")).toBe(1);
  expect(parsePlace("3)")).toBe(3);
  expect(parsePlace("#7")).toBe(7);
  expect(parsePlace("0")).toBeNull();
  expect(parsePlace("1001")).toBeNull();
  expect(parseMark("DNF")).toBe("dnf");
  expect(parseMark("dq")).toBe("dsq");
  expect(parseMark("Schnellste  Runde")).toBe("fastest_lap");
  expect(parseMark("Probe")).toBeNull();
});

test("Zeilen „1. Name  25“: Punkte nur klar abgesetzt (zwei Leerzeichen oder Einheit), Marken, ohne Leerzeichen nach dem Punkt", () => {
  const result = parseResultPaste("1. Alpha Fahrer  25\n2) Beta 18 Pkt\n3 Gamma DNF\n4.Delta   12,5\n5 - Epsilon\n6. Zeta 7 P.");
  expect(result.format).toBe("lines");
  expect(result.errors).toEqual([]);
  expect(pick(result.rows, "line", "place", "name", "points", "marks", "points_hint")).toEqual([
    { line: 1, place: 1, name: "Alpha Fahrer", points: 25, marks: [], points_hint: null },
    { line: 2, place: 2, name: "Beta", points: 18, marks: [], points_hint: null },
    { line: 3, place: 3, name: "Gamma", points: null, marks: ["dnf"], points_hint: null },
    { line: 4, place: 4, name: "Delta", points: 12.5, marks: [], points_hint: null },
    { line: 5, place: 5, name: "Epsilon", points: null, marks: [], points_hint: null },
    { line: 6, place: 6, name: "Zeta", points: 7, marks: [], points_hint: null },
  ]);
});

test("eine Zahl am Namen bleibt beim Namen – mit Hinweis, dass sie Punkte sein könnten", () => {
  const result = parseResultPaste("1. Max Muster 33\n2. Lion77\n3 Probe Fahrer 18 DNF\nTest Name 5");
  expect(result.errors).toEqual([]);
  expect(pick(result.rows, "place", "name", "points", "marks", "points_hint")).toEqual([
    { place: 1, name: "Max Muster 33", points: null, marks: [], points_hint: { points: 33, text: "33" } },
    { place: 2, name: "Lion77", points: null, marks: [], points_hint: null },
    { place: 3, name: "Probe Fahrer 18", points: null, marks: ["dnf"], points_hint: { points: 18, text: "18" } },
    { place: null, name: "Test Name 5", points: null, marks: [], points_hint: { points: 5, text: "5" } },
  ]);
  // In Tabellen ist die Spalte klar getrennt – dort gibt es keinen Zweifel.
  expect(parseResultPaste("1\tMax Muster\t33").rows[0]).toMatchObject({ name: "Max Muster", points: 33, points_hint: null });
});

test("nur Namen in Reihenfolge: kein Platz, die Reihenfolge zählt", () => {
  const result = parseResultPaste("Alpha\n\n  Beta  \r\nGamma Fahrer\n");
  expect(result.errors).toEqual([]);
  expect(pick(result.rows, "line", "place", "name")).toEqual([
    { line: 1, place: null, name: "Alpha" },
    { line: 3, place: null, name: "Beta" },
    { line: 4, place: null, name: "Gamma Fahrer" },
  ]);
});

test("Tab-Tabelle aus Excel mit Kopfzeile: Spalten nach Namen, Zeit wird übergangen", () => {
  const text = "Pos\tNr\tFahrer\tTeam\tZeit\tPunkte\n1\t44\tAlpha\tProbe Racing\t1:23.456\t25\n2\t7\tBeta\tTest GP\t+1,2\t18\n3\t9\tGamma\tTest GP\tDNF\t";
  const result = parseResultPaste(text);
  expect(result.format).toBe("tab");
  expect(result.header).toBe(true);
  expect(result.errors).toEqual([]);
  expect(pick(result.rows, "place", "start_number", "name", "team", "points", "marks")).toEqual([
    { place: 1, start_number: "44", name: "Alpha", team: "Probe Racing", points: 25, marks: [] },
    { place: 2, start_number: "7", name: "Beta", team: "Test GP", points: 18, marks: [] },
    { place: 3, start_number: "9", name: "Gamma", team: "Test GP", points: null, marks: ["dnf"] },
  ]);
});

test("Tab-Tabelle ohne Kopfzeile: Platz, Startnummer, Name, Team, Abstand, Punkte", () => {
  const result = parseResultPaste("1\t44\tAlpha\tProbe Racing\t+0,0\t25\n2\t7\tBeta\tTest GP\t1:02.300\t18");
  expect(result.header).toBe(false);
  expect(pick(result.rows, "place", "start_number", "name", "team", "points")).toEqual([
    { place: 1, start_number: "44", name: "Alpha", team: "Probe Racing", points: 25 },
    { place: 2, start_number: "7", name: "Beta", team: "Test GP", points: 18 },
  ]);
});

test("„1 | Name | Team | 25“ und Markdown-Tabelle mit Trennlinie", () => {
  const plain = parseResultPaste("1 | Alpha | Probe Racing | 25\n2 | Beta | Test GP | 18 | FL");
  expect(plain.format).toBe("pipe");
  expect(pick(plain.rows, "place", "name", "team", "points", "marks")).toEqual([
    { place: 1, name: "Alpha", team: "Probe Racing", points: 25, marks: [] },
    { place: 2, name: "Beta", team: "Test GP", points: 18, marks: ["fastest_lap"] },
  ]);
  const markdown = parseResultPaste("| Platz | Name | Punkte |\n|---|:---|---:|\n| 1 | Alpha | 25 |\n| 2 | Beta | 18 |");
  expect(markdown.header).toBe(true);
  expect(markdown.errors).toEqual([]);
  expect(pick(markdown.rows, "place", "name", "points")).toEqual([{ place: 1, name: "Alpha", points: 25 }, { place: 2, name: "Beta", points: 18 }]);
});

test("„Name;Platz“ und „Name;Platz;Punkte“", () => {
  const result = parseResultPaste("Alpha;2\nBeta;1;25\nGamma;3;15;DSQ");
  expect(result.format).toBe("semicolon");
  expect(pick(result.rows, "place", "name", "points", "marks")).toEqual([
    { place: 2, name: "Alpha", points: null, marks: [] },
    { place: 1, name: "Beta", points: 25, marks: [] },
    { place: 3, name: "Gamma", points: 15, marks: ["dsq"] },
  ]);
});

test("kaputte Zeilen: Fehler mit Zeilennummer, der Rest wird gelesen", () => {
  const result = parseResultPaste("1. Alpha  25\n2.\n3 18\n4. Delta");
  expect(pick(result.rows, "line", "name")).toEqual([{ line: 1, name: "Alpha" }, { line: 4, name: "Delta" }]);
  expect(result.errors).toEqual([
    { line: 2, text: "2.", message: "Kein Name erkannt." },
    { line: 3, text: "3 18", message: "Kein Name erkannt." },
  ]);
});

test("leer und unbekanntes Format: klare Rückmeldung statt stiller Leere", () => {
  expect(parseResultPaste("")).toEqual({ format: null, header: false, rows: [], errors: [] });
  expect(parseResultPaste("   \n\n").rows).toEqual([]);
  const unknown = parseResultPaste("1\n2\n3");
  expect(unknown.rows).toEqual([]);
  expect(unknown.errors[0]).toMatchObject({ line: null, message: expect.stringContaining("Format nicht erkannt") });
});

test("zu langer Name und zu viele Zeilen werden gemeldet", () => {
  const long = parseResultPaste(`1. ${"x".repeat(130)}`);
  expect(long.rows).toEqual([]);
  expect(long.errors[0].message).toContain("Name zu lang");
  const many = parseResultPaste(Array.from({ length: 12 }, (_, index) => `${index + 1}. Fahrer${index}`).join("\n"), { maxRows: 10 });
  expect(many.rows).toHaveLength(10);
  expect(many.errors).toEqual([{ line: 11, text: "", message: "Höchstens 10 Zeilen – ab hier wurde nichts übernommen." }]);
});

test("sehr lange Eingabe bleibt schnell (kein langsamer regulärer Ausdruck)", () => {
  const spaces = " ".repeat(50_000);
  const hostile = `1.${spaces}Alpha${spaces}25${spaces}\t\t${";".repeat(20_000)}`;
  const started = performance.now();
  parseResultPaste(hostile);
  parseResultPaste(Array.from({ length: 500 }, (_, index) => `${index + 1}\tFahrer ${index}\tTeam\t${index}`).join("\n"));
  parseTablePaste(hostile);
  expect(performance.now() - started).toBeLessThan(1000);
  const huge = parseResultPaste("a".repeat(250_000));
  expect(huge.errors[0].message).toContain("zu lang");
});

test("Tabelle laut Veranstalter: Zeilen, Kopfzeile, Maps-Stand und kaputte Zeilen", () => {
  const lines = parseTablePaste("1. Probe Lions 10 7 1 2 22\n2. Test Eagles 10 6 0 4 18\n3. Muster Clan 10 25");
  expect(lines.errors).toEqual([]);
  expect(pick(lines.rows, "rank", "team", "played", "won", "drawn", "lost", "points")).toEqual([
    { rank: 1, team: "Probe Lions", played: 10, won: 7, drawn: 1, lost: 2, points: 22 },
    { rank: 2, team: "Test Eagles", played: 10, won: 6, drawn: 0, lost: 4, points: 18 },
    { rank: 3, team: "Muster Clan", played: 10, won: null, drawn: null, lost: null, points: 25 },
  ]);
  const header = parseTablePaste("Pl\tTeam\tSp\tS\tN\tMaps\tPkt\n1\tProbe Lions\t8\t6\t2\t14:5\t18\nx\t\t\t\t\t\t");
  expect(header.header).toBe(true);
  expect(pick(header.rows, "rank", "team", "played", "won", "lost", "score_for", "score_against", "points")).toEqual([
    { rank: 1, team: "Probe Lions", played: 8, won: 6, lost: 2, score_for: 14, score_against: 5, points: 18 },
  ]);
  expect(header.errors).toEqual([{ line: 3, text: "x", message: "Kein Team erkannt." }]);
  expect(parseTablePaste("1\n2").errors[0].message).toContain("Format nicht erkannt");
});
