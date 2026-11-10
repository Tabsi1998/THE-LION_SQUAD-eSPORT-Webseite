const { test, expect } = require("@playwright/test");

// Streamer oder Creator (#2338): das Häkchen im Vereinsprofil (Mitglieder → Öffentliche Profile → Bearbeiten) bei 390 und
// 1440 px - sichtbar, ohne seitliches Scrollen, und gespeichert wird nur die Änderung. Erfundene Daten.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const ROOT = { id: "u-root", username: "root", display_name: "Sam Superadmin", role: "superadmin", areas: ["tournaments", "content", "club", "finance", "system", "moderation"], mfa_enabled: true, auth_mfa_verified: true };
const PROFILES = [
  { id: "p-1", display_name: "Erika Beispiel", gamertag: "erika-streamt", slug: "erika-streamt", user_id: "u-1", linked_account: { id: "u-1", username: "erika", display_name: "Erika" },
    games: ["Rocket League"], platforms: ["PC"], is_active: true, creator: false },
];

async function mockApi(page, calls) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      let body = null;
      try { body = request.postDataJSON(); } catch { body = null; }
      calls.push({ method: request.method(), path: url.pathname, body });
      return json({ ...PROFILES[0], ...(body || {}) });
    }
    if (url.pathname === "/api/auth/me") return json(ROOT);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/membership/profiles/admin/all") return json(PROFILES);
    return json(/notifications|games$|nav$|site-banners|sponsors|partners|staff$|users$|list$|members$|applications$/.test(url.pathname) ? [] : {});
  });
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const [name, width, height] of WIDTHS) {
  test.describe(`Streamer oder Creator (${name})`, () => {
    test.use({ viewport: { width, height } });

    test("Häkchen im Vereinsprofil: sichtbar, erklärt und nur die Änderung gespeichert", async ({ page }) => {
      const calls = [];
      await mockApi(page, calls);
      await page.goto("/admin/members?tab=profiles");
      await page.getByRole("button", { name: /Bearbeiten/ }).first().click();
      const mark = page.getByTestId("club-member-creator");
      await mark.scrollIntoViewIfNeeded();
      await expect(mark).toBeVisible();
      await expect(mark).not.toBeChecked();
      await expect(page.locator("label", { has: mark })).toContainText("Verifizierter Streamer");
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      if (process.env.E2E_SHOT_DIR) {
        await page.locator("label", { has: mark }).screenshot({ path: `${process.env.E2E_SHOT_DIR}/creator-haekchen-${width}.png` });
        await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/creator-profil-${width}.png` });
      }
      await mark.check();
      await page.getByTestId("club-member-save").click();
      await expect.poll(() => calls.find((call) => call.path === "/api/membership/profiles/admin/p-1")?.body).toEqual({ creator: true });
    });
  });
}
