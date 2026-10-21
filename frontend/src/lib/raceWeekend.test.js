import {
  averageGrid, averageGridLabel, chipLabel, groupWeekends, hasSessions, isMainQualifying, nextSessionLabel, poleCount, pointsPreview,
  qualiDuel, qualifyingMode, sessionAbbr, sessionKind, sessionLabel, sessionPointsLines, sessionTables, weekendPayload, weekendState,
  weekendToForm, formatSummary,
} from "./raceWeekend";
import LEAGUES from "./raceWeekendLeagues.json";

test("Ablauf je Runde: ein Format in Worten, Läufe in zeitlicher Reihenfolge", () => {
  expect(formatSummary([{ label: "Qualifying", offset: "0" }, { label: "Hauptrennen", offset: "75" }, { label: "Sprint", offset: "30" }]))
    .toBe("Quali + Sprint + Hauptrennen");
  expect(formatSummary([{ label: " " }])).toBe("Noch kein Lauf");
});

test("Kopf eines Qualifyings: Punkte nur, wenn es zählt; Pole nicht im Shootout", () => {
  expect(qualifyingMode({ session: "Qualifying", counts: false })).toBe("Qualifying · ohne Punkte · Pole von selbst");
  expect(qualifyingMode({ session: "Qualifying", counts: true })).toBe("Qualifying · Punkte nach Schlüssel · Pole von selbst");
  expect(qualifyingMode({ session: "Shootout", counts: false })).toBe("Shootout · ohne Punkte");
  expect([isMainQualifying({ session: "Blitz-Qualifying" }), isMainQualifying({ session: "Sprint-Qualifying" }), isMainQualifying({ session: "Sprint" })])
    .toEqual([true, false, false]);
  expect(sessionAbbr({ session: "Shootout" })).toBe("SO");
});

const lauf = (values) => ({ dnf: "series", fastest_lap: null, ...values });
const F2 = { formats: [
  { from_round: 1, sessions: [
    lauf({ label: "Qualifying", offset: 0, counts: true, points: [2], grid: "manual" }),
    lauf({ label: "Sprint", offset: 30, counts: true, points: [12, 9, 7], grid: "manual", dnf: "place", fastest_lap: 0 }),
    lauf({ label: "Hauptrennen", offset: 75, counts: true, points: "series", grid: "qualifying", fastest_lap: 1 }),
  ] },
  { from_round: 5, sessions: [
    lauf({ label: "Sprint", offset: 0, counts: true, points: [12, 9, 7], grid: "reverse_standings" }),
    lauf({ label: "Hauptrennen", offset: 45, counts: true, points: "none", grid: "reverse_standings", dnf: "none" }),
  ] },
] };

test("Ablauf je Runde: Formular hin und zurück ohne Verlust, leer heißt keine Vorgabe", () => {
  expect(weekendPayload(weekendToForm(F2))).toEqual(F2);
  expect(weekendPayload([])).toBeNull();
  expect(weekendToForm(null)).toEqual([]);
});

test("Vorschau eines Schemas: P1 35 · P2 30 … und keine Punkte", () => {
  expect(pointsPreview([35, 30, 26, 23, 20, 17, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]))
    .toBe("P1 35 · P2 30 · P3 26 · P4 23 · P5 20 · … · P20 1");
  expect(pointsPreview([2])).toBe("P1 2");
  expect(pointsPreview([])).toBe("Keine Punkte");
  expect(pointsPreview([0, 0])).toBe("Keine Punkte");
});

// Die beiden Ligen aus der Veranstalter-App (raceWeekendLeagues.json - der Server rechnet dieselben Fälle nach): aus den
// Punkten je Lauf werden die Gesamtsumme und die Tabellen je Lauf, etwa die eigene Sprint-Tabelle.
describe.each(LEAGUES.leagues)("$name", (league) => {
  const names = Object.fromEntries(LEAGUES.people.map((person) => [person.id, person.name]));
  const places = Object.fromEntries(Object.entries(league.sheets).map(([rid, rows]) => [rid, Object.fromEntries(rows.map(([pid, place]) => [pid, place]))]));
  const rows = LEAGUES.people.map((person) => ({
    key: person.id, name: names[person.id],
    results: Object.entries(league.expected.points).filter(([, points]) => person.id in points)
      .map(([rid, points]) => ({ round_id: rid, points: points[person.id], place: places[rid][person.id], marks: [] })),
  }));

  test("Summen der Gesamtwertung", () => {
    const totals = Object.fromEntries(rows.map((row) => [row.key, row.results.reduce((sum, item) => sum + item.points, 0)]));
    expect(Object.fromEntries(league.expected.totals)).toEqual(totals);
  });

  test("Tabellen je Lauf mit Rang und Summe", () => {
    const tables = sessionTables(rows, league.rounds);
    expect(tables.map((table) => table.kind)).toEqual(Object.keys(league.expected.tables));
    for (const table of tables) {
      expect(table.rows.map((row) => [row.key, row.points])).toEqual(league.expected.tables[table.kind]);
      expect(table.rounds.every((round) => round.counts !== false)).toBe(true);
    }
    expect(tables.map((table) => table.label)).toEqual(["Rennen", "Sprint", "Quali"].slice(0, tables.length));
  });
});

test("Tabellen je Lauf erst ab zwei Arten; gleiche Punkte und Plätze teilen den Rang", () => {
  const rounds = [{ id: "r1", session: "Rennen", counts: true }, { id: "s1", session: "Sprint", counts: true }];
  const rows = [
    { key: "a", name: "Probe A", results: [{ round_id: "s1", points: 9, place: 2 }] },
    { key: "b", name: "Probe B", results: [{ round_id: "s1", points: 9, place: 2 }] },
    { key: "c", name: "Probe C", results: [{ round_id: "r1", points: 25, place: 1 }] },
  ];
  const sprint = sessionTables(rows, rounds).find((table) => table.kind === "sprint");
  expect(sprint.rows.map((row) => [row.key, row.rank, row.points])).toEqual([["a", 1, 9], ["b", 1, 9]]);
  expect(sessionTables(rows, [rounds[0]])).toEqual([]);
});

test("Punkte je Lauf in Worten - ab Runde X nur, was sich ändert", () => {
  expect(sessionPointsLines(F2)).toEqual(["Qualifying: 2", "Sprint: 12 · 9 · 7", "ab Runde 5 Hauptrennen: keine Punkte"]);
  expect(sessionPointsLines(null)).toEqual([]);
});

// Runde mit Läufen (#1930): eine Runde mit Läufen - gruppieren, beschriften, zählen. Nur erfundene Namen und Orte.

const WEEKEND = [
  { id: "q1", code: "R1", session: "Qualifying", session_kind: "qualifying", weekend: 1, state: "scored", counts: false, venue: "Probering", country_code: "AT" },
  { id: "s1", code: "R1", session: "Sprint", session_kind: "sprint", weekend: 1, state: "scored", counts: true },
  { id: "r1", code: "R1", session: "Rennen", session_kind: "race", weekend: 1, state: "missing", counts: true },
  { id: "r2", code: "R2", session: null, weekend: 2, state: "planned", counts: true, venue: "Testkurs" },
];

test("die Art eines Laufs kommt aus dem Namen - wie im Server", () => {
  expect(["Qualifying", "Blitz-Qualifying", "Q", "Sprint-Shootout", "Sprint", "Rennen", "Lauf 2", ""].map(sessionKind))
    .toEqual(["qualifying", "qualifying", "qualifying", "qualifying", "sprint", "race", "race", "race"]);
});

test("Chips und Kurzformen: Quali, Sprint, Rennen - ohne Lauf ein Rennen", () => {
  expect(WEEKEND.map(chipLabel)).toEqual(["Quali", "Sprint", "Rennen", "Rennen"]);
  expect(chipLabel({ session: "Blitz-Qualifying" })).toBe("Blitz-Quali");
  expect(["Qualifying", "Sprint", "Rennen", "Hauptrennen", "Lauf 2", "Blitz-Qualifying", "Endlauf"].map((session) => sessionAbbr({ session })))
    .toEqual(["Q", "S", "R", "HR", "L2", "Q", "END"]);
  expect(sessionAbbr({})).toBe("R");
  expect(sessionLabel(WEEKEND[1])).toBe("R1 · Sprint");
  expect(sessionLabel(WEEKEND[3])).toBe("R2");
});

test("Termine mit gleicher Runde sind EINE Runde - mit Ort, Flagge und Status aus den Läufen", () => {
  const groups = groupWeekends(WEEKEND);
  expect(groups.map((group) => [group.number, group.rounds.map((round) => round.id), group.state, group.multi])).toEqual([
    [1, ["q1", "s1", "r1"], "missing", true],
    [2, ["r2"], "planned", false],
  ]);
  expect(groups[0]).toMatchObject({ code: "R1", venue: "Probering", country_code: "AT" });
  expect(hasSessions(WEEKEND)).toBe(true);
  expect(hasSessions([WEEKEND[3]])).toBe(false);
  // Ohne Runden-Nummer vom Server gruppiert das Kürzel.
  expect(groupWeekends([{ id: "a", code: "R 1" }, { id: "b", code: "r1" }]).map((group) => group.rounds.length)).toEqual([2]);
});

test("Status einer Runde: abgesagt nur ganz, gewertet erst mit allen Läufen", () => {
  expect(weekendState([{ state: "cancelled" }, { state: "cancelled" }])).toBe("cancelled");
  expect(weekendState([{ state: "scored" }, { state: "cancelled" }])).toBe("scored");
  expect(weekendState([{ state: "scored" }, { state: "today" }])).toBe("today");
  expect(weekendState([{ state: "planned" }, { state: "postponed" }])).toBe("postponed");
});

test("der nächste Lauf in Worten", () => {
  expect(nextSessionLabel({ code: "R3", session: "Qualifying" })).toBe("R3 · Qualifying");
  expect(nextSessionLabel({ code: "R3" })).toBe("R3");
  expect(nextSessionLabel(null)).toBe("");
});

test("Fahrer-Detail: Ø Start, Poles je Runde einmal, Quali-Duell", () => {
  const results = [{ round_id: "s1", grid: 4 }, { round_id: "r1", grid: 1, marks: ["pole"] }, { round_id: "r2" }];
  expect(averageGrid(results)).toBe(2.5);
  expect(averageGridLabel(2.5)).toBe("Ø Start 2,5");
  expect(averageGridLabel(3)).toBe("Ø Start 3");
  expect(averageGrid([{ grid: null }])).toBeNull();
  const qualifying = [
    { round_id: "q1", places: { anna: 1, bert: 2 } },
    { round_id: "q2", places: { anna: 3, bert: 2 } },
    { round_id: "q3", places: { anna: 1 } },
  ];
  const rounds = [...WEEKEND, { id: "q2", weekend: 2 }, { id: "q3", weekend: 3 }];
  // Pole am Rennen und Platz 1 im Qualifying derselben Runde zählen einmal.
  expect(poleCount({ key: "anna", results }, rounds, qualifying)).toBe(2);
  expect(qualiDuel("anna", "bert", qualifying)).toEqual({ sessions: 2, a: 1, b: 1 });
});
