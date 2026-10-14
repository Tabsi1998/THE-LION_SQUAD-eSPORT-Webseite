import fixture from "../../e2e/fixtures/tableScheduleGenerated.json";
import { groupByRound, groupByStation, hasStations, onlyMine, scheduleEntries, statusTone } from "./scheduleView";

// Öffentlicher Spielplan (#1562): Zeiten und Stationen kommen vom Server (Planer), hier wird nur sortiert und
// beschriftet. Daten aus scripts/make_table_schedule_fixture.py - echter Planer, echte Stationen.

const onsite = scheduleEntries(fixture.onsite.bracket);

test("jedes Spiel wird ein Eintrag mit Namen, Ergebnis, Zeit und Station", () => {
  expect(onsite).toHaveLength(7);
  const done = onsite.find((entry) => entry.tone === "done");
  expect(done.sides.map((side) => side.score)).toEqual([2, 1]);
  expect(done.sides.filter((side) => side.winner)).toHaveLength(1);
  expect(onsite.every((entry) => entry.scheduledAt)).toBe(true);
  // Was der Planer nur vorhersagt (Plätze noch offen), heißt „voraussichtlich“.
  expect(onsite.filter((entry) => entry.forecast).map((entry) => entry.roundLabel)).toEqual(["Halbfinale", "Halbfinale", "Finale"]);
});

test("Status: läuft in der Live-Farbe, fertig, offen", () => {
  expect(onsite.filter((entry) => entry.tone === "live")).toHaveLength(1);
  expect(statusTone({ status: "running" })).toBe("live");
  expect(statusTone({ status: "in_progress" })).toBe("live");
  expect(statusTone({ status: "completed" })).toBe("done");
  expect(statusTone({ status: "cancelled" })).toBe("cancelled");
  expect(statusTone({ status: "scheduled" })).toBe("open");
});

test("nach Runden: in Spielreihenfolge mit den Namen vom Server", () => {
  expect(groupByRound(onsite).map((group) => [group.label, group.entries.length])).toEqual([["Viertelfinale", 4], ["Halbfinale", 2], ["Finale", 1]]);
});

test("nach Stationen: je Station eine Liste nach Zeit, Stationen in natürlicher Reihenfolge", () => {
  expect(hasStations(onsite)).toBe(true);
  const stations = groupByStation(onsite);
  expect(stations.map((station) => station.label)).toEqual(["PC 1", "PC 2", "Switch 3 · PC"]);
  for (const station of stations) {
    const times = station.entries.map((entry) => entry.scheduledAt);
    expect(times).toEqual([...times].sort());
  }
  expect(stations.reduce((sum, station) => sum + station.entries.length, 0)).toBe(7);
});

test("ohne Stationen gibt es keine Stations-Sicht; Spiele ohne Station stehen zuletzt", () => {
  const league = scheduleEntries(fixture.league.bracket);
  expect(hasStations(league)).toBe(false);
  const mixed = groupByStation([...onsite, ...league.slice(0, 2)]);
  expect(mixed.at(-1).label).toBe("Ohne Station");
});

test("nur meine Spiele: die eigene Anmeldung, auch für spätere Runden noch offen", () => {
  const mine = onlyMine(onsite);
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.every((entry) => entry.mine)).toBe(true);
  const mineId = fixture.onsite.bracket.registrations.find((reg) => reg.is_mine).id;
  expect(mine.every((entry) => entry.sides.some((side) => side.id === mineId))).toBe(true);
  expect(onlyMine(scheduleEntries({ ...fixture.onsite.bracket, registrations: fixture.onsite.bracket.registrations.map(({ is_mine: _mine, ...reg }) => reg) }))).toEqual([]);
});

test("Gruppen: jede Karte nennt ihre Gruppe", () => {
  const groups = scheduleEntries(fixture.groups.bracket);
  expect(new Set(groups.map((entry) => entry.groupLabel))).toEqual(new Set(["Gruppe A", "Gruppe B"]));
  expect(scheduleEntries(fixture.league.bracket).every((entry) => entry.groupLabel === "")).toBe(true);
});

// Abnahme #1593: Stationsname groß, Gerät klein; Läufe mit mehr als zwei Plätzen heißen „Lauf A · 4 Spieler“.
test("Station: Name und Gerät getrennt", () => {
  const stations = groupByStation(onsite);
  expect(stations.map((station) => [station.name, station.device])).toEqual([["PC 1", ""], ["PC 2", ""], ["Switch 3", "PC"]]);
});

test("Lauf mit mehr als zwei Plätzen: Name des Laufs und Zahl der Spieler statt „A gegen B gegen C gegen D“", async () => {
  const ffa = (await import("../../e2e/fixtures/ffaGenerated.json")).default.ffa16;
  const heats = scheduleEntries(ffa).filter((entry) => entry.sides.length > 2);
  expect(heats.length).toBeGreaterThan(0);
  const first = heats.find((entry) => entry.match.match_key === "A");
  expect(first.heat).toEqual({ name: "Lauf A", count: `${first.sides.filter((side) => side.id).length} Spieler` });
  expect(onsite.every((entry) => entry.heat === null)).toBe(true);
  // Ein Lauf späterer Runden, dessen Plätze noch offen sind, nennt seine Plätze - nicht „0 Spieler“ (Abnahme #1593).
  const open = heats.find((entry) => entry.sides.every((side) => !side.id));
  expect(open.heat.count).toBe(`${open.sides.length} Plätze`);
  expect(heats.every((entry) => !/^0 /.test(entry.heat.count))).toBe(true);
});
