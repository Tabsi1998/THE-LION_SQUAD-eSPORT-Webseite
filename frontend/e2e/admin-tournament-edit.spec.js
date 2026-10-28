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
  // Rechte je Turnier (#1353), wie sie der Server der Turnierleitung schickt.
  can_manage_structure: true,
  can_manage_results: true,
  can_manage_all_results: true,
  can_plan_matches: true,
  staff_scopes: [],
  can_check_in: true,
  can_manage_participants: true,
  can_assign_stations: true,
  can_use_staff_tools: true,
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

  // Folgenschwere Aktionen (#2120): die Rückfragen nennen die Zahl der Spiele und passen auf Handy und PC.
  for (const [label, width, height] of [["Handy", 390, 844], ["PC", 1440, 900]]) {
    test(`${label}: Zurücksetzen nennt die Spiele, Absagen fragt nach dem Grund`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockTournament(page, { status: "live" });
      const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      await page.route("**/api/tournaments/t-1/matches-v2**", json([
        { id: "m-1", stage_id: "s-1", status: "completed", round: 1, results: [{ registration_id: "r-1", rank: 1 }], slots: [{ registration_id: "r-1" }, { registration_id: "r-2" }] },
        { id: "m-2", stage_id: "s-1", status: "ready", round: 2, slots: [{ registration_id: "r-1" }, { registration_id: null }] },
      ]));
      await page.route("**/api/tournaments/t-1/registrations**", json([
        { id: "r-1", status: "approved", display_name: "Spieler Eins" },
        { id: "r-2", status: "approved", display_name: "Spieler Zwei" },
      ]));
      const posts = [];
      // Erst ohne force (Review #2120): der Server antwortet mit seinen Zahlen, die Rückfrage zeigt sie.
      await page.route("**/api/tournaments/t-1/reset-bracket**", (route) => {
        const url = route.request().url();
        posts.push(url);
        if (url.includes("force=true")) return json({ ok: true })(route);
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: {
          code: "confirm_destruction", match_count: 2, played_count: 1,
          message: "Zurücksetzen löscht alle Spiele (2 Spiele, davon 1 begonnen oder gewertet) samt Ergebnissen und Berichten. Der Status bleibt.",
        } }) });
      });
      await page.route("**/api/tournaments/t-1/status", (route) => { posts.push(route.request().postDataJSON()); return json({ ok: true, notified: 2 })(route); });
      await page.goto("/admin/tournaments/t-1");
      await expect(page.getByRole("heading", { name: "Winter Cup 2026" })).toBeVisible();

      await page.getByTestId("admin-tr-tools").locator("summary").click();
      await page.getByTestId("admin-tr-reset").click();
      const dialog = page.getByTestId("confirm-dialog");
      await expect(dialog).toContainText("2 Spiele, davon 1 begonnen oder gewertet");
      await expect(page.getByTestId("confirm-dialog-confirm")).toHaveText("2 Spiele löschen");
      await expect(page.getByTestId("confirm-dialog-confirm")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      expect(posts[0]).not.toContain("force=true");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => posts.length).toBe(2);
      expect(posts[1]).toContain("reset-bracket?force=true");

      await page.getByTestId("admin-tr-status-select").selectOption("cancelled");
      await expect(dialog).toContainText("Alle 2 Anmeldungen bekommen eine Nachricht");
      await dialog.getByRole("textbox").fill("Halle nicht verfügbar");
      await expect(page.getByTestId("confirm-dialog-confirm")).toBeInViewport();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect.poll(() => posts.length).toBe(3);
      expect(posts[2]).toMatchObject({ status: "cancelled", reason: "Halle nicht verfügbar" });
    });
  }

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
