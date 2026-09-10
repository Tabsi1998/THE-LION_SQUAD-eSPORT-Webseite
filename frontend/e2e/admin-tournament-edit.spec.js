const { test, expect } = require("@playwright/test");

// Der Kopf der Turnierseite trug dreizehn Bedienelemente in einer Reihe. Am
// Telefon wurde daraus eine Wand aus Knöpfen, bevor überhaupt ein Reiter
// sichtbar war. Diese Tests prüfen die Bedienbarkeit im echten Browser - die
// Aufteilung selbst ist in AdminTournamentEditPage.test.jsx festgehalten.

const TOURNAMENT = {
  id: "t-1",
  slug: "winter-cup",
  title: "Winter Cup 2026",
  status: "registration_open",
  format: "single_elim",
  team_mode: "solo",
  max_participants: 16,
  can_manage_structure: true,
};

async function mockAdminSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true,
      external_media: false,
      analytics: false,
      meta: false,
      tiktok: false,
      saved_at: Date.now(),
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "admin-1",
      email: "admin@example.test",
      display_name: "Admin",
      username: "admin",
      role: "superadmin",
      is_tournament_staff: true,
      mfa_enabled: true,
      auth_mfa_verified: true,
    }),
  }));
  await page.route("**/api/settings/public", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }),
  }));
}

async function mockTournament(page, overrides = {}) {
  const tournament = { ...TOURNAMENT, ...overrides };
  const empty = (route) => route.fulfill({ contentType: "application/json", body: "[]" });

  await page.route("**/api/tournaments/t-1/registrations**", empty);
  await page.route("**/api/tournaments/t-1/bracket**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rounds: [] }),
  }));
  await page.route("**/api/tournaments/t-1/stages**", empty);
  await page.route("**/api/tournaments/t-1/matches-v2**", empty);
  await page.route("**/api/tournaments/t-1/groups**", empty);
  await page.route("**/api/tournaments/t-1/staff**", empty);
  await page.route("**/api/stations**", empty);
  await page.route("**/api/users**", empty);
  await page.route("**/api/teams**", empty);
  await page.route("**/api/games**", empty);
  await page.route("**/api/events**", empty);
  await page.route("**/api/access-links**", empty);
  await page.route("**/api/tournaments/t-1?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(tournament),
  }));
}

test.describe("Turnierseite: Kopf und Werkzeuge", () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminSession(page);
  });

  test("Werkzeuge und Downloads liegen eingeklappt hinter ihrer Beschriftung", async ({ page }) => {
    await mockTournament(page);
    await page.goto("/admin/tournaments/t-1");
    await expect(page.getByRole("heading", { name: "Winter Cup 2026" })).toBeVisible();

    await expect(page.getByTestId("admin-tr-primary-action")).toBeVisible();
    await expect(page.getByTestId("admin-tr-download-participants")).toBeHidden();

    await page.getByTestId("admin-tr-downloads").locator("summary").click();
    await expect(page.getByTestId("admin-tr-download-participants")).toBeVisible();

    await page.getByTestId("admin-tr-tools").locator("summary").click();
    await expect(page.getByTestId("admin-tr-planning-check")).toBeVisible();
  });

  test("der Kopf läuft am Telefon nicht über", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockTournament(page);
    await page.goto("/admin/tournaments/t-1");
    await expect(page.getByRole("heading", { name: "Winter Cup 2026" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("am Telefon sind die Reiter ohne langes Scrollen erreichbar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockTournament(page);
    await page.goto("/admin/tournaments/t-1");
    await expect(page.getByRole("heading", { name: "Winter Cup 2026" })).toBeVisible();

    // Die Reiter sind der Einstieg in die Arbeit. Vorher lagen sie bei 1290 px:
    // die Speziallink-Tafel allein war offen 696 px hoch, mehr als doppelt so
    // viel wie der Kopf. Eingeklappt sind es 78 px, und die Reiter beginnen bei
    // 673 px. Die Schranke lässt Luft für Schriftgrößen, schlägt aber an, wenn
    // wieder ein ganzer Block dazwischenrutscht.
    const tabs = page.getByTestId("admin-tr-tab-participants");
    const box = await tabs.boundingBox();
    expect(box.y).toBeLessThan(800);
  });
});
