import { SOCIAL_PLATFORMS, normalizeSocialInput, socialProfileUrl } from "./socials";

// Eingefuegte Adressen werden zum Nutzernamen (#258): Instagram, X, Twitch,
// YouTube und Steam in ihren ueblichen Schreibweisen; alles andere bleibt.

test("eine eingefuegte Adresse und der blosse Nutzername ergeben dasselbe", () => {
  expect(normalizeSocialInput("instagram_handle", "https://www.instagram.com/tabsi.98")).toBe("tabsi.98");
  expect(normalizeSocialInput("instagram_handle", "instagram.com/tabsi.98/?igsh=abc")).toBe("tabsi.98");
  expect(normalizeSocialInput("instagram_handle", "@tabsi.98")).toBe("tabsi.98");
  expect(normalizeSocialInput("instagram_handle", " tabsi.98 ")).toBe("tabsi.98");
});

test("X, Twitch, TikTok und YouTube kennen ihre Adressformen", () => {
  expect(normalizeSocialInput("x_handle", "https://twitter.com/tabsi98")).toBe("tabsi98");
  expect(normalizeSocialInput("x_handle", "https://x.com/tabsi98?s=21")).toBe("tabsi98");
  expect(normalizeSocialInput("twitch_handle", "https://m.twitch.tv/tabsi98")).toBe("tabsi98");
  expect(normalizeSocialInput("tiktok_handle", "https://www.tiktok.com/@tabsi98")).toBe("tabsi98");
  expect(normalizeSocialInput("youtube_handle", "https://www.youtube.com/@LionSquad/videos")).toBe("LionSquad");
  expect(normalizeSocialInput("youtube_handle", "https://youtube.com/c/LionSquad")).toBe("LionSquad");
});

test("Steam unterscheidet Profilnamen und 17-stellige ID", () => {
  expect(normalizeSocialInput("steam_id", "https://steamcommunity.com/id/tabsi98/")).toBe("tabsi98");
  expect(normalizeSocialInput("steam_id", "https://steamcommunity.com/profiles/76561198000000000")).toBe("76561198000000000");
  expect(socialProfileUrl("steam_id", "tabsi98")).toBe("https://steamcommunity.com/id/tabsi98");
  expect(socialProfileUrl("steam_id", "76561198000000000")).toBe("https://steamcommunity.com/profiles/76561198000000000");
});

test("eine fremde Adresse wird nicht zerlegt, IDs ohne Profilseite bleiben unveraendert", () => {
  expect(normalizeSocialInput("instagram_handle", "https://example.com/tabsi")).toBe("https://example.com/tabsi");
  expect(normalizeSocialInput("riot_id", "Tabsi#EUW")).toBe("Tabsi#EUW");
  expect(normalizeSocialInput("nintendo_fc", "SW-1234-5678-9012")).toBe("SW-1234-5678-9012");
  expect(socialProfileUrl("riot_id", "Tabsi#EUW")).toBe("");
  expect(socialProfileUrl("website", "lionsquad.at")).toBe("https://lionsquad.at");
});

test("jede Plattform hat Symbol, Bezeichnung und Feldschluessel", () => {
  for (const platform of SOCIAL_PLATFORMS) {
    expect(platform.icon).toBeTruthy();
    expect(platform.l).toBeTruthy();
    expect(platform.k).toMatch(/^[a-z_]+$/);
  }
  expect(new Set(SOCIAL_PLATFORMS.map((p) => p.k)).size).toBe(SOCIAL_PLATFORMS.length);
});

// Gespeicherte ganze Adressen (vor der Bereinigung eingetragen) dürfen die Vorschau nicht doppelt einpacken.
test("socialProfileUrl macht aus einer gespeicherten Adresse den richtigen Vorschau-Link", () => {
  expect(socialProfileUrl("youtube_handle", "https://www.youtube.com/@Tabsi.98")).toBe("https://www.youtube.com/@Tabsi.98");
  expect(socialProfileUrl("instagram_handle", "https://www.instagram.com/tabsi.98")).toBe("https://instagram.com/tabsi.98");
  expect(socialProfileUrl("twitch_handle", "@tabsi98")).toBe("https://www.twitch.tv/tabsi98");
});

