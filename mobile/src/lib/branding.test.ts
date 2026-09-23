import { brandingFromSettings, DEFAULT_BRANDING, DEFAULT_CLUB_NAME } from "./branding";

// Markenbilder aus den Einstellungen (#229): dunkle Fassung zuerst wie im Web, leer heißt eingebaut.

test("ohne Einstellungen gelten die eingebauten Werte", () => {
  expect(DEFAULT_BRANDING.loaded).toBe(false);
  const empty = brandingFromSettings(null);
  expect(empty).toEqual({ clubName: DEFAULT_CLUB_NAME, logoUrl: "", mascotUrl: "", loaded: true });
  expect(brandingFromSettings({ club_name: "   " }).clubName).toBe(DEFAULT_CLUB_NAME);
});

test("die Fassung für dunklen Hintergrund kommt zuerst, das Maskottchen fällt aufs Logo zurück", () => {
  const branding = brandingFromSettings({
    club_name: " LION e.V. ",
    logo_url: "/api/static/uploads/std.png",
    logo_dark_url: "/api/static/uploads/dark.png",
    logo_light_url: "/api/static/uploads/light.png",
  });
  expect(branding.clubName).toBe("LION e.V.");
  expect(branding.logoUrl).toContain("/api/static/uploads/dark.png");
  expect(branding.mascotUrl).toContain("/api/static/uploads/dark.png");
  expect(branding.loaded).toBe(true);

  const withMascot = brandingFromSettings({ mascot_url: "https://cdn.example/m.png", logo_url: "/api/static/uploads/std.png" });
  expect(withMascot.mascotUrl).toBe("https://cdn.example/m.png");
  expect(withMascot.logoUrl).toContain("/api/static/uploads/std.png");
});
