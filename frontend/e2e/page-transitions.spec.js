const { test, expect } = require("@playwright/test");

// Seitenwechsel (#1073): Wo der Browser es kann, blendet er die alte Seite in die neue über (View Transitions) - nur
// nach einem Klick auf einen Link der Seite. Die neue Seite steht oben, der Inhalt ist genau einmal da und danach voll
// sichtbar; Zurück läuft wie bisher ohne Übergang. Mit „Bewegung reduzieren“ gibt es keinen Übergang. Bilder in SHOT_DIR.

const SHOTS = process.env.SHOT_DIR || "";
const EMPTY = { events: [], tournaments: [], challenges: [] };
const HOME = { has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY, upcoming: EMPTY, news: [], featured_news: [], stats: {}, club_numbers: {} };

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 86400000 }));
    // Jeden Übergang mitzählen, ohne ihn zu verändern.
    window.__transitions = 0;
    const original = window.Document.prototype.startViewTransition;
    if (typeof original === "function") {
      window.Document.prototype.startViewTransition = function counted(...args) {
        window.__transitions += 1;
        return original.apply(this, args);
      };
    }
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }) }));
  await page.route("**/api/home/state", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(HOME) }));
}

const transitions = (page) => page.evaluate(() => window.__transitions);
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));

async function settled(page) {
  // Der Übergang ist vorbei: keine Übergangs-Klasse mehr, genau ein Inhaltsbereich, voll sichtbar.
  await expect(page.locator("html")).not.toHaveClass(/\btls-vt\b/);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect.poll(() => page.locator("main#main-content").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
}

test.describe("Seitenwechsel mit der Übergangs-Funktion des Browsers", () => {
  test("drei Wechsel hin und zurück: Übergang nur nach Klicks, neue Seite oben, Inhalt einmal und sichtbar", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Die Übergangs-Funktion wird hier in Chromium geprüft");
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    await expect(page.getByTestId("footer-imprint")).toBeVisible();

    // 1: Start → Impressum, geklickt unten im Footer: die neue Seite steht oben.
    await page.getByTestId("footer-imprint").scrollIntoViewIfNeeded();
    expect(await scrollY(page)).toBeGreaterThan(200);
    await page.getByTestId("footer-imprint").click();
    await expect(page).toHaveURL(/\/imprint$/);
    await expect.poll(() => transitions(page)).toBe(1);
    await settled(page);
    expect(await scrollY(page)).toBe(0);
    // Der Browser blendet über - der Inhalt blendet nicht noch selbst ein.
    await expect(page.locator("main#main-content")).not.toHaveAttribute("data-route-fade", /.+/);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/seitenwechsel-impressum.png` });

    // 2: Impressum → Datenschutz.
    await page.getByTestId("footer-privacy").scrollIntoViewIfNeeded();
    await page.getByTestId("footer-privacy").click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect.poll(() => transitions(page)).toBe(2);
    await settled(page);
    expect(await scrollY(page)).toBe(0);

    // 3: Datenschutz → Start (Logo im Kopf).
    await page.locator("header a[href='/']").first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => transitions(page)).toBe(3);
    await settled(page);

    // Zurück dreimal: wie bisher, ohne Übergang, jede Seite wieder voll da.
    for (const url of [/\/privacy$/, /\/imprint$/, /\/$/]) {
      await page.goBack();
      await expect(page).toHaveURL(url);
      await settled(page);
    }
    expect(await transitions(page)).toBe(3);
  });

  test("mit „Bewegung reduzieren“ kein Übergang, der Wechsel klappt trotzdem", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockServer(page);
    await page.goto("/");
    await page.getByTestId("footer-imprint").scrollIntoViewIfNeeded();
    await page.getByTestId("footer-imprint").click();
    await expect(page).toHaveURL(/\/imprint$/);
    await settled(page);
    expect(await transitions(page)).toBe(0);
  });
});
