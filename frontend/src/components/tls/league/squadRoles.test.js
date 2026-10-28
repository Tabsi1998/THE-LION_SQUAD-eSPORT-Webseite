import { isLocked, roleChoices, roleOf, rolesSummary } from "./squadRoles";

// Captain und Vertreter je Co-Team (#1649): Anzeige, Auswahl und die Sperre fürs Abwählen. Erfundene Namen.

const MEMBERS = [
  { id: "u1", display_name: "Mila" },
  { id: "u2", username: "tom" },
  { id: "u3", display_name: "Ida" },
];

test("roleOf nennt Captain und Vertreter, sonst nichts", () => {
  const squad = { captain_id: "u1", vice_captain_id: "u2" };
  expect(roleOf(squad, "u1").label).toBe("Captain");
  expect(roleOf(squad, "u2").label).toBe("Vertreter");
  expect(roleOf(squad, "u3")).toBeNull();
  expect(roleOf(null, "u1")).toBeNull();
  expect(isLocked(squad, "u1")).toBe(true);
  expect(isLocked(squad, "u3")).toBe(false);
});

test("roleChoices bietet den Kader ohne die Person der anderen Rolle an", () => {
  const squad = { captain_id: "u1", vice_captain_id: "u2" };
  expect(roleChoices(["u1", "u2", "u3"], MEMBERS, "captain_id", squad).map((p) => p.id)).toEqual(["u1", "u3"]);
  expect(roleChoices(["u1", "u2", "u3"], MEMBERS, "vice_captain_id", squad).map((p) => p.id)).toEqual(["u2", "u3"]);
  expect(roleChoices(["u3", "fremd"], MEMBERS, "captain_id", {})).toEqual([{ id: "u3", name: "Ida" }]);
});

test("rolesSummary sagt, wer handelt - ohne Rollen die Teamleitung", () => {
  expect(rolesSummary({ captain_id: "u1", vice_captain_id: "u2" }, MEMBERS)).toBe("Captain: Mila · Vertreter: tom");
  expect(rolesSummary({ captain_id: "u1" }, MEMBERS)).toBe("Captain: Mila");
  expect(rolesSummary({}, MEMBERS)).toBe("Ohne Captain – im Liga-Spiel handelt die Teamleitung.");
  expect(rolesSummary({ captain_id: "weg" }, MEMBERS)).toBe("Captain: nicht mehr im Kader");
});
