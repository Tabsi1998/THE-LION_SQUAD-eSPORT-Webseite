// Aufruf-Tafel (#1122): wer aufgerufen ist, Countdown bis zur geplanten Zeit oder ab dem Aufruf, „Jetzt geht es los“
// bei 0, gestartete und entschiedene Spiele sind kein Aufruf mehr; was danach kommt; neue Aufrufe für den Gong.
import { decide, find, singleElimination, start } from "../../e2e/fixtures/tvBrackets.mjs";
import { call, plan, stationsOf } from "../../e2e/fixtures/tvHall.mjs";
import { callsOf, countdown, newCalls, nextPlanned, ringShare } from "./tvCalls";

const NOW = Date.parse("2026-10-10T14:32:00+02:00");
const at = (minutes) => new Date(NOW + minutes * 60000).toISOString();

test("ohne geplante Zeit läuft der Countdown die „Zeit zum Antreten“ ab dem Aufruf", () => {
  const bracket = singleElimination(8);
  call(bracket, "A", { station: "PC 3", calledAt: at(-0.5) });
  const [first] = callsOf(bracket.matches_v2, [], { reportMinutes: 2 });
  expect(first.station).toBe("PC 3");
  expect(first.dueAt).toBe(NOW + 90 * 1000);
  expect(countdown(first.dueAt, NOW)).toEqual({ seconds: 90, text: "1:30", done: false });
  expect(ringShare(first, NOW)).toBeCloseTo(0.75, 5);
  // Mit „Zeit zum Antreten“ 5 Minuten läuft er länger.
  expect(callsOf(bracket.matches_v2, [], { reportMinutes: 5 })[0].dueAt).toBe(NOW + 4.5 * 60000);
});

test("mit geplanter Zeit läuft er bis dorthin; lag die schon vor dem Aufruf, gilt die Zeit zum Antreten", () => {
  const bracket = singleElimination(8);
  call(bracket, "A", { station: "PC 3", calledAt: at(-1), scheduledAt: at(4) });
  call(bracket, "B", { station: "PC 4", calledAt: at(-1), scheduledAt: at(-10) });
  const calls = callsOf(bracket.matches_v2, [], { reportMinutes: 2 });
  expect(calls.map((entry) => entry.station)).toEqual(["PC 4", "PC 3"]);
  expect(calls[1].dueAt).toBe(NOW + 4 * 60000);
  expect(calls[0].dueAt).toBe(NOW + 60000);
});

test("bei 0 steht „Jetzt geht es los“ - keine Minuszeit", () => {
  expect(countdown(NOW - 5000, NOW)).toEqual({ seconds: 0, text: "0:00", done: true });
  expect(countdown(null, NOW)).toEqual({ seconds: null, text: "", done: false });
  expect(countdown(NOW + 61500, NOW).text).toBe("1:02");
});

test("gestartet oder entschieden: kein Aufruf mehr; eine reservierte Station ohne Zeit ist trotzdem ein Aufruf", () => {
  const bracket = singleElimination(8);
  call(bracket, "A", { station: "PC 1", calledAt: at(-1) });
  call(bracket, "B", { station: "PC 2", calledAt: at(-1) });
  call(bracket, "C", { station: "PC 3", calledAt: at(-1) });
  start(bracket, "B", { station: "PC 2", startedAt: at(0) });
  decide(bracket, "C");
  expect(callsOf(bracket.matches_v2).map((entry) => entry.matchId)).toEqual(["m-A"]);
  // Ältere Reservierung ohne „aufgerufen um“: Aufruf ohne Countdown.
  const older = singleElimination(8);
  const match = find(older, "D");
  const stations = [{ id: "st-pc-9", name: "9", status: "reserved", current_match_id: match.id }];
  const [entry] = callsOf(older.matches_v2, stations);
  expect(entry.station).toBe("Station 9");
  expect(entry.dueAt).toBeNull();
  expect(countdown(entry.dueAt, NOW).text).toBe("");
  expect(ringShare(entry, NOW)).toBe(1);
});

test("die Station aus /api/stations hat Vorrang - auch ihr „aufgerufen um“", () => {
  const bracket = singleElimination(8);
  call(bracket, "A", { station: "PC 3", calledAt: at(-1) });
  const stations = stationsOf([bracket], { names: ["PC 3"] });
  delete find(bracket, "A").called_at;
  expect(stations[0]).toMatchObject({ status: "reserved", called_at: at(-1) });
  const [entry] = callsOf(bracket.matches_v2, stations, { reportMinutes: 2 });
  expect(entry.stationId).toBe("st-pc-3");
  expect(entry.dueAt).toBe(NOW + 60000);
});

test("danach: die nächsten eingeplanten Spiele, die weder laufen noch aufgerufen sind", () => {
  const bracket = singleElimination(8);
  call(bracket, "A", { station: "PC 1", calledAt: at(-1) });
  plan(bracket, "C", { station: "PC 5", scheduledAt: at(20) });
  plan(bracket, "B", { station: "PC 4", scheduledAt: at(10) });
  plan(bracket, "D", { station: "PC 6", scheduledAt: at(30) });
  const calls = callsOf(bracket.matches_v2);
  expect(nextPlanned(bracket.matches_v2, calls).map((entry) => entry.match.match_key)).toEqual(["B", "C"]);
  expect(nextPlanned(bracket.matches_v2, calls, { limit: 3 })[2].station).toBe("PC 6");
});

test("für den Gong: nur neue Aufrufe, beim ersten Stand keiner", () => {
  const bracket = singleElimination(8);
  call(bracket, "A", { station: "PC 1", calledAt: at(-1) });
  const first = callsOf(bracket.matches_v2);
  expect(newCalls(null, first)).toEqual([]);
  call(bracket, "B", { station: "PC 2", calledAt: at(0) });
  expect(newCalls(new Set(first.map((entry) => entry.matchId)), callsOf(bracket.matches_v2))).toEqual(["m-B"]);
});
