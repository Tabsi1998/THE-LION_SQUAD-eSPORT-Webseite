const { test, expect } = require("@playwright/test");

// Cookie-Hinweis als schmales Blatt (#1226): bei 390, 768 und 1440 px ist das Blatt unten sichtbar, die Seite dahinter
// bleibt scroll- und klickbar, „Nur Nötiges“ und „Alle erlauben“ sind gleich groß; axe findet am offenen Blatt (auch mit
// den Schaltern) nichts. Die API ist nachgestellt.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockApi(page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    if (path === "/api/home/state") return route.fulfill(json({ has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, news: [], featured_news: [], stats: {}, club_numbers: {} }));
    if (path === "/api/events/meta") return route.fulfill(json({ types: [], statuses: [] }));
    return route.abort();
  });
}

async function axeViolations(page, selector) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async (target) => {
    const result = await window.axe.run(document.querySelector(target), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }, selector);
}

test.describe("Cookie-Hinweis als Blatt", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const width of [390, 768, 1440]) {
    test(`bei ${width} px: Blatt unten, gleich große Knöpfe, Seite dahinter bedienbar, axe ohne Befund`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await mockApi(page);
      await page.goto("/");
      const sheet = page.getByTestId("cookie-sheet");
      await expect(sheet.getByRole("heading", { name: "Cookies und eingebettete Inhalte" })).toBeVisible();

      // Unten, schmal: am Handy höchstens ein Drittel, ab Tablet höchstens 720 px breit und mittig.
      const box = await sheet.locator("section").boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
      if (width < 640) expect(box.height).toBeLessThanOrEqual(844 / 3 + 1);
      else {
        expect(box.width).toBeLessThanOrEqual(720 + 1);
        expect(Math.abs((box.x + box.width / 2) - width / 2)).toBeLessThanOrEqual(2);
      }
      if (width < 1024) {
        // Über der unteren Leiste - die bleibt bedienbar.
        const nav = await page.getByTestId("bottom-nav").boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 1);
      }

      // Gleich groß und gleich gestaltet.
      const essential = page.getByRole("button", { name: "Nur Nötiges" });
      const all = page.getByRole("button", { name: "Alle erlauben" });
      const [a, b] = [await essential.boundingBox(), await all.boundingBox()];
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      expect(await essential.getAttribute("class")).toBe(await all.getAttribute("class"));

      // Keine Unschärfe, kein Fenster: in der Mitte der Seite liegt Inhalt, nicht das Blatt - und die Seite scrollt.
      const middle = await page.evaluate(() => {
        const element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 3);
        return Boolean(element && !element.closest("[data-testid='cookie-sheet']"));
      });
      expect(middle).toBe(true);
      await page.mouse.wheel(0, 600);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      expect(await axeViolations(page, "[data-testid='cookie-sheet']")).toEqual([]);
      await page.getByRole("button", { name: /Einzeln wählen/ }).click();
      await expect(page.getByRole("switch", { name: "Externe Medien erlauben" })).toBeVisible();
      expect(await axeViolations(page, "[data-testid='cookie-sheet']")).toEqual([]);
      await testInfo.attach(`cookie-blatt-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });

      // Ein Link hinter dem Blatt funktioniert, das Blatt bleibt, bis man wählt.
      await page.locator("a[href='/events']:visible").first().click();
      await expect(page).toHaveURL(/\/events$/);
      await expect(sheet).toBeVisible();
      await all.click();
      await expect(sheet).toHaveCount(0);
    });
  }
});
