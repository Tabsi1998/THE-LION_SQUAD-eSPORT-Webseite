const { test, expect } = require("@playwright/test");
const { routeFakeUploads } = require("./fixtures/fakeUploads");

// Erfolge-Seite am Handy (#1229): beim ersten Laden höchstens vier Bildschirme lang, kein ganzer Katalog (nur Übersicht
// und zehn Plätze der Bestenliste); eine Kategorie aufklappen zeigt ihre Abzeichen in unter einer Sekunde.
// Die Übertragung zählt hier nur, was die Seite selbst holt (Daten, Bilder, Schriften) - die Programmdateien liefert im
// Test der Entwicklungsserver ungebündelt; ihre Größe im Betrieb zeigt der Build.

const VIEWPORT = { width: 390, height: 844 };
const CATEGORIES = [
  ["match", "Spielen", "swords", "#29B6E8", 20, 104], ["tournament", "Turnier", "trophy", "#FFD700", 20, 102], ["fastlap", "Fast Lap", "flag", "#A855F7", 9, 53],
  ["season", "Saison", "calendar-days", "#29B6E8", 7, 37], ["team", "Team", "users", "#00FF88", 10, 46], ["community", "Community", "messages-square", "#29B6E8", 21, 97],
  ["creator", "Streaming & Creator", "radio", "#9146FF", 10, 44], ["profile", "Profil & Konto", "user-round", "#00FF88", 15, 53], ["club", "Verein", "crown", "#FFD700", 12, 52],
  ["special", "Besonders", "sparkles", "#FF3B30", 16, 16], ["hidden", "Geheim", "eye-off", "#A855F7", 14, 14],
].map(([key, label, icon, accent, groups, tiers], index) => ({
  key, label, icon, accent, order: index + 1, member_only: key === "club", hidden: key === "hidden", groups, tiers, points: tiers * 20, awards: 30, holders: 20, community_percent: 1.5, link: "/achievements",
}));

function groupsOf(category, count) {
  return Array.from({ length: count }, (_, index) => ({
    code: `${category}_${index}`, name: `Gruppe ${index + 1}`, category, icon: "trophy", art: "trophy", accent_color: "#29B6E8", description: "Beschreibung der Gruppe.", public: true,
    tier_count: 5, earned_count: 0,
    tiers: Array.from({ length: 5 }, (__, rank) => ({ code: `${category}_${index}_${rank}`, rank: rank + 1, level: Math.min(4, rank + 1), name: `Stufe ${rank + 1}`, description: "Schaffe etwas.", points: 10 * (rank + 1),
      material: "wood", material_name: "Holz", material_color: "#A0703C", earned: false, current: 0, target: 10, percent: 0, manual_only: false, member_only: false })),
  }));
}

const OVERVIEW = {
  categories: CATEGORIES,
  rarity: { base: 120, members_base: 30, groups: {}, tiers: {} },
  hidden: { total: 14, earned: 0 },
  week: { week_key: "2026-W40", award: { award_id: "aw-1", tier_code: "match_0_2", name: "Stufe 3", group_name: "Gruppe 1", material: "gold", material_name: "Gold", material_color: "#FFD700", icon: "trophy",
          holders: 2, percent: 1.7, earned_at: "2026-09-30T18:00:00+00:00", user: { id: "u1", username: "pixelpanther", display_name: "PixelPanther", avatar_url: "/api/static/uploads/avatar-week.png" } } },
  recent: Array.from({ length: 6 }, (_, index) => ({ award_id: `r${index}`, tier_code: `match_0_${index % 5}`, name: `Stufe ${index + 1}`, material_name: "Holz", material_color: "#A0703C", user: { id: `u${index}`, username: `spieler${index}`, display_name: `Spieler ${index}` } })),
};

// Profilbilder in voller Größe (2048 px) - die Seite soll die kleine Fassung holen (#1227).
const BOARD = Array.from({ length: 10 }, (_, index) => ({ user_id: `u${index}`, username: `spieler${index}`, display_name: `Spieler ${index + 1}`, avatar_url: `/api/static/uploads/avatar-${index}.png`,
  count: 40 - index, points: 2000 - 50 * index, level: 12 - index, prestige: 0, rank: index + 1 }));

async function mockAchievements(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const apiCalls = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" });
    if (url.pathname === "/api/auth/me") return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    // Fußzeile wie im Betrieb: Sponsoren- und Partner-Band zählen zur Seitenlänge.
    if (url.pathname === "/api/sponsors") return json([1, 2, 3].map((index) => ({ id: `s${index}`, name: `Sponsor ${index}`, tier: "gold", logo_url: `/api/static/uploads/sponsor-${index}.png`, link: "https://sponsor.example.test" })));
    if (url.pathname === "/api/partners") return json([1, 2, 3].map((index) => ({ id: `p${index}`, slug: `partner-${index}`, name: `Partner ${index}`, logo_url: `/api/static/uploads/partner-${index}.png`, channels: [] })));
    if (url.pathname.startsWith("/api/achievements/")) apiCalls.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/api/achievements/overview") return json(OVERVIEW);
    if (url.pathname === "/api/achievements/leaderboard") return json(BOARD.slice(0, Number(url.searchParams.get("limit") || 24)));
    if (url.pathname === "/api/achievements/groups") {
      const category = url.searchParams.get("category");
      const row = CATEGORIES.find((item) => item.key === category);
      return json(row ? groupsOf(category, row.groups) : CATEGORIES.flatMap((item) => groupsOf(item.key, item.groups)));
    }
    if (url.pathname === "/api/achievements/crowns") return json({ crowns: {} });
    if (url.pathname.startsWith("/api/static/uploads/")) return route.fallback();
    return route.abort();
  });
  return apiCalls;
}

test.describe("Erfolge-Seite am Handy", () => {
  test.use({ viewport: VIEWPORT });

  test("höchstens vier Bildschirme, kein ganzer Katalog, Aufklappen in unter einer Sekunde", async ({ page }) => {
    const uploads = await routeFakeUploads(page);
    const apiCalls = await mockAchievements(page);
    const bytes = { own: 0 };
    page.on("response", async (response) => {
      const type = response.request().resourceType();
      if (!["image", "font", "fetch", "xhr"].includes(type)) return;
      try { bytes.own += (await response.body()).length; } catch { /* abgebrochene Anfrage */ }
    });
    await page.goto("/achievements");
    await expect(page.getByTestId("category-row-tournament")).toBeVisible();
    await expect(page.getByTestId("leaderboard-row-10")).toBeAttached();
    await page.waitForLoadState("networkidle");

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height, `Seitenhöhe ${height} px`).toBeLessThanOrEqual(4 * VIEWPORT.height);
    expect(apiCalls.some((call) => call.startsWith("/api/achievements/groups"))).toBe(false);
    expect(apiCalls.some((call) => call.startsWith("/api/achievements/me"))).toBe(false);
    expect(apiCalls).toContain("/api/achievements/leaderboard?limit=10&by=points");
    expect(bytes.own, `geladen ${Math.round(bytes.own / 1024)} KB`).toBeLessThan(600 * 1024);
    // Profilbilder der Bestenliste in der kleinen Fassung, nie das Original.
    const avatars = uploads.filter((entry) => entry.name.startsWith("avatar-"));
    expect(avatars.length).toBeGreaterThan(0);
    for (const entry of avatars) expect(entry.w, entry.path).toBe(160);
    // Abzeichen gibt es erst nach dem Aufklappen.
    expect(await page.locator("[data-testid^='achievement-group-']").count()).toBe(0);

    const started = Date.now();
    await page.getByTestId("category-toggle-tournament").click();
    await expect(page.getByTestId("achievement-group-tournament_0")).toBeVisible();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(apiCalls).toContain("/api/achievements/groups?category=tournament");
    expect(await page.locator("[data-testid^='achievement-group-'][data-testid$='_0']").count()).toBe(1);
  });
});
