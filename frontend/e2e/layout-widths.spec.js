const { test, expect } = require("@playwright/test");

// Layout am PC (#426): der Seiten-Container nutzt die Breite (bis 1792 px), statt bei 1280 px zu
// enden; kein horizontales Scrollen bei keiner Breite. Screenshots hängen als Anhang am Bericht,
// damit man Vorher/Nachher vergleichen kann.

const CONTAINER_MAX = 1792;
const PAGES = ["/", "/events", "/tournaments", "/news"];

async function mockQuiet(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/settings/public")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }) });
    }
    if (url.includes("/api/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    if (url.includes("/api/events/meta")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ types: [], statuses: [] }) });
    if (url.includes("/api/home/state")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, news: [], featured_news: [], stats: {}, club_numbers: {} }) });
    // Alles andere scheitert wie ohne Backend - die Seiten fangen das ab (Leerzustände), ein
    // pauschales „[]“ ließe Aufrufe stolpern, die ein Objekt erwarten.
    return route.abort();
  });
}

test.describe("PC-Layout: Container nutzt die Breite", () => {
  // Nur der Desktop-Lauf: das Handy-Projekt hat eine feste Handybreite und den Hamburger-Kopf.
  test.skip(({ isMobile }) => Boolean(isMobile), "Desktop-Prüfung");
  test.beforeEach(async ({ page }) => {
    await mockQuiet(page);
  });

  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    test(`Kopfzeile und Inhalt sind bei ${viewport.width} px so breit wie möglich`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      // Der Container darf bis CONTAINER_MAX wachsen; mindestens die Breite abzüglich der Ränder.
      const expected = Math.min(viewport.width - 80, CONTAINER_MAX);
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.locator("header")).toBeVisible();
        const box = await page.getByTestId("site-header-row").boundingBox();
        expect(box, `Kopfzeile auf ${path}`).not.toBeNull();
        expect(box.width, `Kopfzeile auf ${path} bei ${viewport.width}px`).toBeGreaterThanOrEqual(expected - 2);
        expect(box.width).toBeLessThanOrEqual(CONTAINER_MAX + 2);
        const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
        expect(overflow, `kein horizontales Scrollen auf ${path}`).toBeLessThanOrEqual(2);
        if (path === "/") {
          await testInfo.attach(`startseite-${viewport.width}.png`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
        }
      }
    });
  }
});

// Fußzeile „Dabei sein“ (#1219): bis 1023 px stehen Satz und Knöpfe untereinander, ab 1024 px nebeneinander mit
// Mindestbreite für den Satz - auch im längsten Fall (Discord-Zahlen, Discord-Knopf und beide Store-Knöpfe) keine
// Wortsäule und kein Knopf über den Rand.
test.describe("Fußzeile: Satz und Knöpfe", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/settings/public")) {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({
          club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at", discord_invite_url: "https://discord.gg/beispiel",
          play_store_url: "https://play.google.com/store/apps/details?id=at.beispiel.app", app_store_url: "https://apps.apple.com/at/app/beispiel/id100000",
        }) });
      }
      if (url.includes("/api/home/discord")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: true, online: 56, in_voice: 7 }) });
      if (url.includes("/api/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
      if (url.includes("/api/events/meta")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ types: [], statuses: [] }) });
      return route.abort();
    });
  });

  for (const width of [390, 768, 820, 1024, 1440]) {
    test(`bei ${width} px steht der Satz in ganzen Zeilen und kein Knopf läuft aus dem Bild`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/events");
      const cta = page.getByTestId("footer-cta");
      await expect(page.getByTestId("footer-appstore-button")).toBeVisible();
      await expect(page.getByTestId("footer-discord-live")).toBeVisible();
      await cta.scrollIntoViewIfNeeded();
      const text = await page.getByTestId("footer-cta-text").boundingBox();
      expect(text.width, "der Satz ist mindestens 280 px breit").toBeGreaterThanOrEqual(280);
      const rightEdges = await page.getByTestId("footer-buttons").evaluate((row) => [row, ...row.children].map((el) => el.getBoundingClientRect().right));
      const viewport = await page.evaluate(() => document.documentElement.clientWidth);
      for (const right of rightEdges) expect(right, "kein Knopf über den Rand").toBeLessThanOrEqual(viewport + 1);
      const sideBySide = await page.evaluate(() => {
        const a = document.querySelector("[data-testid='footer-cta-text']").getBoundingClientRect();
        const b = document.querySelector("[data-testid='footer-buttons']").getBoundingClientRect();
        return b.left >= a.right - 1;
      });
      expect(sideBySide, "ab 1024 px nebeneinander, darunter untereinander").toBe(width >= 1024);
      await testInfo.attach(`fusszeile-${width}.png`, { body: await cta.screenshot(), contentType: "image/png" });
    });
  }
});
