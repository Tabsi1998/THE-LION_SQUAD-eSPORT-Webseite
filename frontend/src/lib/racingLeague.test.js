import {
  barShare, bonusLabel, clubDrivers, driverSeason, garageTeams, gapLabel, raceCell, raceCellLabel, raceSummary, teamDuel,
  teamRuleLabel, teamTableRows,
} from "./racingLeague";

// Rennliga (#1746): Zellen des Rennrasters, Abstand, Sieger und bester Vereinsfahrer je Rennen, Fahrer-Detail,
// Teamduell und Vereins-Garage - alles aus dem gespeicherten Stand der Serienseite. Nur erfundene Namen.

const ROUNDS = [
  { id: "r1", position: 1, code: "R1", state: "scored", kind: "regular", counts: true },
  { id: "r2", position: 2, code: "R2", state: "scored", kind: "regular", counts: true },
  { id: "rx", position: 3, code: "R3", state: "cancelled", kind: "regular", counts: true },
  { id: "r4", position: 4, code: "R4", state: "planned", kind: "regular", counts: true },
];

function result(round_id, place, points, marks = [], extra = {}) {
  return { round_id, place, points, marks, counted: true, dropped: false, ...extra };
}

const ROWS = [
  { key: "ext1", rank: 1, points: 44, name: "Fremd Eins", club_member: false,
    results: [result("r1", 1, 26, ["fastest_lap"]), result("r2", 2, 18)] },
  { key: "lion1", rank: 2, points: 43, name: "Probe Lion Eins", club_member: true, profile_slug: "probe-lion-1",
    results: [result("r1", 2, 18), result("r2", 1, 25, ["pole"])] },
  { key: "lion3", rank: 3, points: 24, name: "Probe Lion Drei", club_member: true,
    results: [result("r1", 6, 8), result("r2", 3, 16, ["fastest_lap"])] },
  { key: "guest", rank: 4, points: 22, name: "Gast Probe", club_member: false,
    results: [result("r1", 5, 10), result("r2", 4, 12)] },
  { key: "lion2", rank: 5, points: 12, name: "Probe Lion Zwei", club_member: true,
    results: [result("r1", 4, 12), result("r2", null, 0, ["dns"])] },
  { key: "hidden", rank: 6, points: 6, name: null, name_hidden: true, club_member: false,
    results: [result("r1", 7, 6), result("r2", 6, 0, ["dnf"])] },
];

const DRIVERS = {
  ext1: { team: "Fremd Rot", guest: false, round_teams: { r1: "Fremd Rot", r2: "Fremd Rot" } },
  lion1: { team: "Probe Löwen", guest: false, round_teams: { r1: "Probe Löwen", r2: "Probe Löwen" } },
  lion2: { team: "Probe Löwen", guest: false, round_teams: { r1: "Probe Löwen", r2: "Probe Löwen" } },
  lion3: { team: "Probe Löwen B", guest: false, round_teams: { r1: "Probe Löwen B", r2: "Probe Löwen B" } },
  guest: { team: "Probe Löwen B", guest: true, round_teams: { r1: "Probe Löwen B", r2: "Probe Löwen B" } },
  hidden: { team: "Fremd Rot", guest: false, round_teams: { r1: "Fremd Rot", r2: "Fremd Rot" } },
};

test("Rasterzelle: Platz mit Podium, schnellste Runde, Ausfall, Nichtstart, Disqualifikation", () => {
  expect(raceCell(result("r1", 1, 26, ["fastest_lap"]))).toMatchObject({ text: "1", medal: "gold", fastest: true, status: "finished" });
  expect(raceCell(result("r1", 2, 18))).toMatchObject({ text: "2", medal: "silver", fastest: false });
  expect(raceCell(result("r1", 3, 15, ["pole"]))).toMatchObject({ medal: "bronze", pole: true });
  expect(raceCell(result("r1", 4, 12)).medal).toBeNull();
  // Ein Ausfall auf Platz 2 ist kein Podium.
  expect(raceCell(result("r1", 2, 0, ["dnf"]))).toMatchObject({ text: "DNF", medal: null, status: "dnf" });
  expect(raceCell(result("r1", null, 0, ["dns"]))).toMatchObject({ text: "DNS", status: "dns" });
  expect(raceCell(result("r1", 1, 0, ["dsq"]))).toMatchObject({ text: "DSQ", medal: null, status: "dsq" });
  expect(raceCell(result("r1", null, 5))).toMatchObject({ text: "–", status: "finished" });
  expect(raceCell(result("r1", 5, 10, [], { dropped: true })).dropped).toBe(true);
  expect(raceCell(null)).toBeNull();
});

test("Rasterzelle für Screenreader: Platz, Punkte, Marken und gestrichen", () => {
  expect(raceCellLabel(raceCell(result("r1", 1, 26, ["fastest_lap"])), "R1")).toBe("R1: Platz 1, 26 Punkte, schnellste Runde");
  expect(raceCellLabel(raceCell(result("r1", 2, 0, ["dnf"])), "R1")).toBe("R1: ausgefallen, 0 Punkte");
  expect(raceCellLabel(raceCell(result("r1", null, 0, ["dns"])), "R2")).toBe("R2: nicht gestartet, 0 Punkte");
  expect(raceCellLabel(raceCell(result("r1", 3, 1, ["dsq"])), "R2")).toBe("R2: disqualifiziert, 1 Punkt");
  expect(raceCellLabel(raceCell(result("r1", 5, 10, ["pole"], { dropped: true })), "R3")).toBe("R3: Platz 5, 10 Punkte, Pole, gestrichen");
  expect(raceCellLabel(null, "R4")).toBe("R4: nicht dabei");
});

test("Abstand zur Spitze mit echtem Minus; die Spitze selbst hat keinen", () => {
  expect(gapLabel(ROWS[0], ROWS)).toBe("");
  expect(gapLabel(ROWS[1], ROWS)).toBe("−1");
  expect(gapLabel(ROWS[5], ROWS)).toBe("−38");
  expect(gapLabel({ key: "tie", rank: 1, points: 44 }, [{ key: "x", rank: 1, points: 44 }, { key: "tie", rank: 1, points: 44 }])).toBe("");
  expect(gapLabel(ROWS[0], [])).toBe("");
});

test("Rennen: Sieger, schnellste Runde und bester Vereinsfahrer", () => {
  const first = raceSummary(ROWS, "r1");
  expect(first.winner.key).toBe("ext1");
  expect(first.fastest.key).toBe("ext1");
  expect(first.bestClub.row.key).toBe("lion1");
  expect(first.bestClub.cell.text).toBe("2");
  const second = raceSummary(ROWS, "r2");
  expect(second.winner.key).toBe("lion1");
  expect(second.bestClub.row.key).toBe("lion1");
  expect(second.fastest.key).toBe("lion3");
  // Ohne Ergebnis keiner.
  expect(raceSummary(ROWS, "r4")).toEqual({ winner: null, fastest: null, bestClub: null });
});

test("bester Vereinsfahrer: ein Ausfall nur, wenn keiner ins Ziel kam; ein Nichtstart nie", () => {
  const rows = [
    { key: "a", club_member: true, results: [result("r1", 3, 0, ["dnf"])] },
    { key: "b", club_member: true, results: [result("r1", null, 0, ["dns"])] },
    { key: "c", club_member: false, results: [result("r1", 1, 25)] },
  ];
  expect(raceSummary(rows, "r1").bestClub.row.key).toBe("a");
  expect(raceSummary([rows[1], rows[2]], "r1").bestClub).toBeNull();
  // Ein disqualifizierter Erster ist kein Sieger.
  expect(raceSummary([{ key: "d", results: [result("r1", 1, 0, ["dsq"])] }], "r1").winner).toBeNull();
});

test("Fahrer-Detail: Rennen, Siege, Podien, schnellste Runden, Ausfälle und Punkte je Rennen", () => {
  const season = driverSeason(ROWS[2], ROUNDS);
  expect(season).toMatchObject({ races: 2, wins: 0, podiums: 1, fastestLaps: 1, poles: 0, dnfs: 0, bestPlace: 3 });
  expect(season.perRace.map((item) => [item.round.id, item.cell?.text ?? null, item.points])).toEqual([
    ["r1", "6", 8], ["r2", "3", 16], ["rx", null, null], ["r4", null, null]]);
  expect(season.maxPoints).toBe(16);
  const lion2 = driverSeason(ROWS[4], ROUNDS);
  expect(lion2).toMatchObject({ races: 1, wins: 0, podiums: 0, dnfs: 0, bestPlace: 4 });
  const hidden = driverSeason(ROWS[5], ROUNDS);
  expect(hidden).toMatchObject({ races: 2, dnfs: 1, bestPlace: 7 });
  expect(driverSeason(ROWS[1], ROUNDS)).toMatchObject({ wins: 1, podiums: 2, poles: 1, bestPlace: 1 });
});

test("Teamduell: wer im selben Team vor dem anderen ins Ziel kam, und die Punkte fürs Team", () => {
  const duel = teamDuel(ROWS[2], ROWS[3], "Probe Löwen B", DRIVERS);
  expect(duel).toEqual({ races: 2, a: { key: "lion3", ahead: 1, points: 24 }, b: { key: "guest", ahead: 1, points: 22 } });
  // Ein Nichtstart zählt nicht als Duell, die Punkte fürs Team schon.
  const lions = teamDuel(ROWS[1], ROWS[4], "Probe Löwen", DRIVERS);
  expect(lions).toEqual({ races: 1, a: { key: "lion1", ahead: 1, points: 43 }, b: { key: "lion2", ahead: 0, points: 12 } });
  // Ein Ausfall verliert gegen jeden, der ins Ziel kommt.
  const rows = [
    { key: "a", results: [result("r1", 2, 0, ["dnf"]), result("r2", 9, 2)] },
    { key: "b", results: [result("r1", 8, 4), result("r2", 3, 0, ["dnf"])] },
  ];
  const drivers = { a: { round_teams: { r1: "T", r2: "T" } }, b: { round_teams: { r1: "T", r2: "Anderes Team" } } };
  expect(teamDuel(rows[0], rows[1], "T", drivers)).toEqual({ races: 1, a: { key: "a", ahead: 0, points: 2 }, b: { key: "b", ahead: 1, points: 4 } });
});

test("Garage: je Vereinsteam die Fahrer in Tabellen-Reihenfolge, Platz in der Teamwertung und das Duell", () => {
  const teamRows = [
    { key: "Fremd Rot", team: "Fremd Rot", rank: 1, points: 59 },
    { key: "Probe Löwen", team: "Probe Löwen", rank: 2, points: 55 },
    { key: "Probe Löwen B", team: "Probe Löwen B", rank: 3, points: 46 },
  ];
  const garage = garageTeams(["Probe Löwen", "Probe Löwen B", "Probe Leer"], ROWS, DRIVERS, teamRows);
  expect(garage.map((item) => [item.team, item.standing?.rank ?? null, item.drivers.map((row) => row.key)])).toEqual([
    ["Probe Löwen", 2, ["lion1", "lion2"]], ["Probe Löwen B", 3, ["lion3", "guest"]], ["Probe Leer", null, []]]);
  expect(garage[0].duel).toMatchObject({ a: { key: "lion1" }, b: { key: "lion2" } });
  expect(garage[2].duel).toBeNull();
  // Ohne Teamwertung gibt es keinen Platz, die Fahrer bleiben.
  expect(garageTeams(["Probe Löwen"], ROWS, DRIVERS, null)[0].standing).toBeNull();
});

test("Garage: im Duell die zwei Fahrer mit den meisten Rennen fürs Team", () => {
  const rows = [
    { key: "a", rank: 1, points: 30, results: [result("r1", 1, 25), result("r2", 9, 2)] },
    { key: "sub", rank: 2, points: 18, results: [result("r1", 2, 18)] },
    { key: "b", rank: 3, points: 6, results: [result("r1", 5, 4), result("r2", 8, 2)] },
  ];
  const drivers = {
    a: { team: "T", round_teams: { r1: "T", r2: "T" } },
    sub: { team: "T", round_teams: { r1: "T" } },
    b: { team: "T", round_teams: { r1: "T", r2: "T" } },
  };
  const [garage] = garageTeams(["T"], rows, drivers, null);
  expect(garage.drivers.map((row) => row.key)).toEqual(["a", "sub", "b"]);
  expect([garage.duel.a.key, garage.duel.b.key]).toEqual(["a", "b"]);
});

test("Vereinsfahrer für das Detail: nur Mitglieder mit Namen, in Tabellen-Reihenfolge", () => {
  expect(clubDrivers(ROWS).map((row) => row.key)).toEqual(["lion1", "lion3", "lion2"]);
  expect(clubDrivers([{ key: "x", club_member: true, name_hidden: true }])).toEqual([]);
});

test("Teamwertung als Tabellenzeilen: Teamname als Name, Vereinsteams markiert", () => {
  const rows = teamTableRows([{ key: "Probe Löwen", team: "Probe Löwen", rank: 1, points: 10 }, { key: "Fremd Rot", team: "Fremd Rot", rank: 2, points: 5 }], ["Probe Löwen"]);
  expect(rows.map((row) => [row.key, row.name, row.club_member, row.name_hidden])).toEqual([
    ["Probe Löwen", "Probe Löwen", true, false], ["Fremd Rot", "Fremd Rot", false, false]]);
});

test("Balken: Anteil an der Spitze, nie unter null oder über eins", () => {
  expect(barShare(55, 59)).toBeCloseTo(0.932, 3);
  expect(barShare(59, 59)).toBe(1);
  expect(barShare(0, 59)).toBe(0);
  expect(barShare(-3, 59)).toBe(0);
  expect(barShare(80, 59)).toBe(1);
  expect(barShare(5, 0)).toBe(0);
});

test("Regeln in Worten: Bonus für schnellste Runde und Pole, Teamwertung", () => {
  expect(bonusLabel({ bonuses: { fastest_lap: { points: 1, max_place: 10 }, pole: { points: 0, max_place: null } } }))
    .toBe("+1 Punkt für die schnellste Runde (bis Platz 10)");
  expect(bonusLabel({ bonuses: { fastest_lap: { points: 2, max_place: null }, pole: { points: 1, max_place: null } } }))
    .toBe("+2 Punkte für die schnellste Runde, +1 Punkt für die Pole");
  expect(bonusLabel({ bonuses: {} })).toBe("");
  expect(bonusLabel(null)).toBe("");
  expect(teamRuleLabel({ enabled: true, counting_drivers: 2, guests_count: true }))
    .toBe("Je Rennen zählen die besten 2 Fahrer eines Teams. Gäste zählen fürs Team.");
  expect(teamRuleLabel({ enabled: true, counting_drivers: null, guests_count: false }))
    .toBe("Je Rennen zählen alle Fahrer eines Teams. Gäste zählen nicht fürs Team.");
  expect(teamRuleLabel({ enabled: true, counting_drivers: 1, guests_count: true }))
    .toBe("Je Rennen zählt der beste Fahrer eines Teams. Gäste zählen fürs Team.");
  expect(teamRuleLabel({ enabled: false })).toBe("");
});
