const { test, expect } = require("@playwright/test");

// Das Adminmenü führt 34 Einträge in 6 Gruppen. Offen ergab das eine 1689 px
// hohe Liste, von der bei 1440x900 zwölf Einträge gleichzeitig sichtbar waren -
// und wer auf einer Seite weit unten stand, sah im Menü nicht, wo er ist: die
// Liste blieb oben stehen.

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
  await page.route("**/api/setup/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ completed: true, health_score: 100, missing: [] }),
  }));
  await page.route("**/api/admin/dashboard", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ recent_audit_logs: [] }),
  }));
  await page.route("**/api/admin/growth-stats**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ days: [] }),
  }));
  await page.route("**/api/admin/system-status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ database: { ok: true }, smtp: { ok: true }, discord: { ok: false }, scheduler: { running: true, jobs: [] }, mail_queue: { pending: 0, failed: 0 } }),
  }));
  await page.route("**/api/mobile/push/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
}

function navMetrics(page) {
  return page.evaluate(() => {
    const nav = document.querySelector("nav.admin-scroll");
    const navBox = nav.getBoundingClientRect();
    const links = [...nav.querySelectorAll("a")];
    const active = nav.querySelector("[aria-current='page']");
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.top >= navBox.top - 1 && r.bottom <= navBox.bottom + 1;
    };
    return {
      entries: links.length,
      contentHeight: Math.round(nav.scrollHeight),
      visibleHeight: Math.round(nav.clientHeight),
      activeLabel: active ? active.textContent.trim() : null,
      activeInView: active ? inView(active) : null,
    };
  });
}

test.describe("Adminmenü", () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("beim ersten Besuch ist nur die aktuelle Gruppe offen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();

    await expect(page.getByTestId("admin-nav-group-Übersicht")).toHaveAttribute("aria-expanded", "true");
    for (const group of ["Mitglieder", "eSports", "Content", "Verein", "System"]) {
      await expect(page.getByTestId(`admin-nav-group-${group}`)).toHaveAttribute("aria-expanded", "false");
    }

    // Alle sechs Gruppennamen sind da; die Liste passt jetzt in den Bereich.
    const metrics = await navMetrics(page);
    expect(metrics.contentHeight).toBeLessThanOrEqual(metrics.visibleHeight);
  });

  test("eine Gruppe lässt sich öffnen und der Zustand überlebt das Neuladen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();

    const esports = page.getByTestId("admin-nav-group-eSports");
    await expect(page.getByTestId("admin-nav-tournaments")).toBeHidden();
    await esports.click();
    await expect(page.getByTestId("admin-nav-tournaments")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await expect(page.getByTestId("admin-nav-tournaments")).toBeVisible();
  });

  test("wer tief unten landet, sieht seinen Eintrag im Menü", async ({ page }) => {
    await page.goto("/admin/mobile-push");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();

    await expect(page.getByTestId("admin-nav-group-System")).toHaveAttribute("aria-expanded", "true");
    const metrics = await navMetrics(page);
    expect(metrics.activeLabel).toBe("Push-Tests");
    expect(metrics.activeInView).toBe(true);
  });

  test("die Suche zeigt Treffer aus zugeklappten Gruppen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await expect(page.getByTestId("admin-nav-sponsors")).toBeHidden();

    await page.getByTestId("admin-nav-search").fill("sponsor");

    await expect(page.getByTestId("admin-nav-sponsors")).toBeVisible();
    await expect(page.getByTestId("admin-nav-group-Verein")).toHaveAttribute("aria-expanded", "true");
  });

  test("am Telefon bleibt das Menü im Schubfach bedienbar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeHidden();

    await page.getByTestId("admin-menu-open").click();
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await expect(page.getByTestId("admin-nav-group-eSports")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
