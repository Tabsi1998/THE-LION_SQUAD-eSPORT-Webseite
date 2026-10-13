import { initialSelection, offersPlayAlong, playAlongRows, resultSentence, selectionTotal, type PlayAlongEntry } from "./playAlong";

// „Spielst du auch mit?“ (#1184): dieselbe Rechnung wie im Web (frontend/src/lib/playAlong.test.js).

const SOLO: PlayAlongEntry = { kind: "tournament", id: "t1", slug: "lan-cup", title: "LAN-Cup", start_date: "2026-10-31T14:00:00+00:00", mode: "Einzel", game: "Rocket League",
  team: false, fee: { total_cents: 1000, currency: "EUR" }, spots_left: 3, full: false, selectable: true, reason: null, event_day: { index: 2 } };
const FULL: PlayAlongEntry = { ...SOLO, id: "t2", slug: "mini", fee: { total_cents: 500, currency: "EUR" }, spots_left: 0, full: true };
const FREE: PlayAlongEntry = { ...SOLO, id: "t3", slug: "fun", fee: null, spots_left: 1 };
const TEAM: PlayAlongEntry = { ...SOLO, id: "t4", slug: "team", mode: "Team", team: true, fee: null, selectable: false, reason: "Dein Kapitän meldet das Team an." };
const LAP: PlayAlongEntry = { kind: "fastlap", id: "f1", slug: "lap", title: "LAN Fast Lap", start_date: null, mode: "Bestzeit fahren", selectable: false };

test("die Frage gibt es nur mit Konto und nur mit Turnieren oder Fast Laps", () => {
  expect(offersPlayAlong({ tournaments: [SOLO] }, false)).toBe(false);
  expect(offersPlayAlong({ tournaments: [], f1_challenges: [] }, true)).toBe(false);
  expect(offersPlayAlong({ f1_challenges: [LAP] }, true)).toBe(true);
});

test("jede Zeile sagt Spielart, Spiel, Startgeld und freie Plätze", () => {
  const rows = playAlongRows([SOLO, FULL, FREE, TEAM, LAP], { multiDay: true });
  expect(rows[0].line).toBe("Einzel · Rocket League · 10,00 € Startgeld · 3 Plätze frei");
  expect(rows[0].dayLabel).toBe("Tag 2");
  expect(rows[0].timeLabel).toBe("Sa 15:00");
  expect(rows[1].line).toBe("Einzel · Rocket League · 5,00 € Startgeld · voll – Warteliste");
  expect(rows[2].line).toBe("Einzel · Rocket League · kostenlos · 1 Platz frei");
  expect(rows[3].line).toBe("Team · Rocket League");
  expect(rows[4].line).toBe("Bestzeit fahren");
  expect(playAlongRows([SOLO])[0]).toMatchObject({ dayLabel: "", timeLabel: "15:00", key: "lan-cup" });
});

test("Vorauswahl, Summe und Ergebnissatz", () => {
  expect(initialSelection([SOLO, TEAM], "lan-cup")).toEqual(["t1"]);
  expect(initialSelection([SOLO, TEAM], "team")).toEqual([]);
  expect(selectionTotal([SOLO, FULL, FREE], ["t1", "t2", "t3"])).toEqual({ total_cents: 1000, currency: "EUR", waitlistFees: 1 });
  expect(resultSentence([
    { id: "a", state: "registered", label: "" }, { id: "b", state: "waitlist", label: "" }, { id: "c", state: "error", label: "" },
  ])).toBe("1 angemeldet, 1 auf der Warteliste, 1 nicht angemeldet");
});
