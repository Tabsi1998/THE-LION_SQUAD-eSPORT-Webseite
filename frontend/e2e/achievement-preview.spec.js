const { test, expect } = require("@playwright/test");

// Abzeichen-Kunst und Zeremonien (E8, #618): die Vorschauseite zeigt jedes Material, jede Bewegung
// und jeden Sonderablauf - je Material ein Screenshot (als Diagnose-Anhang) und eine Farbprobe, die
// belegt, dass die Materialien sich wirklich unterscheiden; eine Zeremonie lässt sich abspielen und
// per Escape schließen. Admin-Konto und API sind Attrappen im Browser.

const MATERIALS = ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"];

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

async function averageColor(page, selector) {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel);
    const data = new window.XMLSerializer().serializeToString(svg);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data);
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 96; canvas.height = 96;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 96, 96);
        const px = ctx.getImageData(24, 24, 48, 48).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) { if (px[i + 3] > 0) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n += 1; } }
        resolve(n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }, selector);
}

test.describe("Abzeichen-Kunst", () => {
  test("jedes Material sieht anders aus und lässt sich als Zeremonie abspielen", async ({ page }, testInfo) => {
    await mockAdminSession(page);
    await page.goto("/admin/achievements/preview");
    await expect(page.getByTestId("achievement-preview-page")).toBeVisible();
    await expect(page.getByTestId("preview-count")).toContainText(/\d+ Motive/);
    const colors = {};
    for (const material of MATERIALS) {
      await page.getByTestId("preview-material").selectOption(material);
      const first = page.getByTestId("preview-gallery").locator("svg.tls-badge").first();
      await expect(first).toHaveAttribute("data-material", material);
      const shot = await page.getByTestId("preview-material-row").screenshot();
      await testInfo.attach(`badges-${material}.png`, { body: shot, contentType: "image/png" });
      const color = await averageColor(page, `[data-testid="preview-gallery"] svg.tls-badge`);
      if (color) colors[material] = color;
    }
    const distinct = new Set(Object.values(colors).map((c) => c.join(",")));
    expect(distinct.size).toBeGreaterThanOrEqual(Math.min(6, Object.keys(colors).length));

    await page.getByTestId("ceremony-material").selectOption("legendary");
    await page.getByTestId("ceremony-play").click();
    const overlay = page.getByTestId("achievement-unlock-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute("data-material", "legendary");
    await expect(page.getByTestId("ceremony-legendary-banner")).toBeVisible();
    await testInfo.attach("ceremony-legendary.png", { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
  });

  test("Verein (#864): die Fahne hängt mittig hinter der Medaille", async ({ page }, testInfo) => {
    await mockAdminSession(page);
    await page.goto("/admin/achievements/preview");
    await expect(page.getByTestId("achievement-preview-page")).toBeVisible();
    await page.getByTestId("ceremony-material").selectOption("gold");
    await page.getByTestId("ceremony-category").selectOption("club");
    await page.getByTestId("ceremony-play").click();
    const overlay = page.getByTestId("achievement-unlock-overlay");
    await expect(overlay).toBeVisible();
    const flag = overlay.getByTestId("ceremony-flag");
    await expect(flag).toBeVisible();
    await page.waitForTimeout(1500);   // der Schwung der Fahne ist vorbei
    const flagBox = await flag.boundingBox();
    const badgeBox = await overlay.locator("svg.tls-badge").first().boundingBox();
    expect(Math.abs((flagBox.x + flagBox.width / 2) - (badgeBox.x + badgeBox.width / 2))).toBeLessThan(4);
    expect(flagBox.y).toBeLessThan(badgeBox.y);
    await testInfo.attach("ceremony-club.png", { body: await page.screenshot(), contentType: "image/png" });
  });
});
