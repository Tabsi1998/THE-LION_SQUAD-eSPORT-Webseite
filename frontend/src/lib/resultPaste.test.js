import { cleanText, lapSeconds, parseMark, parseNumber, parsePlace, parseResultPaste, parseTablePaste } from "@/lib/resultPaste";

// Ergebnisliste einfügen (#1744): der einzige Text-Parser für Ergebnisse externer Serien. Nur erfundene Namen.

// ---------------------------------------------------------------- Rennergebnis (#1927)
test("Rundenzeiten lassen sich vergleichen: 1:31.456, 1:31,456, 91.456, 1:02:03.5", () => {
  expect(lapSeconds("1:31.456")).toBeCloseTo(91.456, 3);
  expect(lapSeconds("1:31,456")).toBeCloseTo(91.456, 3);
  expect(lapSeconds("91.456")).toBeCloseTo(91.456, 3);
  expect(lapSeconds("1:02:03.5")).toBeCloseTo(3723.5, 3);
  expect(lapSeconds("DNF")).toBeNull();
  expect(lapSeconds("")).toBeNull();
});

test("Tab-Tabelle mit Startnummer, Startplatz, Zeit, Abstand und bester Runde: alles erkannt, schnellste Runde aus der Spalte", () => {
  const text = [
    "Pos\tNr\tFahrer\tTeam\tStart\tZeit\tAbstand\tBeste Runde\tPunkte",
    "1\t7\tAlpha\tProbe Löwen\t3\t1:32:45.123\t\t1:31.902\t35",
    "2\t12\tBeta\tProbe DarkFriday\t1\t\t+5.204\t1:31.456\t30",
    "3\t88\tGamma\tFremd Rot\t5\t\t+1 Runde\t1:32.010\t26",
    "4\t21\tDelta\tFremd Rot\t2\tDNF\t\t1:33.100\t",
  ].join("\n");
  const result = parseResultPaste(text);
  expect(result.errors).toEqual([]);
  expect(result.header).toBe(true);
  expect(pick(result.rows, "place", "start_number", "name", "team", "grid", "time", "gap", "marks", "points")).toEqual([
    { place: 1, start_number: "7", name: "Alpha", team: "Probe Löwen", grid: 3, time: "1:32:45.123", gap: "", marks: [], points: 35 },
    { place: 2, start_number: "12", name: "Beta", team: "Probe DarkFriday", grid: 1, time: "", gap: "+5.204", marks: [], points: 30 },
    { place: 3, start_number: "88", name: "Gamma", team: "Fremd Rot", grid: 5, time: "", gap: "+1 Runde", marks: [], points: 26 },
    { place: 4, start_number: "21", name: "Delta", team: "Fremd Rot", grid: 2, time: "", gap: "", marks: ["dnf"], points: null },
  ]);
  expect(result.fastest_lap).toEqual({ name: "Beta", time: "1:31.456" });
});

test("„|“- und „;“-Tabellen mit englischen Spaltennamen (Grid, Time, Gap)", () => {
  const pipe = parseResultPaste("| # | Driver | Grid | Time | Gap |\n|---|---|---|---|---|\n| 1 | Alpha | 2 | 58:01.3 | |\n| 2 | Beta | 1 | | +0.8 |");
  expect(pick(pipe.rows, "place", "name", "grid", "time", "gap")).toEqual([
    { place: 1, name: "Alpha", grid: 2, time: "58:01.3", gap: "" },
    { place: 2, name: "Beta", grid: 1, time: "", gap: "+0.8" },
  ]);
  const semicolon = parseResultPaste("Platz;Name;Startplatz;Rückstand\n1;Alpha;4;\n2;Beta;3;+2,5");
  expect(pick(semicolon.rows, "place", "name", "grid", "gap")).toEqual([
    { place: 1, name: "Alpha", grid: 4, gap: "" },
    { place: 2, name: "Beta", grid: 3, gap: "+2,5" },
  ]);
});

test("ohne Kopfzeile: Zeit und Abstand aus den Zellen, Punkte bleiben die letzte Zahl", () => {
  const result = parseResultPaste("1\t44\tAlpha\tProbe Racing\t1:32:45.1\t25\n2\t7\tBeta\tTest GP\t+1,2\t18");
  expect(pick(result.rows, "place", "start_number", "name", "time", "gap", "points")).toEqual([
    { place: 1, start_number: "44", name: "Alpha", time: "1:32:45.1", gap: "", points: 25 },
    { place: 2, start_number: "7", name: "Beta", time: "", gap: "+1,2", points: 18 },
  ]);
});

test("Zeilen „Schnellste Runde: …“ und „Fahrer des Tages: …“ gehören zum Rennen, nicht in die Liste", () => {
  const result = parseResultPaste("1. Alpha  35\n2. Beta  30\n3. Gamma  26\nSchnellste Runde: Beta 1:31.456\nFahrer des Tages: Gamma");
  expect(result.errors).toEqual([]);
  expect(result.rows.map((row) => row.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  expect(result.fastest_lap).toEqual({ name: "Beta", time: "1:31.456" });
  expect(result.driver_of_the_day).toEqual({ name: "Gamma" });
  // Englisch und in einer Tabelle; eine Zeile ohne Zeit nennt nur den Fahrer.
  const english = parseResultPaste("1\tAlpha\t25\nFastest lap:\tAlpha\nDriver of the day:\tAlpha");
  expect(english.rows).toHaveLength(1);
  expect(english.fastest_lap).toEqual({ name: "Alpha", time: "" });
  expect(english.driver_of_the_day).toEqual({ name: "Alpha" });
  // Ohne diese Angaben bleibt das Ergebnis wie bisher.
  expect(parseResultPaste("1. Alpha  25")).not.toHaveProperty("fastest_lap");
});

const pick = (rows, ...keys) => rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])));

test("„OUT“ und „DNF/OUT“ sind ein Ausfall, „--:--.---“ ist keine Zeit – in jeder Spalte und im Zeilenformat", () => {
  expect(parseMark("OUT")).toBe("dnf");
  expect(parseMark("DNF/OUT")).toBe("dnf");
  expect(parseMark("out / dnf")).toBe("dnf");
  const table = parseResultPaste([
    "Pos\tFahrer\tZeit\tAbstand\tPunkte",
    "1\tAlpha\t1:32:45.123\t\t35",
    "2\tBeta\tOUT\t\t0",
    "3\tGamma\t--:--.---\tDNF/OUT\t0",
    "4\tDelta\t--:--.---\t--.---\t",
  ].join("\n"));
  expect(table.errors).toEqual([]);
  expect(pick(table.rows, "name", "time", "gap", "marks")).toEqual([
    { name: "Alpha", time: "1:32:45.123", gap: "", marks: [] },
    { name: "Beta", time: "", gap: "", marks: ["dnf"] },
    { name: "Gamma", time: "", gap: "", marks: ["dnf"] },
    { name: "Delta", time: "", gap: "", marks: [] },
  ]);
  const lines = parseResultPaste("18. Probe Fahrer OUT\n19. Probe Zwei DNF/OUT");
  expect(pick(lines.rows, "name", "marks", "time")).toEqual([
    { name: "Probe Fahrer", marks: ["dnf"], time: "" },
    { name: "Probe Zwei", marks: ["dnf"], time: "" },
  ]);
  // Ohne Kopfzeile: der Platzhalter ist weder Zeit noch Name, die Punkte bleiben die letzte Zahl.
  const bare = parseResultPaste("20\tProbe Drei\tTeam\t--:--.---\t0\n21\tProbe Vier\tTeam\tOUT\t0");
  expect(pick(bare.rows, "name", "team", "marks", "time", "points")).toEqual([
    { name: "Probe Drei", team: "Team", marks: [], time: "", points: 0 },
    { name: "Probe Vier", team: "Team", marks: ["dnf"], time: "", points: 0 },
  ]);
});

test("Bausteine: Leerraum, Zahlen, Plätze und Marken", () => {
  expect(cleanText("  Probe\u00a0 Fahrer\t ")).toBe("Probe Fahrer");
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
  expect(parseResultPaste("")).toEqual({ format: null, header: false, team_column: false, rows: [], errors: [] });
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

test("Unicode: jede Art Leerraum zählt gleich, unsichtbare Zeichen fallen weg, Namen in NFC", () => {
  // Geschütztes (U+00A0) und schmales geschütztes Leerzeichen (U+202F), Viertelgeviert (U+2005), Tab, BOM, U+200B.
  const text = "\ufeff1.\u00a0Alpha\u202fFahrer\u00a0\u00a025\n2.\u2005Be\u200bta \u00a018 Pkt\n3. Jose\u0301 Probe";
  const result = parseResultPaste(text);
  expect(result.errors).toEqual([]);
  expect(pick(result.rows, "place", "name", "points")).toEqual([
    { place: 1, name: "Alpha Fahrer", points: 25 },
    { place: 2, name: "Beta", points: 18 },
    { place: 3, name: "Jos\u00e9 Probe", points: null },
  ]);
  expect(parseResultPaste("1\t\u00a0Alpha\u202f\t25").rows[0]).toMatchObject({ name: "Alpha", points: 25 });
  expect(cleanText("\u2003Probe\u3000Name\u2028")).toBe("Probe Name");
  expect(cleanText("Cafe\u0301")).toBe("Caf\u00e9");
});
