import {
  changedKeys, countdownTickMs, describeResult, formatCountdown, freshResults, liveCountLine, movedKeys,
  nextCountdownTarget, standingSignature, timelineSignature,
} from "./liveChanges";

// Dynamik-Block (#224, #225): Was hat sich zwischen zwei Ständen geändert, und wie heißt das?

test("changedKeys nennt nur Einträge, die es vorher gab und die anders sind", () => {
  const before = [{ id: "a", v: 1 }, { id: "b", v: 1 }];
  const after = [{ id: "a", v: 2 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
  expect([...changedKeys(before, after, (x) => x.id, (x) => String(x.v))]).toEqual(["a"]);
  expect(changedKeys(null, after, (x) => x.id, (x) => String(x.v)).size).toBe(0);
});

test("movedKeys nennt den alten und neuen Platz", () => {
  const before = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const after = [{ id: "b" }, { id: "a" }, { id: "c" }];
  expect([...movedKeys(before, after, (x) => x.id)]).toEqual([["b", { from: 1, to: 0 }], ["a", { from: 0, to: 1 }]]);
});

test("Startseite: Signatur und Zahlenzeile je Karte", () => {
  const item = { status: "registration_open", public_phase: { state: "registration_open", label: "Anmeldung offen" }, start_date: "2026-10-01T18:00:00Z", live_counts: { registered: 12, capacity: 16, running_matches: 0 } };
  expect(timelineSignature(item)).toBe("registration_open|registration_open|Anmeldung offen|2026-10-01T18:00:00Z|12|16|0|");
  expect(liveCountLine(item)).toBe("12 von 16 angemeldet");
  expect(liveCountLine({ live_counts: { registered: 5, capacity: null, running_matches: 3 } })).toBe("5 angemeldet · 3 Matches laufen");
  expect(liveCountLine({ live_counts: { registered: 2, running_matches: 1 } })).toBe("2 angemeldet · 1 Match läuft");
  expect(liveCountLine({ live_counts: { participants: 7 } })).toBe("7 Fahrer");
  expect(liveCountLine({})).toBe("");
});

test("Countdown in ganzen Worten, ohne Sekunden", () => {
  const now = Date.parse("2026-09-22T10:00:00Z");
  expect(formatCountdown(Date.parse("2026-09-25T00:30:00Z"), now)).toBe("in 2 Tagen, 14 Stunden");
  expect(formatCountdown(Date.parse("2026-09-23T10:00:00Z"), now)).toBe("in 1 Tag");
  expect(formatCountdown(Date.parse("2026-09-22T12:05:00Z"), now)).toBe("in 2 Stunden, 5 Minuten");
  expect(formatCountdown(Date.parse("2026-09-22T11:00:00Z"), now)).toBe("in 1 Stunde");
  expect(formatCountdown(Date.parse("2026-09-22T10:04:00Z"), now)).toBe("in 4 Minuten");
  expect(formatCountdown(Date.parse("2026-09-22T10:00:30Z"), now)).toBe("in unter einer Minute");
  expect(formatCountdown(now - 1, now)).toBe("jetzt");
  expect(formatCountdown(NaN, now)).toBe("");
  expect(countdownTickMs(now + 30 * 60 * 1000, now)).toBe(15000);
  expect(countdownTickMs(now + 5 * 60 * 60 * 1000, now)).toBe(60000);
  expect(countdownTickMs(now - 1, now)).toBeNull();
});

test("der Countdown zielt auf den nächsten Termin, der noch nicht läuft", () => {
  const now = Date.parse("2026-09-22T10:00:00Z");
  const items = [
    { id: "live", public_phase: { state: "live", target_at: "2026-09-22T20:00:00Z" } },
    { id: "past", start_date: "2026-09-21T10:00:00Z" },
    { id: "next", public_phase: { state: "announced", target_at: "2026-09-24T18:00:00Z" }, start_date: "2026-09-24T18:00:00Z" },
    { id: "later", start_date: "2026-09-30T18:00:00Z" },
  ];
  expect(nextCountdownTarget(items, now)?.item.id).toBe("next");
  expect(nextCountdownTarget([], now)).toBeNull();
});

test("Turnierseiten: Zeilen-Signatur und Ergebnistext", () => {
  expect(standingSignature({ rank: 2, won: 3, lost: 1, points: 9 })).toBe("2|3|1|9");
  const registrations = { r1: { display_name: "Team A" }, r2: { display_name: "Team B" } };
  expect(describeResult({ participant_a_id: "r1", participant_b_id: "r2", score_a: 2, score_b: 1 }, registrations)).toBe("Ergebnis eingetragen: Team A 2:1 Team B");
  expect(describeResult({ slots: [{ registration_id: "r1" }, { registration_id: "r2" }], results: [{ registration_id: "r1", score: 3 }, { registration_id: "r2", score: 0 }] }, registrations)).toBe("Ergebnis eingetragen: Team A 3 : Team B 0");
  expect(describeResult({ match_key: "Heat 2", slots: [{ registration_id: "r1" }, { registration_id: "r2" }, { registration_id: "r3" }], results: [{ registration_id: "r2", rank: 1 }] }, registrations)).toBe("Ergebnis eingetragen: Team B gewinnt Heat 2");
});

test("freshResults: nur Matches, deren Ergebnis neu ist und die fertig sind", () => {
  const before = [{ id: "m1", status: "running" }, { id: "m2", status: "scheduled" }, { id: "m3", status: "completed", score_a: 1, score_b: 0 }];
  const after = [{ id: "m1", status: "completed", score_a: 2, score_b: 1 }, { id: "m2", status: "running" }, { id: "m3", status: "completed", score_a: 1, score_b: 0 }];
  expect(freshResults(before, after).map((m) => m.id)).toEqual(["m1"]);
  expect(freshResults(null, after)).toEqual([]);
});
