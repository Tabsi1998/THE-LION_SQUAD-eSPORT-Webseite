import { parseLineupPaste } from "./lineupPaste";

// Aufstellung von der Match-Seite einfügen (#1931): Spalten „Seasonteam-Mitglieder | Warorga“ - wer ein Häkchen hat,
// hat gespielt. Beim Kopieren wird das Häkchen oft zum Bild (leer); dann ist nichts angekreuzt. Nur erfundene Namen.

const pick = (text) => parseLineupPaste(text).rows.map(({ name, played }) => [name, played]);

test("Kopfzeile Seasonteam-Mitglieder und Warorga: Häkchen, x und ja zählen als gespielt", () => {
  const text = "Seasonteam-Mitglieder\tWarorga\nProbe Anna\t✓\nProbe Bert\t\nProbe Cleo\tx\nProbe Dora\tja\nProbe Emil\t-";
  const result = parseLineupPaste(text);
  expect(result.marked).toBe(true);
  expect(pick(text)).toEqual([
    ["Probe Anna", true], ["Probe Bert", null], ["Probe Cleo", true], ["Probe Dora", true], ["Probe Emil", false],
  ]);
});

test("Häkchen als Bild verloren: nur Namen, nichts angekreuzt", () => {
  const result = parseLineupPaste("Seasonteam-Mitglieder\tWarorga\nProbe Anna\t\nProbe Bert\t");
  expect(result.marked).toBe(false);
  expect(result.rows.map((row) => [row.name, row.played])).toEqual([["Probe Anna", null], ["Probe Bert", null]]);
});

test("ohne Kopfzeile und ohne Trenner: Name je Zeile, ein Häkchen am Ende zählt", () => {
  expect(pick("Probe Anna ✔\nProbe Bert\n  \nProbe Cleo | ✅")).toEqual([
    ["Probe Anna", true], ["Probe Bert", null], ["Probe Cleo", true],
  ]);
});

test("Häkchen vor dem Namen und leere Bild-Spalten", () => {
  expect(pick("Warorga\t\tSeasonteam-Mitglieder\n✓\t\tProbe Anna\n\t\tProbe Bert")).toEqual([
    ["Probe Anna", true], ["Probe Bert", null],
  ]);
});

test("eine Zeile ohne Namen wird genannt, doppelte Namen fallen weg", () => {
  const result = parseLineupPaste("Probe Anna\t✓\n✓\nprobe anna\t✓");
  expect(result.rows.map((row) => row.name)).toEqual(["Probe Anna"]);
  expect(result.errors.map((error) => [error.line, error.message])).toEqual([[2, "Kein Name erkannt."]]);
});
