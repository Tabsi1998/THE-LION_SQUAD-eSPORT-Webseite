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

test("Wappen-Kopf (#1347): Rollen in Alltagsworten, Kapitän zuerst, zwei Buchstaben ohne Bild", async () => {
  const { initials, memberRole, orderedFaces, ROLE_LABELS } = await import("@/lib/teamPage");
  const team = {
    leader_id: "u-cap", co_leader_ids: ["u-co"],
    members: [{ id: "u-1", display_name: "LunaByte" }, { id: "u-co", display_name: "PixelPanther" }, { id: "u-cap", display_name: "NeonFalke" }],
  };
  expect(memberRole(team, { id: "u-cap" })).toBe("captain");
  expect(memberRole(team, { id: "u-co" })).toBe("co_captain");
  expect(memberRole(team, { id: "u-1" })).toBe("player");
  expect(ROLE_LABELS).toEqual({ captain: "Kapitän", co_captain: "Co-Kapitän", player: "Spieler" });
  expect(orderedFaces(team).map((face) => [face.id, face.roleLabel])).toEqual([["u-cap", "Kapitän"], ["u-co", "Co-Kapitän"], ["u-1", "Spieler"]]);
  expect(initials("NeonFalke")).toBe("NF");
  expect(initials("luna byte")).toBe("LB");
  expect(initials("kiwi")).toBe("KI");
  expect(initials("")).toBe("?");
});

test("Team auflösen (#1274): ein Satz nennt Mitglieder, Chat und kommende Anmeldungen; der Name zählt ohne Groß/klein", async () => {
  const { dissolveSentence, sameTeamName } = await import("@/lib/teamPage");
  expect(dissolveSentence({ member_count: 5, chat_messages: 12, withdraw: [{ title: "Herbst-Cup" }] }))
    .toBe("Alle 5 Mitglieder verlieren das Team, der Team-Chat mit 12 Nachrichten wird gelöscht und die Anmeldung für „Herbst-Cup“ wird zurückgezogen. Fertige Turniere und Auszeichnungen bleiben.");
  expect(dissolveSentence({ member_count: 1, chat_messages: 0, withdraw: [] }))
    .toBe("Das Mitglied verliert das Team und der Team-Chat wird gelöscht. Fertige Turniere und Auszeichnungen bleiben.");
  expect(dissolveSentence({ member_count: 3, chat_messages: 1, withdraw: [{ title: "A-Cup" }, { title: "B-Cup" }, { title: "C-Cup" }] }))
    .toContain("die Anmeldungen für „A-Cup“, „B-Cup“ und „C-Cup“ werden zurückgezogen");
  expect(sameTeamName({ name: "Lions Rocket" }, "  lions   ROCKET ")).toBe(true);
  expect(sameTeamName({ name: "Lions Rocket" }, "Lions")).toBe(false);
  expect(sameTeamName({ name: "Lions Rocket" }, "")).toBe(false);
});
