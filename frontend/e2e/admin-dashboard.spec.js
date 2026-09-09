const { test, expect } = require("@playwright/test");

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
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
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
    });
  });
  await page.route("**/api/settings/public", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }),
    });
  });
  await page.route("**/api/settings/auth", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ password_login_enabled: true, google_login_enabled: false, registration_enabled: true }),
    });
  });
  await page.route("**/api/admin/system-status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        database: { ok: true },
        smtp: { ok: true, provider: "resend" },
        discord: { ok: false },
        scheduler: { running: true, jobs: [] },
        mail_queue: { pending: 0, failed: 0 },
      }),
    });
  });
  await page.route("**/api/admin/growth-stats**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ days: [] }) });
  });
}

/**
 * `busy: false` ist der ruhige Betrieb - nichts offen. `busy: true` stellt
 * genau zwei echte Aufgaben scharf: Einsprüche und Mitgliedsanträge.
 */
async function mockDashboard(page, { busy = false } = {}) {
  await page.route("**/api/setup/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ completed: true, health_score: 100, missing: [] }),
    });
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        player_count: 42,
        team_count: 7,
        active_tournaments: 2,
        registration_open: 1,
        today_matches: 3,
        active_f1: 0,
        total_events: 11,
        open_disputes: busy ? 4 : 0,
        membership_applications: { pending: busy ? 2 : 0 },
        tournament_registrations: { pending: 0 },
        prize_pickups: { pending: 0, ready: 0 },
        mobile_push: { active_tokens: 12, ticket_errors: 0, receipt_errors: 0 },
        client_logs: { open: 0, critical_open: 0, high_open: 0 },
        recent_audit_logs: [],
      }),
    });
  });
}

test.describe("admin dashboard layout", () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminSession(page);
  });

  test("offene Aufgaben stehen über den Kennzahlen", async ({ page }) => {
    await mockDashboard(page, { busy: true });
    await page.goto("/admin");

    const tasks = page.getByTestId("dashboard-tasks");
    const kpis = page.getByTestId("dashboard-kpis");
    await expect(tasks).toBeVisible();
    await expect(kpis).toBeVisible();

    const tasksBox = await tasks.boundingBox();
    const kpisBox = await kpis.boundingBox();
    expect(tasksBox.y).toBeLessThan(kpisBox.y);
  });

  test("Schnellzugriff liegt vor den Kennzahlen und dem Wachstumsdiagramm", async ({ page }) => {
    await mockDashboard(page, { busy: true });
    await page.goto("/admin");

    const quick = page.getByTestId("dashboard-quick-actions");
    await expect(quick).toBeVisible();
    await expect(page.getByTestId("quick-new-tournament")).toBeVisible();

    const quickBox = await quick.boundingBox();
    const kpisBox = await page.getByTestId("dashboard-kpis").boundingBox();
    const growthBox = await page.getByTestId("dashboard-growth-widget").boundingBox();
    expect(quickBox.y).toBeLessThan(kpisBox.y);
    expect(kpisBox.y).toBeLessThan(growthBox.y);
  });

  test("nur echte Aufgaben erscheinen in der Aufgabenliste", async ({ page }) => {
    await mockDashboard(page, { busy: true });
    await page.goto("/admin");

    const tasks = page.getByTestId("dashboard-tasks");
    await expect(tasks.getByRole("heading", { name: /offene aufgaben · 2/i })).toBeVisible();
    await expect(tasks.getByRole("link", { name: /ergebnis-konflikte/i })).toBeVisible();
    await expect(tasks.getByRole("link", { name: /mitgliedsanträge/i })).toBeVisible();

    // Routinelinks bleiben in "Weitere Werkzeuge" eingeklappt, statt sich als
    // offene Aufgabe auszugeben.
    const details = tasks.locator("details");
    await expect(details.getByRole("link", { name: /medien-check/i })).toBeHidden();
    await details.locator("summary").click();
    await expect(details.getByRole("link", { name: /medien-check/i })).toBeVisible();
  });

  test("ohne offene Punkte erscheint ein Leerhinweis statt Pseudo-Aufgaben", async ({ page }) => {
    await mockDashboard(page, { busy: false });
    await page.goto("/admin");

    const tasks = page.getByTestId("dashboard-tasks");
    await expect(tasks.getByTestId("dashboard-tasks-empty")).toBeVisible();
    await expect(tasks.getByTestId("dashboard-tasks-empty")).toContainText(/nichts offen/i);
    await expect(tasks.getByRole("heading", { name: /offene aufgaben$/i })).toBeVisible();
  });

  test("Kennzahlen wiederholen keine Aufgabenwerte", async ({ page }) => {
    await mockDashboard(page, { busy: true });
    await page.goto("/admin");

    await expect(page.getByTestId("kpi-Spieler")).toContainText("42");
    await expect(page.getByTestId("kpi-Events Gesamt")).toContainText("11");

    for (const doubled of ["Offene Disputes", "Mitgliedsanträge", "Gewinne offen", "Push aktiv", "Offene Logs"]) {
      await expect(page.getByTestId(`kpi-${doubled}`)).toHaveCount(0);
    }
  });

  test("kein horizontaler Überlauf auf 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDashboard(page, { busy: true });
    await page.goto("/admin");
    await expect(page.getByTestId("dashboard-tasks")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
