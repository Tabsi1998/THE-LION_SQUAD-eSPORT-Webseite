import { initialSelection, offersPlayAlong, playAlongRows, resultSentence, returnTournamentPath, selectionTotal } from "@/lib/playAlong";

// „Spielst du auch mit?“ (#1184): die Rechnung des zweiten Schritts ohne React.

const SOLO = { kind: "tournament", id: "t1", slug: "lan-cup", title: "LAN-Cup", start_date: "2026-10-31T14:00:00+00:00", mode: "Einzel", game: "Rocket League",
  team: false, fee: { total_cents: 1000, currency: "EUR" }, spots_left: 3, full: false, selectable: true, reason: null, event_day: { index: 2 } };
const FULL = { ...SOLO, id: "t2", slug: "mini", title: "Mini-Cup", fee: { total_cents: 500, currency: "EUR" }, spots_left: 0, full: true };
const FREE = { ...SOLO, id: "t3", slug: "fun", title: "Fun-Cup", fee: null, spots_left: 1 };
const TEAM = { ...SOLO, id: "t4", slug: "team", title: "Team-Cup", mode: "Team", team: true, fee: null, selectable: false, reason: "Dein Kapitän meldet das Team an." };
const LAP = { kind: "fastlap", id: "f1", slug: "lap", title: "LAN Fast Lap", start_date: null, mode: "Bestzeit fahren", selectable: false, reason: "Keine Anmeldung nötig – du fährst einfach deine Bestzeit." };

test("die Frage gibt es nur mit Konto und nur mit Turnieren oder Fast Laps", () => {
  expect(offersPlayAlong({ tournaments: [SOLO], f1_challenges: [] }, null)).toBe(false);
  expect(offersPlayAlong({ tournaments: [], f1_challenges: [] }, { id: "u1" })).toBe(false);
  expect(offersPlayAlong({ tournaments: [], f1_challenges: [LAP] }, { id: "u1" })).toBe(true);
  expect(offersPlayAlong({ tournaments: [SOLO] }, { id: "u1" })).toBe(true);
});

test("jede Zeile sagt Spielart, Spiel, Startgeld und freie Plätze - Team und Fast Lap ohne Plätze", () => {
  const rows = playAlongRows([SOLO, FULL, FREE, TEAM, LAP], { multiDay: true });
  expect(rows[0].line).toBe("Einzel · Rocket League · 10,00 € Startgeld · 3 Plätze frei");
  expect(rows[0].dayLabel).toBe("Tag 2");
  expect(rows[0].timeLabel).toMatch(/^Sa 15:00$/);
  expect(rows[1].line).toBe("Einzel · Rocket League · 5,00 € Startgeld · voll – Warteliste");
  expect(rows[2].line).toBe("Einzel · Rocket League · kostenlos · 1 Platz frei");
  expect(rows[3].line).toBe("Team · Rocket League");
  expect(rows[4].line).toBe("Bestzeit fahren");
  expect(rows[4].path).toBe("/fastlap/lap");
  expect(rows[3].path).toBe("/tournaments/team");
  expect(playAlongRows([SOLO])[0]).toMatchObject({ dayLabel: "", timeLabel: "15:00" });
});

test("vorausgewählt ist nur das Turnier, von dem man kommt - wenn es einen Haken hat", () => {
  expect(initialSelection([SOLO, TEAM], "lan-cup")).toEqual(["t1"]);
  expect(initialSelection([SOLO, TEAM], "t1")).toEqual(["t1"]);
  expect(initialSelection([SOLO, TEAM], "team")).toEqual([]);
  expect(initialSelection([SOLO, TEAM], "")).toEqual([]);
});

test("die Summe zählt die gewählten Startgelder - Warteliste zahlt erst beim Nachrücken", () => {
  expect(selectionTotal([SOLO, FULL, FREE], ["t1", "t3"])).toEqual({ total_cents: 1000, currency: "EUR", waitlistFees: 0 });
  expect(selectionTotal([SOLO, FULL, FREE], ["t1", "t2"])).toEqual({ total_cents: 1000, currency: "EUR", waitlistFees: 1 });
  expect(selectionTotal([SOLO], [])).toEqual({ total_cents: 0, currency: "EUR", waitlistFees: 0 });
});

test("das Ergebnis in einem Satz", () => {
  expect(resultSentence([{ state: "registered" }, { state: "already" }, { state: "waitlist" }, { state: "error" }])).toBe("2 angemeldet, 1 auf der Warteliste, 1 nicht angemeldet");
  expect(resultSentence([{ state: "error" }])).toBe("1 nicht angemeldet");
});

test("zurück zum Turnier nur mit einem einfachen Kurznamen", () => {
  expect(returnTournamentPath("lan-cup")).toBe("/tournaments/lan-cup");
  expect(returnTournamentPath("//evil.example")).toBe("");
  expect(returnTournamentPath("https://evil.example")).toBe("");
  expect(returnTournamentPath("")).toBe("");
});
