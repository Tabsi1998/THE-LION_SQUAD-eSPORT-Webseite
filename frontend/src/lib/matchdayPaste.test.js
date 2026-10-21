import { parseMatchdayPaste } from "./matchdayPaste";

// Spieltag einfügen (#1931): die Begegnungsliste des Veranstalters (Termin, Heim, Auswärts, Ergebnis). Nur erfundene
// Teamnamen.

const rows = (text, options) => parseMatchdayPaste(text, options).rows.map(({ line: _line, matchday: _day, ...row }) => row);

test("Tabelle mit Kopfzeile: Termin, Heim, Auswärts, Ergebnis", () => {
  const text = [
    "Termin;Heim;Auswärts;Ergebnis",
    "13.05.2026 20:30;Probe Löwen;Probe Falken;2:1",
    "14.05.2026 21:00;Probe Adler;Probe Eulen;0:2",
    "15.05.2026;Probe Wölfe;Probe Bären;-:-",
  ].join("\n");
  expect(rows(text)).toEqual([
    { day: "2026-05-13", time: "20:30", home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1 },
    { day: "2026-05-14", time: "21:00", home: "Probe Adler", away: "Probe Eulen", home_score: 0, away_score: 2 },
    { day: "2026-05-15", time: "", home: "Probe Wölfe", away: "Probe Bären", home_score: null, away_score: null },
  ]);
});

test("aus einer Website kopiert: Tab, Datum und Uhrzeit getrennt, Kopf auf Englisch", () => {
  const text = "Date\tTime\tHome\tAway\tScore\nMi., 13.05.\t20:30\tProbe Löwen\tProbe Falken\t2 : 1";
  expect(rows(text, { year: 2026 })).toEqual([
    { day: "2026-05-13", time: "20:30", home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1 },
  ]);
});

test("ohne Kopfzeile: Zeit vor den Teams, Ergebnis danach oder dazwischen", () => {
  expect(rows("13.05. | 20:30 | Probe Löwen | Probe Falken | 13:11", { year: 2026 })).toEqual([
    { day: "2026-05-13", time: "20:30", home: "Probe Löwen", away: "Probe Falken", home_score: 13, away_score: 11 },
  ]);
  expect(rows("Probe Adler | 2:0 | Probe Eulen")).toEqual([
    { day: "", time: "", home: "Probe Adler", away: "Probe Eulen", home_score: 2, away_score: 0 },
  ]);
});

test("Zeilen ohne Trenner: „Heim 2:1 Gast“, „Heim vs Gast 2:1“, „Heim - Gast“", () => {
  const text = "13.05. 20:30 Probe Löwen 2:1 Probe Falken\nProbe Adler vs Probe Eulen 0:2\nProbe Wölfe – Probe Bären";
  expect(rows(text, { year: 2026 })).toEqual([
    { day: "2026-05-13", time: "20:30", home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1 },
    { day: "", time: "", home: "Probe Adler", away: "Probe Eulen", home_score: 0, away_score: 2 },
    { day: "", time: "", home: "Probe Wölfe", away: "Probe Bären", home_score: null, away_score: null },
  ]);
});

test("ohne Jahr gilt das Jahr des Termins", () => {
  expect(rows("29.12. 20:00;Probe Löwen;Probe Falken;1:1", { year: 2026 })[0].day).toBe("2026-12-29");
  expect(rows("29.12. 20:00;Probe Löwen;Probe Falken;1:1")[0].day).toBe("");
});

test("was sich nicht lesen lässt, kommt mit Zeilennummer zurück", () => {
  const result = parseMatchdayPaste("Termin;Heim;Auswärts;Ergebnis\n13.05.;Probe Löwen;;2:1\n31.02.;Probe Adler;Probe Eulen;1:0\nnur Text");
  expect(result.rows).toEqual([]);
  expect(result.errors.map((error) => [error.line, error.message])).toEqual([
    [2, "Heim- oder Auswärtsteam fehlt."],
    [3, "Datum 31.02. gibt es nicht."],
    [4, "Heim- oder Auswärtsteam fehlt."],
  ]);
});

test("aus der Ansicht „Alle“ kopiert: Link-Spalte „Zum Matchup“ und leere Logo-Spalten fallen weg, „Uhr“ gehört zum Termin", () => {
  const text = [
    "Termin\tHeim\t\tAuswärts\t\tErgebnis\tLink",
    "17.06.2026 20:30 Uhr\tProbe Löwen\t\tProbe Falken\t\t2:1\tZum Matchup",
    "18.06.2026 21:00 Uhr\tProbe Adler\t\tProbe Eulen\t\t-:-\t",
  ].join("\n");
  expect(rows(text)).toEqual([
    { day: "2026-06-17", time: "20:30", home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1 },
    { day: "2026-06-18", time: "21:00", home: "Probe Adler", away: "Probe Eulen", home_score: null, away_score: null },
  ]);
  // Logo-Spalten nur in den Zeilen (im Kopf mit dem Team zusammengefasst).
  expect(rows("Termin\tHeim\tAuswärts\tErgebnis\tLink\n17.06.2026 20:30 Uhr\t\tProbe Löwen\t\tProbe Falken\t2:1\tZum Matchup")).toEqual([
    { day: "2026-06-17", time: "20:30", home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1 },
  ]);
  // Ohne Kopfzeile: „Zum Matchup“ ist kein Team.
  expect(rows("17.06.2026 20:30 Uhr\tProbe Löwen\tProbe Falken\t2:1\tZum Matchup")).toEqual([
    { day: "2026-06-17", time: "20:30", home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1 },
  ]);
});

test("mehrere Spieltage hintereinander: Zwischenüberschriften trennen sie, der Zeitraum gehört dazu", () => {
  const text = [
    "Begegnungen des 1. Spieltags",
    "Zeitraum: 10.06.2026 - 14.06.2026",
    "Termin\tHeim\tAuswärts\tErgebnis\tLink",
    "10.06.2026 20:30 Uhr\tProbe Löwen\tProbe Falken\t2:1\tZum Matchup",
    "11.06.2026 20:30 Uhr\tProbe Adler\tProbe Eulen\t0:2\tZum Matchup",
    "Begegnungen des 2. Spieltags",
    "Zeitraum: 17.06.2026 - 21.06.2026",
    "Termin\tHeim\tAuswärts\tErgebnis\tLink",
    "17.06.2026 20:30 Uhr\tProbe Eulen\tProbe Löwen\t\t",
  ].join("\n");
  const result = parseMatchdayPaste(text);
  expect(result.errors).toEqual([]);
  expect(result.matchdays.map((day) => [day.number, day.from, day.to, day.rows.length])).toEqual([
    [1, "2026-06-10", "2026-06-14", 2],
    [2, "2026-06-17", "2026-06-21", 1],
  ]);
  expect(result.rows.map((row) => row.matchday)).toEqual([1, 1, 2]);
});

test("ohne Zwischenüberschrift ist alles ein Spieltag ohne Nummer", () => {
  const result = parseMatchdayPaste("Probe Löwen;Probe Falken;2:1");
  expect(result.matchdays.map((day) => [day.number, day.rows.length])).toEqual([[null, 1]]);
});

test("viele Leerzeichen bleiben schnell", () => {
  const started = Date.now();
  const text = `Probe Löwen${" ".repeat(50000)}2:1${" ".repeat(50000)}Probe Falken`;
  expect(rows(text)).toEqual([{ day: "", time: "", home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 1 }]);
  expect(Date.now() - started).toBeLessThan(1000);
});
