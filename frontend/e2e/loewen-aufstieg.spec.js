const { test, expect } = require("@playwright/test");

// Löwen-Rang: Aufstiegs-Moment (#1456). Die Zeremonie-Vorschau im Admin spielt einen Level-Aufstieg ab: Rangwechsel
// (alter Rahmen blitzt weg, neuer rastet ein, großer Moment der Signatur), Level im Rang (Raute springt auf) und
// „weniger Bewegung“ (nur Ein- und Ausblenden, keine Leinwand). Admin-Konto und API sind Attrappen im Browser.

async function mockAdminSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true }),
    });
  });
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, contentType: "application/json", body: "{}" });
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/api/auth/me")) return route.fallback();
    const list = path.includes("/notifications") || path.endsWith("/games") || path.includes("/achievements/groups") || path.includes("/achievements/tiers");
    return route.fulfill({ status: 200, contentType: "application/json", body: list ? "[]" : "{}" });
  });
}

async function playLevel(page, level) {
  await page.getByTestId("ceremony-sequence").selectOption("levelup");
  await page.getByTestId("ceremony-level").selectOption(String(level));
  await page.getByTestId("ceremony-play").click();
  await expect(page.getByTestId("achievement-unlock-overlay")).toBeVisible();
}

test.describe("Löwen-Rang: Aufstiegs-Moment", () => {
  test("Rangwechsel, Level im Rang und weniger Bewegung", async ({ page }, testInfo) => {
    await mockAdminSession(page);
    await page.goto("/admin/achievements/preview");
    await expect(page.getByTestId("achievement-preview-page")).toBeVisible();
    // Die Vorschau startet mit der Einstellung des Systems - für den Test mit Bewegung.
    const reducedToggle = page.getByTestId("ceremony-reduced");
    if ((await reducedToggle.getAttribute("aria-pressed")) === "true") await reducedToggle.click();

    // Rangwechsel 24 → 25: Silbermähne → Goldmähne
    await playLevel(page, 25);
    const ascent = page.getByTestId("loewen-ascent");
    await expect(ascent).toHaveAttribute("data-kind", "rank");
    await expect(ascent).toHaveAttribute("data-fx", "gold");
    await expect(ascent).toHaveAttribute("data-motion", "full");
    await expect(page.getByTestId("loewen-ascent-old")).toHaveAttribute("data-rank", "5");
    await expect(ascent.locator(".tls-lvf")).toHaveAttribute("data-rank", "6");
    await expect(page.getByTestId("ceremony-sub")).toHaveText(/Neuer Rang: Goldmähne/i);
    const canvas = page.getByTestId("loewen-signature");
    await expect(canvas).toHaveAttribute("data-burst", "strong");
    await expect(canvas).toHaveAttribute("data-signature", "gold");
    await page.waitForTimeout(700);
    await testInfo.attach("aufstieg-rang-goldmaehne.png", { body: await page.getByTestId("ceremony-stage").screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("achievement-unlock-overlay")).toHaveCount(0);

    // Level im Rang 26 → 27: die zweite Raute springt auf, kleiner Moment
    await playLevel(page, 27);
    await expect(ascent).toHaveAttribute("data-kind", "level");
    await expect(ascent.locator(".tls-lvf-pip.is-pop")).toHaveCount(1);
    await expect(page.getByTestId("loewen-ascent-old")).toHaveCount(0);
    await expect(page.getByTestId("loewen-signature")).toHaveAttribute("data-burst", "small");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("achievement-unlock-overlay")).toHaveCount(0);

    // Weniger Bewegung: nur Ein- und Ausblenden - keine Leinwand, keine springenden Rauten
    await reducedToggle.click();
    await expect(reducedToggle).toHaveAttribute("aria-pressed", "true");
    await playLevel(page, 55);
    await expect(ascent).toHaveAttribute("data-kind", "rank");
    await expect(ascent).toHaveAttribute("data-motion", "calm");
    await expect(ascent.locator(".tls-lvf")).toHaveClass(/tls-lvf--ascent-calm/);
    await expect(ascent.locator("canvas")).toHaveCount(0);
    await expect(page.getByTestId("ceremony-particles")).toHaveCount(0);
  });
});
