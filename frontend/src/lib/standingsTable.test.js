import fixture from "../../e2e/fixtures/tableScheduleGenerated.json";
import { formLabel, formatDiff, rankMove, standingSections, tableKind } from "./standingsTable";

// Tabellen (#1562, #1179): die Daten kommen aus scripts/make_table_schedule_fixture.py - echte Liga, echte Gruppen.

test("eine Liga ist eine Tabelle ohne Überschrift", () => {
  const sections = standingSections(fixture.league.standings);
  expect(sections).toHaveLength(1);
  expect(sections[0].label).toBe("");
  expect(sections[0].rows).toHaveLength(6);
  expect(tableKind(sections[0].rows)).toBe("league");
});

test("Gruppen werden je Gruppe eine Tabelle - mit Namen und der eigenen Gruppe", () => {
  const sections = standingSections(fixture.groups.standings);
  expect(sections.map((section) => section.label)).toEqual(["Gruppe A", "Gruppe B"]);
  expect(sections.every((section) => section.rows.length === 4)).toBe(true);
  expect(sections.filter((section) => section.mine).length).toBe(1);
  expect(sections.find((section) => section.mine).rows.some((row) => row.is_mine)).toBe(true);
  expect(sections.every((section) => tableKind(section.rows) === "league")).toBe(true);
});

test("64 Teilnehmer in acht Gruppen bleiben acht Tabellen mit eindeutigen Schlüsseln", () => {
  const sections = standingSections(fixture.groups64.standings);
  expect(sections).toHaveLength(8);
  expect(new Set(sections.map((section) => section.key)).size).toBe(8);
  expect(sections.flatMap((section) => section.rows)).toHaveLength(64);
});

test("ein K.-o.-Turnier hat seine eigene, schmale Tabelle", () => {
  expect(tableKind(fixture.finished.standings)).toBe("knockout");
  expect(tableKind([])).toBe("knockout");
});

test("Pfeile: hinauf, hinunter, gleich - und keiner ohne vorigen Spieltag", () => {
  for (const row of fixture.league.standings) {
    const move = rankMove(row);
    const before = fixture.league.standings_after_first.find((old) => old.registration_id === row.registration_id);
    const by = before.rank - row.rank;
    expect(move).toEqual(by > 0 ? { direction: "up", by } : by < 0 ? { direction: "down", by: -by } : { direction: "same", by: 0 });
  }
  expect(fixture.league.standings_after_first.map(rankMove)).toEqual(fixture.league.standings_after_first.map(() => null));
});

test("Differenz mit Vorzeichen und echtem Minus, Form in Worten", () => {
  expect(formatDiff(3)).toBe("+3");
  expect(formatDiff(0)).toBe("0");
  expect(formatDiff(-2)).toBe("−2");
  expect(formatDiff(undefined)).toBe("0");
  expect(formLabel(["W", "D", "L"])).toBe("Form: Sieg, Unentschieden, Niederlage");
  expect(formLabel([])).toBe("Noch keine Spiele");
});
