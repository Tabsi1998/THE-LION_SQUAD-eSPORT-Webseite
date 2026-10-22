import { isSeasonCell, parseSeasonTablePaste } from "@/lib/resultPaste";

// Saisontabelle einfügen (#1928): Tabelle des Veranstalters mit Platz, Fahrer, Team, je Runde Punkten und Gesamt –
// Zellen bleiben Text, nur die Spalten bekommen eine Art. Nur erfundene Namen.

const kinds = (result) => result.columns.map((column) => column.kind);
const labels = (result) => result.columns.map((column) => column.label);

test("Tab-Tabelle mit Kopf: Platz, Fahrer, Team, Runden (Kürzel und Flaggen), Gesamt und Abstand", () => {
  const text = [
    "Pos\tFahrer\tTeam\tR1\t\u{1F1E6}\u{1F1F9}\tSpa\tGesamt\tDif.",
    "1\tAda Ausgedacht#AAA\tProbe Rot\t25\tOUT\t18\t43\t",
    "2\tBruno Beispiel\t\t--\t25\t\t25\t-18",
    "3\tCleo Muster\tProbe Blau\t18\t18\tDSQ\t36",
  ].join("\n");
  const result = parseSeasonTablePaste(text);
  expect(result.errors).toEqual([]);
  expect(result.header).toBe(true);
  expect(kinds(result)).toEqual(["rank", "name", "team", "round", "round", "round", "total", "ignore"]);
  expect(labels(result).slice(3, 6)).toEqual(["R1", "\u{1F1E6}\u{1F1F9}", "Spa"]);
  expect(result.rows.map((row) => row.cells)).toEqual([
    ["1", "Ada Ausgedacht#AAA", "Probe Rot", "25", "OUT", "18", "43", ""],
    ["2", "Bruno Beispiel", "", "--", "25", "", "25", "-18"],
    ["3", "Cleo Muster", "Probe Blau", "18", "18", "DSQ", "36", ""],
  ]);
});

test("ohne Kopf: erste Spalte Platz, Text Name und Team, Zahlen Runden, die letzte Summe ist Gesamt", () => {
  const text = "1.|Ada Ausgedacht|Probe Rot|25|18|43\n2.|Bruno Beispiel|Probe Blau|18|--|18\n3.|Cleo Muster|Probe Blau|OUT|25|25";
  const result = parseSeasonTablePaste(text);
  expect(result.errors).toEqual([]);
  expect(result.header).toBe(false);
  expect(kinds(result)).toEqual(["rank", "name", "team", "round", "round", "total"]);
  expect(labels(result)).toEqual(["Spalte 1", "Spalte 2", "Spalte 3", "1", "2", "Spalte 6"]);
  // Ohne passende Summe bleibt die letzte Zahlenspalte eine Runde.
  expect(kinds(parseSeasonTablePaste("Ada Ausgedacht;25;18;7\nBruno Beispiel;18;25;3"))).toEqual(["name", "round", "round", "round"]);
});

test("Leerzeichen statt Trenner: Platz, Name bis zur ersten Zelle, dann die Zellen – sonst ein Hinweis auf Tab", () => {
  const result = parseSeasonTablePaste("Pos Fahrer R1 R2 Gesamt\n1 Ada Ausgedacht 25 -- 25\n2 Bruno Beispiel 18 OUT 18");
  expect(result.errors).toEqual([]);
  expect(kinds(result)).toEqual(["rank", "name", "round", "round", "total"]);
  expect(result.rows[0].cells).toEqual(["1", "Ada Ausgedacht", "25", "--", "25"]);
  const broken = parseSeasonTablePaste("Pos Fahrer R1 R2 Gesamt\n1 Ada Ausgedacht 25 25");
  expect(broken.errors[0].message).toContain("bitte die Tabelle mit Tab trennen");
});

test("Zellen einer Runde: Zahl, OUT, DNF, DSQ, DNS, -- oder leer", () => {
  for (const cell of ["25", "12,5", "0", "OUT", "dnf", "DSQ", "DNS", "--", "", "–"]) expect(isSeasonCell(cell)).toBe(true);
  for (const cell of ["Ada", "R1", "x7"]) expect(isSeasonCell(cell)).toBe(false);
});

test("Grenzen: höchstens 300 Zeilen, ohne Namensspalte ein Hinweis", () => {
  const many = ["Fahrer\tR1", ...Array.from({ length: 302 }, (_, index) => `Probe ${index}\t1`)].join("\n");
  const result = parseSeasonTablePaste(many);
  expect(result.rows).toHaveLength(300);
  expect(result.errors.some((error) => error.message.includes("Höchstens 300 Zeilen"))).toBe(true);
  expect(parseSeasonTablePaste("R1\tR2\n25\t18").errors[0].message).toContain("Keine Spalte mit Namen");
});
