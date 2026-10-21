import { parseTablePaste } from "@/lib/resultPaste";

// Tabelle laut Veranstalter (#1931): aus einer HTML-Tabelle im Browser kopiert - mit Kopfzeile wie bei der DeSBL und
// einer leeren Logo-Spalte. Nur erfundene Teamnamen.

const PICK = ["rank", "team", "played", "won", "drawn", "lost", "score_for", "score_against", "points"];
const pick = (rows) => rows.map((row) => Object.fromEntries(PICK.map((key) => [key, row[key]])));

test("Kopfzeile Platz;Team;Spiele;Siege;Unentschieden;Niederlagen;Ergebnis;Punkte", () => {
  const text = "Platz;Team;Spiele;Siege;Unentschieden;Niederlagen;Ergebnis;Punkte\n1;Probe Falken;7;6;0;1;20:6;18\n2;Probe Löwen;7;5;1;1;17:9;16";
  const result = parseTablePaste(text);
  expect(result.errors).toEqual([]);
  expect(pick(result.rows)).toEqual([
    { rank: 1, team: "Probe Falken", played: 7, won: 6, drawn: 0, lost: 1, score_for: 20, score_against: 6, points: 18 },
    { rank: 2, team: "Probe Löwen", played: 7, won: 5, drawn: 1, lost: 1, score_for: 17, score_against: 9, points: 16 },
  ]);
});

test("aus dem Browser kopiert: Tabs und eine leere Logo-Spalte vor dem Team", () => {
  const text = [
    "Platz\t\tTeam\tSpiele\tSiege\tUnentschieden\tNiederlagen\tErgebnis\tPunkte",
    "1\t\tProbe Falken\t7\t6\t0\t1\t20:6\t18",
    "2\t \tProbe Löwen\t7\t5\t1\t1\t17:9\t16",
  ].join("\n");
  const result = parseTablePaste(text);
  expect(result.errors).toEqual([]);
  expect(result.header).toBe(true);
  expect(pick(result.rows)).toEqual([
    { rank: 1, team: "Probe Falken", played: 7, won: 6, drawn: 0, lost: 1, score_for: 20, score_against: 6, points: 18 },
    { rank: 2, team: "Probe Löwen", played: 7, won: 5, drawn: 1, lost: 1, score_for: 17, score_against: 9, points: 16 },
  ]);
});

test("Logo-Spalte nur in den Zeilen, nicht in der Kopfzeile: der Text bleibt das Team", () => {
  const text = "Platz\tTeam\tSpiele\tSiege\tUnentschieden\tNiederlagen\tErgebnis\tPunkte\n1\t\tProbe Falken\t7\t6\t0\t1\t20:6\t18";
  const result = parseTablePaste(text);
  expect(result.errors).toEqual([]);
  expect(result.rows.map((row) => [row.rank, row.team, row.points])).toEqual([[1, "Probe Falken", 18]]);
});
