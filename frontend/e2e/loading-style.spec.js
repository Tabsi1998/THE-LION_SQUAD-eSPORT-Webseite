const { test, expect } = require("@playwright/test");

// Laden im Vereinsstil (#1324): ein langsamer Seitenwechsel (die Seite selbst kommt 900 ms später) bei 390, 768, 1440
// und 2560 px - Kopf bleibt sichtbar, die dünne Linie sitzt unter dem Kopf, darunter das Skelett, kein Kreisel; danach
// der Inhalt ohne Layout-Sprung (CLS unter 0,1). Mit „Bewegung reduzieren“ steht die Linie still. SHOT_DIR=… legt
// Bilder des Skeletts für die Abnahme ab. Die API ist nachgestellt.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SHOTS = process.env.SHOT_DIR || "";
const LONG = "Ein langer Absatz, damit die Seite mehr als einen Bildschirm füllt. ".repeat(8);
const EVENT = {
  id: "e1", slug: "herbst-lan", name: "Herbst-LAN 2026", status: "upcoming", visibility: "public", event_type: "lan",
  start_date: "2026-11-14T09:00:00+01:00", end_date: "2026-11-14T22:00:00+01:00", location: "Vereinsheim", city: "Linz",
  description: LONG, public_phase: { state: "announced", label: "Angekündigt" }, registrations: [], sponsors: [], albums: [],
  news: [], f1_challenges: [], tournaments: [],
};

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
    window.__cls = 0;
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    if (path === "/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.example" }));
    if (path === "/events/herbst-lan") return setTimeout(() => route.fulfill(json(EVENT)).catch(() => {}), 900);
    return route.fulfill(json([]));
  });
}

test.describe("Laden im Vereinsstil (#1324)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const width of [390, 768, 1440, 2560]) {
    test(`bei ${width} px: Kopf bleibt, Linie unter dem Kopf, Skelett statt Kreisel`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await mockServer(page);
      await page.goto("/events/herbst-lan", { waitUntil: "domcontentloaded" });
      const header = page.getByTestId("site-header");
      await expect(header).toBeVisible();
      await expect(page.getByTestId("page-loading")).toBeVisible();
      const line = page.getByTestId("route-progress");
      await expect(line).toBeVisible();
      // In einem Schritt gemessen: beim Wechsel vom Rahmen des Seitenwechsels zur Seite wird der Kopf getauscht.
      const place = await page.evaluate(() => {
        const bar = document.querySelector("[data-testid='route-progress']");
        const head = document.querySelector("[data-testid='site-header']");
        if (!bar || !head) return null;
        const a = bar.getBoundingClientRect();
        const b = head.getBoundingClientRect();
        return { gap: Math.abs(a.top - b.bottom), height: a.height };
      });
      if (place) {
        expect(place.gap, "Linie direkt unter dem Kopf").toBeLessThanOrEqual(3);
        expect(Math.round(place.height)).toBe(2);
      }
      expect(await page.locator(".animate-spin").count()).toBe(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/laden-${width}.png` });
      await expect(page.getByTestId("page-loading")).toHaveCount(0, { timeout: 10000 });
      await expect(line).toHaveCount(0);
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.1);
    });
  }

  test("mit Bewegung reduzieren steht die Linie still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await mockServer(page);
    await page.goto("/events/herbst-lan", { waitUntil: "domcontentloaded" });
    const line = page.getByTestId("route-progress");
    await expect(line).toBeVisible();
    // In einem Schritt gelesen: beim Wechsel vom Rahmen des Seitenwechsels zur Seite wird der Kopf samt Linie getauscht -
    // ein abgehängtes Element liefert für jeden Stil "" statt "none".
    const styles = () => page.evaluate(() => {
      const bar = document.querySelector("[data-testid='route-progress']");
      const skeleton = document.querySelector(".tls-skeleton");
      if (!bar || !skeleton) return null;
      return { line: getComputedStyle(bar, "::before").animationName, skeleton: getComputedStyle(skeleton).animationName };
    });
    await expect.poll(styles).toEqual({ line: "none", skeleton: "none" });
  });
});
