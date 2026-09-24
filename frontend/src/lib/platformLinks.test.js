import { PLATFORM_BY_FIELD, linkErrorText, linkForField, linkedText } from "./platformLinks";

// Konten verknüpfen (#260): Feld ↔ Plattform, Fehlercodes aus dem Rückruf in Worten.

test("Felder, Verknüpfung je Feld und Texte", () => {
  // Zehn Plattformen per Anmeldung; PSN, Nintendo, EA und Instagram bleiben getippt (Konten verknüpfen II).
  expect(PLATFORM_BY_FIELD).toMatchObject({ discord_name: "discord", twitch_handle: "twitch", steam_id: "steam", battlenet_id: "battlenet", x_handle: "x", youtube_handle: "youtube", tiktok_handle: "tiktok", riot_id: "riot", xbox_id: "xbox", epic_id: "epic" });
  expect(PLATFORM_BY_FIELD.psn_id).toBeUndefined();
  // Welle 1 von Konten verknüpfen III (#547): neun weitere per Anmeldung.
  expect(PLATFORM_BY_FIELD).toMatchObject({ faceit_handle: "faceit", startgg_handle: "startgg", roblox_handle: "roblox", osu_handle: "osu", lichess_handle: "lichess", github_handle: "github", kick_handle: "kick", reddit_handle: "reddit", spotify_handle: "spotify" });
  const links = [{ platform: "steam", handle: "76561198000000001" }];
  expect(linkForField(links, "steam_id")?.handle).toBe("76561198000000001");
  expect(linkForField(links, "discord_name")).toBeNull();
  expect(linkForField(links, "epic_id")).toBeNull();
  expect(linkForField(links, "psn_id")).toBeNull();
  expect(linkedText("discord")).toContain("Discord ist verknüpft");
  expect(linkErrorText("taken")).toMatch(/anderen Profil/);
  expect(linkErrorText("denied")).toMatch(/abgebrochen/);
  expect(linkErrorText("was-auch-immer")).toMatch(/nicht geklappt/);
});
