const { test, expect } = require("@playwright/test");

/**
 * Admin-Formulare bei drei Breiten (#436): die Editor-Seite (Turnier neu, Event neu) und das
 * Seitenblatt (Partner) müssen am PC, am Tablet und am Handy gleich gut gehen - kein Querlauf,
 * Speichern ohne Scrollen im Bild, Seitenleiste am PC rechts und darunter unter dem Inhalt, das
 * Blatt am PC neben der Liste und am Handy Vollbild. Screenshots je Breite hängen am Lauf.
 */

const WIDTHS = [
  ["pc", 1920, 1080],
  ["tablet", 1024, 1366],
  ["handy", 390, 844],
];

async function mockAdminSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/auth/me", (route) => route.fulfill(json({
    id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin",
    role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true,
  })));
  await page.route("**/api/settings/public", (route) => route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" })));
  await page.route("**/api/games", (route) => route.fulfill(json([{ id: "game-1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8" }])));
  // Playwright prüft die zuletzt eingetragene Route zuerst - die genauere Meta-Route kommt daher nach der Liste.
  await page.route("**/api/events**", (route) => route.fulfill(json([])));
  await page.route("**/api/events/meta", (route) => route.fulfill(json({
    types: [{ k: "general", l: "Allgemein" }], statuses: [{ k: "draft", l: "Entwurf" }], visibilities: [{ k: "public", l: "Öffentlich" }],
  })));
  await page.route("**/api/sponsors/admin", (route) => route.fulfill(json([])));
  await page.route("**/api/tournaments**", (route) => route.fulfill(json([])));
  await page.route("**/api/f1/challenges**", (route) => route.fulfill(json([])));
  await page.route("**/api/partners/admin", (route) => route.fulfill(json([
    { id: "p1", name: "Gamers Heaven", kind: "Messe", is_active: true },
  ])));
}

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
  });
}

async function attachScreenshot(page, name) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
      await mockAdminSession(page);
    });

    test("Editor-Seite Turnier: kein Querlauf, Speichern im Bild, Seitenleiste am richtigen Platz", async ({ page }) => {
      await page.goto("/admin/tournaments/new");
      await expect(page.getByRole("heading", { name: /neues turnier/i })).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
      await expect(page.getByTestId("new-tr-submit")).toBeInViewport();
      await expect(page.getByTestId("admin-form-cancel")).toBeInViewport();

      const main = await page.getByTestId("admin-form-main").boundingBox();
      const aside = await page.getByTestId("admin-form-aside").boundingBox();
      if (width >= 1280) {
        expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
      } else {
        expect(aside.y).toBeGreaterThanOrEqual(main.y + main.height - 1);
        expect(Math.abs(aside.width - main.width)).toBeLessThanOrEqual(2);
      }
      await attachScreenshot(page, `turnier-neu-${label}`);
    });

    test("Editor-Seite Event: Pflichtfelder sichtbar, Speichern ohne Scrollen erreichbar", async ({ page }) => {
      await page.goto("/admin/events/new");
      await expect(page.getByRole("heading", { name: /neues event/i })).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
      await expect(page.getByTestId("event-name")).toBeVisible();
      await expect(page.getByTestId("event-save")).toBeInViewport();
      // Ein leeres Pflichtfeld hält den Browser auf, nicht erst der Server.
      await page.getByTestId("event-save").click();
      const invalid = await page.getByTestId("event-name").evaluate((node) => !node.checkValidity());
      expect(invalid).toBe(true);
      await attachScreenshot(page, `event-neu-${label}`);
    });

    test("Seitenblatt Partner: am PC neben der Liste, am Handy Vollbild, Esc schließt", async ({ page }) => {
      await page.goto("/admin/partners");
      await expect(page.getByText("Gamers Heaven")).toBeVisible();
      await page.getByTestId("partner-new").click();
      const sheet = page.getByTestId("partner-sheet");
      await expect(sheet).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
      const box = await sheet.boundingBox();
      if (width >= 640) {
        expect(box.width).toBeLessThanOrEqual(36 * 16 + 2);
        expect(box.x).toBeGreaterThan(0);
      } else {
        expect(Math.abs(box.width - width)).toBeLessThanOrEqual(2);
      }
      await expect(page.getByTestId("partner-save")).toBeInViewport();
      await attachScreenshot(page, `partner-blatt-${label}`);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    });
  });
}
