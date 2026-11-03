import { inheritedServerText, roleNameDefault, serverOptionLabel } from "./GameGeneralTab";

// Reiter Allgemein (#2249) - die Texte für Discord-Server (#626) und Discord-Rolle (#629).
const SERVERS = [
  { guild_id: "1", name: "LION", role: "main", enabled: true, left: false },
  { guild_id: "2", name: "Rocket League", role: "sub", enabled: true, left: false },
  { guild_id: "3", name: "Alt", role: "sub", enabled: false, left: false },
  { guild_id: "4", name: "Weg", role: "sub", enabled: false, left: true },
];

test("Discord-Server: erben in Worten, ausgeschaltet und verlassen gekennzeichnet", () => {
  const games = [{ id: "p", name: "Rocket League", discord_guild_id: "2" }, { id: "q", name: "EA FC", discord_guild_id: "3" }];
  expect(inheritedServerText({ kind: "edition", parent_game_id: "p" }, games, SERVERS)).toBe("geerbt von Rocket League: Rocket League");
  expect(inheritedServerText({ kind: "edition", parent_game_id: "q" }, games, SERVERS)).toBe("Hauptserver: LION");
  expect(inheritedServerText({ kind: "standalone", parent_game_id: "p" }, games, SERVERS)).toBe("Hauptserver: LION");
  expect(serverOptionLabel(SERVERS[0])).toBe("LION (Hauptserver)");
  expect(serverOptionLabel(SERVERS[2])).toBe("Alt – ausgeschaltet");
  expect(serverOptionLabel(SERVERS[3])).toBe("Weg – Bot nicht mehr dort");
});

test("Discord-Rolle: Vorgabe aus Kurzname, sonst Name", () => {
  expect(roleNameDefault({ name: "Call of Duty", short_name: "CoD" })).toBe("CoD-Spieler");
  expect(roleNameDefault({ name: "Rocket League", short_name: "" })).toBe("Rocket League-Spieler");
  expect(roleNameDefault({})).toBe("Spiel-Spieler");
});
