const { test, expect } = require("@playwright/test");

// Dreizehn Reiter, davon fünf zum Mailversand. Die Gruppen sagen, wozu ein
// Reiter gehört; dieser Test prüft, dass sie im echten Browser stehen und dass
// die Seite am Telefon nicht quer läuft - die Mail-Queue zeigt eine breite
// Tabelle.

async function mockSettings(page) {
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
  const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/auth/me", (r) => r.fulfill(json({
    id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin",
    role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true,
  })));
  await page.route("**/api/settings/public", (r) => r.fulfill(json({ club_name: "THE LION SQUAD" })));
  await page.route("**/api/settings/auth", (r) => r.fulfill(json({ password_login_enabled: true, google_login_enabled: false, registration_enabled: true })));
  await page.route("**/api/settings/email/logs**", (r) => r.fulfill(json([])));
  await page.route("**/api/settings/email", (r) => r.fulfill(json({ enabled: true, sender_name: "THE LION SQUAD", sender_email: "noreply@lionsquad.at" })));
  await page.route("**/api/settings/branding", (r) => r.fulfill(json({ club_name: "THE LION SQUAD" })));
  await page.route("**/api/settings/discord", (r) => r.fulfill(json({ enabled: false })));
  await page.route("**/api/settings/smtp", (r) => r.fulfill(json({ smtp_host: "mail.example.test" })));
  await page.route("**/api/settings/mail-queue/stats", (r) => r.fulfill(json({ due_pending: 0 })));
  await page.route("**/api/settings/mail-queue**", (r) => r.fulfill(json([])));
  await page.route("**/api/settings/site-banners/admin", (r) => r.fulfill(json([])));
  await page.route("**/api/admin/system-status", (r) => r.fulfill(json({
    database: { ok: true }, smtp: { ok: true }, discord: { ok: false },
    scheduler: { running: true, jobs: [] }, mail_queue: { pending: 0, failed: 0 },
  })));
  await page.route("**/api/admin/streams/status", (r) => r.fulfill(json({})));
  await page.route("**/api/admin/discord/counters**", (r) => r.fulfill(json([])));
}

test.describe("Einstellungen", () => {
  test.beforeEach(async ({ page }) => {
    await mockSettings(page);
  });

  test("die fünf Mail-Reiter stehen zusammen in ihrer Gruppe", async ({ page }) => {
    await page.goto("/admin/settings?tab=email");
    await expect(page.getByTestId("settings-tabs")).toBeVisible();

    const mail = page.getByTestId("settings-group-E-Mail");
    await expect(mail).toBeVisible();
    for (const key of ["email", "smtp", "newsletter", "queue", "logs"]) {
      await expect(mail.getByTestId(`settings-tab-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId("settings-group-Auftritt")).toBeVisible();
    await expect(page.getByTestId("settings-group-Zugang")).toBeVisible();
  });

  test("die Seite läuft am Telefon nicht quer, auch nicht bei der Mail-Queue", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/settings?tab=queue");
    await expect(page.getByTestId("settings-tabs")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
