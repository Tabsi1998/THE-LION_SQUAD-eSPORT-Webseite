const { test, expect } = require("@playwright/test");

// Erreichbare Erfolge (#2339): Die Erfolge-Seite zeigt angemeldet je Kategorie einen Haken (abgeschlossen) oder „x von y“
// der erreichbaren Stufen; im Admin-Katalog lässt sich eine Gruppe mit Grund auf „nicht mehr erreichbar“ setzen.
// Alles mit Attrappen im Browser, am Handy (390) und am PC (1440). Bilder: E2E_SHOTS_DIR, sonst die Testausgabe.

const path = require("path");

const WIDTHS = [390, 1440];
const CATEGORIES = [
  ["match", "Spielen", "swords", "#29B6E8", 20], ["tournament", "Turnier", "trophy", "#FFD700", 20], ["fastlap", "Fast Lap", "flag", "#A855F7", 8],
  ["season", "Saison", "calendar-days", "#29B6E8", 7], ["team", "Team", "users", "#00FF88", 10], ["community", "Community", "messages-square", "#29B6E8", 20],
  ["creator", "Streaming & Creator", "radio", "#9146FF", 10], ["profile", "Profil & Konto", "user-round", "#00FF88", 15], ["club", "Verein", "crown", "#FFD700", 11],
  ["special", "Besonders", "sparkles", "#FF3B30", 13], ["hidden", "Geheim", "eye-off", "#A855F7", 14],
].map(([key, label, icon, accent, groups], index) => ({
  key, label, icon, accent, order: index + 1, member_only: key === "club", hidden: key === "hidden", groups, tiers: groups * 5, points: groups * 100, awards: 30, holders: 20, community_percent: 1.5, link: "/achievements",
}));
const PROGRESS = {
  match: { earned: 104, total: 104, complete: true }, tournament: { earned: 40, total: 92, complete: false }, fastlap: { earned: 48, total: 48, complete: true },
  season: { earned: 3, total: 37, complete: false }, team: { earned: 0, total: 46, complete: false }, community: { earned: 12, total: 82, complete: false },
  creator: { earned: 5, total: 39, complete: false }, profile: { earned: 34, total: 34, complete: true }, club: { earned: 0, total: 51, complete: false },
  special: { earned: 1, total: 7, complete: false },
};
const OVERVIEW = {
  categories: CATEGORIES,
  rarity: { base: 120, members_base: 30, groups: {}, tiers: {} },
  hidden: { total: 14, earned: 3 },
  week: { week_key: "2026-W45", award: null },
  recent: [],
  mine: { count: 247, points: 9180, categories: { match: 104, tournament: 40, fastlap: 48 }, negative: 0, member: false, category_progress: PROGRESS, categories_complete: 3 },
};
const USER = { id: "u1", username: "pixelpanther", display_name: "PixelPanther", role: "user", is_club_member: false };

async function consent(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
}

async function mockShowcase(page) {
  await consent(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.example" });
    if (url.pathname === "/api/auth/me") return json(USER);
    if (url.pathname === "/api/achievements/overview") return json(OVERVIEW);
    if (url.pathname === "/api/achievements/leaderboard") return json([]);
    if (url.pathname === "/api/achievements/crowns") return json({ crowns: {} });
    if (url.pathname === "/api/achievements/groups") return json([]);
    const list = url.pathname.includes("notifications") || url.pathname.endsWith("/games") || url.pathname.endsWith("/sponsors") || url.pathname.endsWith("/partners");
    return json(list ? [] : {});
  });
}

function shotPath(testInfo, name) {
  return process.env.E2E_SHOTS_DIR ? path.join(process.env.E2E_SHOTS_DIR, name) : testInfo.outputPath(name);
}

test.describe("Erfolge-Seite: Kategorien abschließen (#2339)", () => {
  test("Haken bei abgeschlossenen Kategorien, sonst x von y – Handy und PC", async ({ page }, testInfo) => {
    await mockShowcase(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
      await page.goto("/achievements");
      const section = page.getByTestId("achievements-categories");
      await expect(page.getByTestId("category-progress-match")).toContainText("Abgeschlossen");
      await expect(page.getByTestId("category-complete-match")).toBeVisible();
      await expect(page.getByTestId("category-complete-fastlap")).toBeVisible();
      await expect(page.getByTestId("category-progress-tournament")).toContainText("40 von 92");
      await expect(page.getByTestId("category-complete-tournament")).toHaveCount(0);
      await expect(page.getByTestId("category-progress-special")).toContainText("1 von 7");
      // Review N3: kein Mitglied - der Verein sagt „Nur für Mitglieder“ statt „0 von 51“.
      await expect(page.getByTestId("category-progress-club")).toHaveText("Nur für Mitglieder");
      await expect(page.getByTestId("category-progress-hidden")).toContainText("3 von 14 gefunden");
      await expect(page.getByTestId("categories-caption")).toContainText("was du selbst erreichen kannst");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // Gestaffelt gefüllt und gehakt - die Bilder erst, wenn alles steht.
      await page.waitForTimeout(1600);
      await section.scrollIntoViewIfNeeded();
      const shot = await section.screenshot({ path: shotPath(testInfo, `erfolge-kategorien-${width}.png`) });
      await testInfo.attach(`erfolge-kategorien-${width}.png`, { body: shot, contentType: "image/png" });
    }
  });

  test("reduzierte Bewegung: Haken und Balken stehen sofort", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockShowcase(page);
    await page.goto("/achievements");
    const check = page.getByTestId("category-complete-match");
    await expect(check).toBeVisible();
    expect(await check.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  });
});

const GROUPS = [
  { code: "grand_prix", name: "Grand-Prix-Fahrer", category: "fastlap", description: "Fahr Grand-Prix-Turniere.", public: true, icon: "car", art: "helmet", retired: true, retired_reason: "Das Turnierformat Grand Prix gibt es nicht mehr." },
  { code: "pole", name: "Pole Position", category: "fastlap", description: "Halte die Bestzeit auf einer Strecke.", public: true, icon: "trophy", art: "pole" },
  { code: "pioneer", name: "Pionier", category: "special", is_special: true, description: "Eines der ersten hundert Konten.", public: true, icon: "compass", art: "pioneer", available_until: "2026-03-01T10:00:00+00:00", retired_reason: "Nur die ersten hundert Konten der Plattform – die Plätze sind vergeben." },
  { code: "tournament_staff", name: "Turnierleitung", category: "tournament", description: "Leite Turniere bis zum Ende.", public: true, icon: "clipboard-list", art: "whistle", staff_only: true },
];
const TIERS = [
  { code: "grand_prix_1", group_code: "grand_prix", name: "Grand-Prix-Fahrer I", material: "bronze", rank: 3, points: 20, condition_key: "grand_prix_entries", progress_target: 1, condition_status: "live" },
  { code: "pole_1", group_code: "pole", name: "Pole Position I", material: "wood", rank: 1, points: 5, condition_key: "pole_count", progress_target: 1, condition_status: "live" },
  { code: "pioneer_1", group_code: "pioneer", name: "Pionier I", material: "legendary", rank: 8, points: 250, condition_key: "pioneer_account", progress_target: 1, condition_status: "live" },
  { code: "tournament_staff_1", group_code: "tournament_staff", name: "Turnierleitung I", material: "bronze", rank: 3, points: 20, condition_key: "tournaments_staffed_completed", progress_target: 1, condition_status: "live" },
];

async function mockAdmin(page, calls) {
  await consent(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace(/^.*\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (apiPath === "/auth/me") {
      return json({ id: "admin-1", email: "admin@example.test", display_name: "Chef", username: "chef", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true });
    }
    if (request.method() === "PATCH") {
      calls.push({ path: apiPath, body: request.postDataJSON() });
      return json({ ...GROUPS[1], ...request.postDataJSON() });
    }
    if (request.method() !== "GET") return json({}, 405);
    const table = { "/admin/achievements/me": { board: true }, "/admin/achievements/groups": GROUPS, "/admin/achievements/tiers": TIERS };
    if (apiPath in table) return json(table[apiPath]);
    const list = apiPath.includes("/notifications") || apiPath.endsWith("/games");
    return json(list ? [] : {});
  });
}

test.describe("Admin-Katalog: nicht mehr erreichbar (#2339)", () => {
  test("Schalter mit Pflicht-Grund und „erreichbar bis“ – Handy und PC", async ({ page }, testInfo) => {
    const calls = [];
    await mockAdmin(page, calls);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
      await page.goto("/admin/achievements?tab=catalog");
      await expect(page.getByTestId("group-retired-grand_prix")).toHaveText("nicht mehr erreichbar");
      await expect(page.getByTestId("group-retired-pioneer")).toHaveText("nicht mehr erreichbar");
      await expect(page.getByTestId("group-retired-pole")).toHaveCount(0);
      await page.getByTestId("group-edit-pole").click();
      const sheet = page.getByTestId("group-sheet");
      await expect(sheet).toBeVisible();
      await page.getByTestId("group-retired").check();
      await expect(page.getByTestId("group-retired-reason")).toHaveAttribute("required", "");
      await page.getByTestId("group-retired-reason").fill("Wird nicht mehr gefahren.");
      await page.getByTestId("group-retired-section").scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const shot = await page.screenshot({ path: shotPath(testInfo, `admin-katalog-retired-${width}.png`) });
      await testInfo.attach(`admin-katalog-retired-${width}.png`, { body: shot, contentType: "image/png" });
      await page.getByTestId("group-save").click();
      await expect.poll(() => calls.length).toBe(WIDTHS.indexOf(width) + 1);
      expect(calls[calls.length - 1]).toEqual({ path: "/admin/achievements/groups/pole", body: expect.objectContaining({ retired: true, retired_reason: "Wird nicht mehr gefahren." }) });
      expect(calls[calls.length - 1].body).not.toHaveProperty("available_until");
    }
  });
});
