const { test, expect } = require("@playwright/test");

// Leere Seiten und Fehler mit dem Löwen (#1325): 404 (Löwe mit Lupe) und eine leere Turnierliste (schlafender Löwe)
// bei 390, 768, 1440 und 2560 px - Bild 96 px am Handy, 120 px am Tablet, 140 px am PC (dort links neben dem Text),
// alles im ersten Bildschirm, kein Querlauf. Offline zeigt die Leiste den Löwen mit Stecker. SHOT_DIR=… legt Bilder
// für die Abnahme ab. Die API ist nachgestellt.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SHOTS = process.env.SHOT_DIR || "";
const WIDTHS = [
  { width: 390, size: 96, side: false },
  { width: 768, size: 120, side: false },
  { width: 1440, size: 140, side: true },
  { width: 2560, size: 140, side: true },
];

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    if (path === "/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.example" }));
    return route.fulfill(json([]));
  });
}

async function checkLion(page, testId, entry) {
  const lion = page.getByTestId(testId).first();
  await expect(lion).toBeVisible();
  const box = await lion.boundingBox();
  expect(Math.round(box.width)).toBe(entry.size);
  expect(box.y + box.height, "Bild im ersten Bildschirm").toBeLessThanOrEqual(page.viewportSize().height);
  const heading = await page.locator("main h1, main h2").filter({ hasText: /Rudel|Turnier/ }).first().boundingBox();
  if (entry.side) expect(heading.x, "Text rechts neben dem Bild").toBeGreaterThan(box.x + box.width);
  else expect(heading.y, "Text unter dem Bild").toBeGreaterThan(box.y + box.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test.describe("Löwe für leer und Fehler (#1325)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const entry of WIDTHS) {
    test(`404 und leere Liste bei ${entry.width} px`, async ({ page }) => {
      await page.setViewportSize({ width: entry.width, height: 900 });
      await mockServer(page);
      await page.goto("/gibt-es-nicht");
      await expect(page.getByTestId("error-title-404")).toHaveText("Hier ist kein Rudel");
      await checkLion(page, "lion-art-search", entry);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/loewe-404-${entry.width}.png` });

      await page.goto("/tournaments");
      await expect(page.getByTestId("public-empty-state")).toBeVisible();
      await page.getByTestId("public-empty-state").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("public-empty-state").getByTestId("lion-art-sleep")).toBeVisible();
      const box = await page.getByTestId("public-empty-state").getByTestId("lion-art-sleep").boundingBox();
      expect(Math.round(box.width)).toBe(entry.size);
      if (SHOTS) await page.getByTestId("public-empty-state").screenshot({ path: `${SHOTS}/loewe-leer-${entry.width}.png` });
    });
  }

  test("offline zeigt die Leiste mit dem Stecker-Löwen", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockServer(page);
    await page.goto("/gibt-es-nicht");
    await expect(page.getByTestId("error-title-404")).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByTestId("offline-bar").getByTestId("lion-art-offline")).toBeVisible();
    await context.setOffline(false);
  });
});
