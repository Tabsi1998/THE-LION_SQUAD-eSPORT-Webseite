const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Adventkranz (S6, #637; W1, #727) über den Abnahme-Standard (C6, seasonQa.js): der Kranz neben dem Logo verdeckt
// nichts, die Kopfzeile bleibt bedienbar, Handy und Tablet zeigen ihn kleiner, Reduced Motion still, Saison aus =
// kein Kranz. Dazu Screenshots mit einer bis vier Kerzen (Sonntage 2026) am Bericht.

const SUNDAYS = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"];

function advent(candles, daysToChristmas) {
  return { key: "advent", label: "Adventkranz", phase: "kranz", intensity: "normal", channels: ["web", "app"], texts: {}, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2026-12-26T23:59:59+01:00", forced: false, data: { candles, days_to_christmas: daysToChristmas, sundays: SUNDAYS } };
}

defineSeasonQa({
  title: "Adventkranz: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "advent",
  now: "2026-12-07T18:00:00+01:00",
  season: advent(2, 17),
  pieces: "[data-testid='advent-wreath']",
  layers: "[data-testid='advent-widget']",
  offPieces: "[data-testid^='advent-']",
  settleMs: 1200,
  countPieces: () => ({
    wreaths: document.querySelectorAll("[data-testid='advent-wreath']").length,
    flames: document.querySelectorAll("[data-testid='advent-flame']").length,
    width: document.querySelector("[data-testid='advent-wreath']")?.getBoundingClientRect().width || 0,
  }),
  // Ein Kranz, zwei Flammen; auf dem Handy schmaler als auf dem PC.
  mobileLimits: (counts, viewport, path) => {
    expect(counts.wreaths, `ein Kranz auf ${path}`).toBeLessThanOrEqual(1);
    if (counts.wreaths) {
      expect(counts.flames).toBe(2);
      if (viewport.width < 640) expect(counts.width).toBeLessThanOrEqual(66);
    }
  },
  reducedMotionState: () => ({
    flames: document.querySelectorAll("[data-testid='advent-flame']").length,
    animated: [...document.querySelectorAll(".tls-advent__flame, .tls-advent__branches")].filter((el) => getComputedStyle(el).animationName !== "none").length,
    match: document.querySelectorAll("[data-testid='advent-match']").length,
  }),
  // Reduced Motion: die Flammen stehen, nichts wiegt, kein Streichholz.
  reducedMotion: (state) => {
    expect(state.flames).toBe(2);
    expect(state.animated).toBe(0);
    expect(state.match).toBe(0);
  },
});

test.describe("Adventkranz: eine bis vier Kerzen", () => {
  const days = [25, 18, 11, 4];
  for (let candles = 1; candles <= 4; candles += 1) {
    test(`${candles}. Advent: ${candles} Kerze(n) brennen, Text zum Kranz`, async ({ page, isMobile }, testInfo) => {
      test.skip(Boolean(isMobile), "Desktop-Bild");
      await mockSeason(page, activePayload({ season: advent(candles, days[candles - 1]), now: `${SUNDAYS[candles - 1]}T18:00:00+01:00` }));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='advent-flame']").length), { timeout: 15000 }).toBe(candles);
      expect(await page.evaluate(() => document.querySelectorAll("[data-testid='advent-candle']").length)).toBe(4);
      await page.getByTestId("advent-wreath").click();
      await expect(page.getByTestId("advent-note")).toContainText(`${candles}. Advent`);
      const wreath = page.getByTestId("advent-wreath");
      await testInfo.attach(`advent-${candles}-kerzen.png`, { body: await wreath.screenshot({ scale: "device" }), contentType: "image/png" });
      await testInfo.attach(`advent-${candles}-kopfzeile.png`, { body: await page.screenshot({ clip: { x: 0, y: 0, width: 720, height: 90 } }), contentType: "image/png" });
    });
  }
});
