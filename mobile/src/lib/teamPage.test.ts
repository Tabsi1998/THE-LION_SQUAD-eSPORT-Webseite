import { INVITE_PARAM, outcomeLabel, recentLine, upcomingLine } from "./teamPage";

// Team-Seite (#1191): dieselben Zeilen wie im Web.

test("letzte Spiele: Ergebnis mit Gegner, bei Durchgängen der Platz", () => {
  expect(recentLine({ match_id: "m", kind: "duel", score: "3:1", opponent: "Pixelpiraten", outcome: "win" })).toBe("3:1 gegen Pixelpiraten");
  expect(recentLine({ match_id: "m", kind: "duel", score: null, opponent: "Team Kaktus", outcome: "loss", forfeit: true })).toBe("Verloren gegen Team Kaktus (kampflos)");
  expect(recentLine({ match_id: "m", kind: "heat", rank: 2, field: 6 })).toBe("Platz 2 von 6");
  expect(outcomeLabel({ match_id: "m", kind: "duel", outcome: "win" })).toBe("Sieg");
  expect(outcomeLabel({ match_id: "m", kind: "duel", outcome: "loss" })).toBe("Niederlage");
  expect(outcomeLabel({ match_id: "m", kind: "heat", rank: 1 })).toBe("Platz 1");
});

test("kommende Turniere: Event, Tag und Uhrzeit in Wien", () => {
  const line = upcomingLine({ registration_id: "r", tournament: { event_name: "Herbst-LAN", start_date: "2026-10-17T14:00:00Z" } });
  expect(line).toContain("Herbst-LAN");
  expect(line).toContain("17.10.");
  expect(line).toContain("16:00");
  expect(INVITE_PARAM).toBe("einladung");
});
