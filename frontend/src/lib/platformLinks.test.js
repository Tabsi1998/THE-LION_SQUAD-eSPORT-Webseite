import { PLATFORM_BY_FIELD, linkErrorText, linkForField, linkedText } from "./platformLinks";

// Konten verknüpfen (#260): Feld ↔ Plattform, Fehlercodes aus dem Rückruf in Worten.

test("Felder, Verknüpfung je Feld und Texte", () => {
  expect(PLATFORM_BY_FIELD).toEqual({ discord_name: "discord", twitch_handle: "twitch", steam_id: "steam" });
  const links = [{ platform: "steam", handle: "76561198000000001" }];
  expect(linkForField(links, "steam_id")?.handle).toBe("76561198000000001");
  expect(linkForField(links, "discord_name")).toBeNull();
  expect(linkForField(links, "epic_id")).toBeNull();
  expect(linkedText("discord")).toContain("Discord ist verknüpft");
  expect(linkErrorText("taken")).toMatch(/anderen Profil/);
  expect(linkErrorText("denied")).toMatch(/abgebrochen/);
  expect(linkErrorText("was-auch-immer")).toMatch(/nicht geklappt/);
});
