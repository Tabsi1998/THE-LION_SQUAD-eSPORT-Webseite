const { test, expect } = require("@playwright/test");

// Jahreswertung ohne Saison (#1222): ein Gast sieht bei 390 px einen Satz für alle - nie die Anleitung für die
// Verwaltung. Die API ist nachgestellt.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

test.describe("Jahreswertung ohne Saison", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("Gast bei 390 px: der Satz für alle, keine Verwaltungs-Anleitung", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/seasons/active/featured") return route.fulfill(json({ season: null, standings: [] }));
      if (path === "/api/seasons") return route.fulfill(json([]));
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
      return route.abort();
    });
    await page.goto("/seasons/current");
    await expect(page.getByTestId("season-none")).toHaveText("Die Jahreswertung startet mit dem nächsten Turnier.");
    await expect(page.getByTestId("season-admin-guide")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Admin-Bereich");
    await expect(page.locator("body")).not.toContainText("setze sie auf aktiv");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await testInfo.attach("jahreswertung-gast-390.png", { body: await page.screenshot(), contentType: "image/png" });
  });
});
