import { racingTableRows, seasonTabs, type SeasonPage } from "./referenceSeason";
import { bonusRulesLabel, dayLines, dayRounds, dayRoundsLabel, dayTable, isDoubleUp, lobbies, roundPlace } from "./seriesDays";

// Turniertage einer Turnierserie in der App (#1961, #1974) - dieselben Regeln wie im Web (frontend/src/lib/seriesDays.js,
// referenceSeriesTable.js). Namen kommen vom Server schon ohne Tag. Nur erfundene Namen.

const PAGE: SeasonPage = {
  lineage: { kind: "series" },
  rules: {
    day_rounds: { count: 3, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] },
    custom_bonuses: [{ key: "bingo", label: "Bingo", points: 3 }],
    tiebreak_top_n: 4,
  },
  rounds: [
    { id: "t1", code: "T1", club_day: "2026-10-01", state: "scored", kind: "regular", counts: true },
    { id: "t2", code: "T2", club_day: "2026-10-08", state: "scored", kind: "regular", counts: true },
    { id: "f", code: "Finale", state: "planned", kind: "final", counts: true },
  ],
  standings: { rows: [
    { key: "hugo", name: "Hugo Probe", club_member: false, rank: 1, points: 49, bonus_points: 3, results: [
      { round_id: "t1", place: 1, points: 35, day_rounds: [{ points: 8, lobby: "A" }, { points: 7, place: 2, lobby: "B" }, null], day_points: 15, bonus: 3, bonus_keys: ["bingo"] },
      { round_id: "t2", place: 4, points: 14, dropped: true, day_points: 9, day_rounds: [{ points: 5 }, { points: 4 }], marks: ["left"] },
    ] },
    { key: "mira", name: "Mira Stahl", club_member: true, rank: 2, points: 30, bonus_points: 0, results: [
      { round_id: "t1", place: 2, points: 30, day_rounds: [{ points: 7, lobby: "A" }, { points: 8, place: 1, lobby: "B" }, { points: 6 }], day_points: 21,
        partner: { name: "Gina Gedacht", club_member: false } },
    ] },
  ] },
};

test("Turniertage: nur mit Tagesdaten, ohne Finale - als eigener Reiter", () => {
  expect(dayRounds(PAGE).map((round) => round.id)).toEqual(["t1", "t2"]);
  expect(seasonTabs(PAGE).map((tab) => tab.label)).toEqual(["Termine", "Tabelle", "Turniertage"]);
  // Älterer Server ohne Tagesdaten: kein Reiter.
  expect(seasonTabs({ ...PAGE, standings: { rows: [{ key: "x", results: [{ round_id: "t1", place: 1, points: 35 }] }] } }).map((tab) => tab.label)).toEqual(["Termine", "Tabelle"]);
});

test("ein Turniertag: R1…Rn mit Platz-Farbe, GES P, Saisonpunkte, Double Up, Boni und „Ausgestiegen“", () => {
  const lines = dayLines(PAGE, "t1");
  expect(lines.map((line) => [line.place, line.name, line.partner, line.badges, line.total, line.points])).toEqual([
    ["1", "Hugo Probe", "", ["Bingo +3"], "15", "35"],
    ["2", "Mira Stahl", "mit Gina Gedacht", [], "21", "30"],
  ]);
  // Ohne Double Up: der Platz aus dem eindeutigen Schema; ein nicht gespielter Durchgang als Strich.
  expect(lines[0].cells.map((cell) => [cell.text, cell.tone])).toEqual([["8", "gold"], ["7", "silver"], ["–", null]]);
  expect(lines[0].cells[2].label).toBe("R3: nicht gespielt");
  // Bei Double Up zählt nur ein eingetragener Platz.
  expect(lines[1].cells.map((cell) => cell.tone)).toEqual([null, "gold", null]);
  const t2 = dayLines(PAGE, "t2")[0];
  expect([t2.badges, t2.dropped]).toEqual([["Ausgestiegen"], true]);
  expect(isDoubleUp(dayTable(PAGE.standings?.rows, "t1"))).toBe(true);
});

test("Lobbys je Runde: nach Platz, dann Punkten; Regeln in Worten", () => {
  const table = dayTable(PAGE.standings?.rows, "t1");
  expect(lobbies(table, 1, [8, 7, 6])?.map((group) => [group.lobby, group.members.map((member) => [member.item.name, member.place])])).toEqual([
    ["B", [["Mira Stahl", 1], ["Hugo Probe", 2]]],
  ]);
  expect(lobbies(table, 2)).toBeNull();
  expect(roundPlace({ points: 5 }, [8, 7, 6, 5])).toBe(4);
  expect(roundPlace({ points: 0 }, [8, 0])).toBeNull();
  expect(dayRoundsLabel(PAGE.rules)).toBe("3 Runden je Turniertag, Platz 1 bis 8: 8 · 7 · 6 · 5 · 4 · 3 · 2 · 1 – die Summe ergibt den Tagesplatz");
  expect(bonusRulesLabel(PAGE.rules)).toBe("Bingo +3 – zählen zusätzlich, nie gestrichen");
  expect(dayRoundsLabel(null)).toBe("");
});

test("Spalte „Boni“ (#1961): Sonderbonus klein unter den Punkten - nur mit Boni in der Saison", () => {
  expect(racingTableRows(PAGE, "drivers").map((row) => [row.name, row.points, row.bonus])).toEqual([["Hugo Probe", "49", "+3"], ["Mira Stahl", "30", ""]]);
  expect(racingTableRows({ ...PAGE, rules: { custom_bonuses: [] } }, "drivers")[0].bonus).toBe("");
});
