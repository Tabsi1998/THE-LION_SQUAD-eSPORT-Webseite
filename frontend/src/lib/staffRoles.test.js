import { staffRoleRights, staffRoleSentence, staffRolesSentence } from "./staffRoles";

// Helfer-Rollen in Worten (#1384): dieselben Sätze wie der Server (services/tournament_permissions.staff_role_sentence).

test("je Rolle ein Satz aus der Liste des Servers", () => {
  expect(staffRoleSentence("scorekeeper")).toBe("Darf hier: Teilnehmer, Ergebnisse und Check-in.");
  expect(staffRoleSentence("organizer")).toBe("Darf hier: Ablauf und Baum, Teilnehmer, Ergebnisse, Check-in und Stationen.");
  expect(staffRoleSentence("station_manager")).toBe("Darf hier: Ergebnisse, Check-in und Stationen.");
  expect(staffRoleSentence("stream_operator")).toMatch(/^Darf hier nur ansehen/);
  expect(staffRoleRights("scorekeeper")).not.toContain("Ablauf und Baum");
  expect(staffRoleSentence("gibt-es-nicht")).toBe("");
});

test("mehrere Rollen: ein Satz mit allem, was eine davon darf", () => {
  expect(staffRolesSentence(["scorekeeper", "station_manager"])).toBe("Darf hier: Teilnehmer, Ergebnisse, Check-in und Stationen.");
  expect(staffRolesSentence(["stream_operator"])).toMatch(/^Darf hier nur ansehen/);
  expect(staffRolesSentence([])).toBe("");
});
