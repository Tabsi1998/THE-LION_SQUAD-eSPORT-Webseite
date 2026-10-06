import { SOCIAL_ICONS, SOCIAL_PLATFORMS, socialIconFor, socialInk, socialPlatformLabel } from "./socialIcons";

// Vereins-Kanäle: jede Plattform der Auswahl hat ein Symbol und eine Farbe - im Footer, auf den Partnerseiten
// und in der App. Vorher gab es nur acht; „X fehlt“ (Betreiber, 25.09.).

test("jede Plattform der Auswahl hat Farbe und Symbol; X, Threads, Bluesky, Mastodon, Telegram, Kick sind dabei", () => {
  for (const [key] of SOCIAL_PLATFORMS) {
    const icon = SOCIAL_ICONS[key];
    expect(icon, key).toBeTruthy();
    expect(icon.color, key).toMatch(/^#[0-9A-F]{6}$/i);
    expect(icon.hoverClass, key).toContain("hover:");
    expect(Boolean(icon.path || icon.Icon), key).toBe(true);
  }
  for (const key of ["x", "threads", "bluesky", "mastodon", "telegram", "kick", "linkedin", "steam", "website"]) {
    expect(SOCIAL_PLATFORMS.map(([platform]) => platform)).toContain(key);
  }
  expect(socialPlatformLabel("x")).toBe("X (Twitter)");
  expect(socialPlatformLabel("unbekannt")).toBe("unbekannt");
  expect(socialIconFor("Mastodon").color).toBe("#6364FF");
  expect(socialIconFor("gibt-es-nicht")).toBe(SOCIAL_ICONS.custom);
});

// Animierte Social-Logos im Footer (#1083): die Fläche füllt sich in der Markenfarbe - das Logo darauf muss lesbar
// bleiben. Auf sehr hellen Marken (X, Snapchat, Kick) wird es dunkel, sonst weiß; Instagram füllt sich im Verlauf.
test("socialInk: weiß auf kräftigen Farben, dunkel auf sehr hellen; Unbekanntes bleibt weiß", () => {
  for (const key of ["discord", "facebook", "instagram", "youtube", "twitch", "whatsapp", "tiktok"]) {
    expect(socialInk(SOCIAL_ICONS[key].color), key).toBe("#FFFFFF");
  }
  for (const key of ["x", "snapchat", "kick", "threads", "github"]) {
    expect(socialInk(SOCIAL_ICONS[key].color), key).toBe("#0A0A0A");
  }
  expect(socialInk("keine-farbe")).toBe("#FFFFFF");
  expect(socialInk(undefined)).toBe("#FFFFFF");
  expect(SOCIAL_ICONS.instagram.fill).toContain("linear-gradient");
  expect(SOCIAL_ICONS.discord.fill).toBeUndefined();
});
