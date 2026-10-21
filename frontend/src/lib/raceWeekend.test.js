import {
  averageGrid, averageGridLabel, chipLabel, groupWeekends, hasSessions, nextSessionLabel, poleCount, qualiDuel, sessionAbbr,
  sessionKind, sessionLabel, sessionPointsLines, weekendPayload, weekendState, weekendToForm,
} from "./raceWeekend";

const F2 = { formats: [
  { from_round: 1, sessions: [
    { label: "Qualifying", offset: 0, counts: false, points: "none", grid: "manual" },
    { label: "Sprint", offset: 30, counts: true, points: [12, 9, 7], grid: "manual" },
    { label: "Hauptrennen", offset: 75, counts: true, points: "series", grid: "qualifying" },
  ] },
  { from_round: 5, sessions: [
    { label: "Sprint", offset: 0, counts: true, points: [12, 9, 7], grid: "reverse_standings" },
    { label: "Hauptrennen", offset: 45, counts: true, points: "none", grid: "reverse_standings" },
  ] },
] };

test("Läufe je Runde: Formular hin und zurück ohne Verlust, leer heißt keine Vorgabe", () => {
  expect(weekendPayload(weekendToForm(F2))).toEqual(F2);
  expect(weekendPayload([])).toBeNull();
  expect(weekendToForm(null)).toEqual([]);
});

test("Punkte je Lauf in Worten - ab Runde X nur, was sich ändert", () => {
  expect(sessionPointsLines(F2)).toEqual(["Sprint: 12 · 9 · 7", "ab Runde 5 Hauptrennen: keine Punkte"]);
  expect(sessionPointsLines(null)).toEqual([]);
});

// Rennwochenende (#1930): eine Runde mit Läufen - gruppieren, beschriften, zählen. Nur erfundene Namen und Orte.

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
