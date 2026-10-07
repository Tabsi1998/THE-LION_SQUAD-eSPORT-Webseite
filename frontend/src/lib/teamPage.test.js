import { INVITE_PARAM, inviteTokenFrom, outcomeLabel, recentLine, upcomingLine } from "@/lib/teamPage";

// Team-Seite (#1191): Zeilen für Termine und letzte Spiele, der Schlüssel aus der Adresse.

test("letzte Spiele: Ergebnis mit Gegner, bei Durchgängen der Platz", () => {
  expect(recentLine({ kind: "duel", score: "3:1", opponent: "Pixelpiraten", outcome: "win" })).toBe("3:1 gegen Pixelpiraten");
  expect(recentLine({ kind: "duel", score: null, opponent: "Team Kaktus", outcome: "loss", forfeit: true })).toBe("Verloren gegen Team Kaktus (kampflos)");
  expect(recentLine({ kind: "heat", rank: 2, field: 6 })).toBe("Platz 2 von 6");
  expect(outcomeLabel({ kind: "duel", outcome: "win" })).toBe("Sieg");
  expect(outcomeLabel({ kind: "duel", outcome: "loss" })).toBe("Niederlage");
  expect(outcomeLabel({ kind: "duel", outcome: "draw" })).toBe("Unentschieden");
  expect(outcomeLabel({ kind: "heat", rank: 1 })).toBe("Platz 1");
});

test("kommende Turniere: Event, Wochentag, Datum und Uhrzeit in Wien", () => {
  const line = upcomingLine({ tournament: { event_name: "Herbst-LAN", start_date: "2026-10-17T14:00:00Z", game_name: "Rocket League" } });
  expect(line).toContain("Herbst-LAN");
  expect(line).toContain("17.10.");
  expect(line).toContain("16:00");
  expect(upcomingLine({ tournament: { start_date: null, game_name: "Rocket League" } })).toBe("Rocket League");
});

test("der Einladungs-Schlüssel kommt aus ?einladung=", () => {
  expect(INVITE_PARAM).toBe("einladung");
  expect(inviteTokenFrom("?einladung=AbC123")).toBe("AbC123");
  expect(inviteTokenFrom("?tab=chat")).toBe("");
  expect(inviteTokenFrom("")).toBe("");
});
