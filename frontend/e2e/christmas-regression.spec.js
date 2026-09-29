const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Weihnachten (S8, #639; X1/X2/X4, #734/#735/#737) über den Abnahme-Standard (C6, seasonQa.js): die Lichterkette liegt
// nie über Menü, Logo oder Knöpfen, die Kopfzeile bleibt bedienbar, Handy ohne Kette, Reduced Motion still, Saison
// aus = nichts. Dazu der Gruß (einmal je Tag, Escape) und die Lücke der Kette am Logo.

function christmas(overrides = {}) {
  return { key: "christmas", label: "Weihnachten", phase: "gruss", intensity: "full", channels: ["web", "app"], texts: { greeting: "Frohe Weihnachten wünscht THE LION SQUAD", farewell: "Danke fürs Mitfeiern" }, starts_at: "2026-12-24T00:00:00+01:00", ends_at: "2026-12-26T23:59:59+01:00", forced: false, data: {}, ...overrides };
}

const NOW = "2026-12-24T18:00:00+01:00";

defineSeasonQa({
  title: "Weihnachten: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "christmas",
  now: NOW,
  season: christmas(),
  pieces: "[data-testid='christmas-bulb']",
  layers: ".tls-lights, .tls-xmas-glow, [data-testid='christmas-toast']",
  offPieces: "[data-testid^='christmas-']",
  settleMs: 1800,
  countPieces: () => ({
    bulbs: document.querySelectorAll("[data-testid='christmas-bulb']").length,
    chains: document.querySelectorAll("[data-testid='christmas-lights']").length,
  }),
  // Handy: keine Kette (Kopfzeile zu niedrig); Tablet: Kette an der Kopfzeile.
  mobileLimits: (counts, viewport, path) => {
    if (viewport.width < 768) expect(counts.chains, `keine Kette auf dem Handy (${path})`).toBe(0);
    else if (path !== "/login") expect(counts.chains, `Kette auf dem Tablet (${path})`).toBeGreaterThanOrEqual(1);
  },
  reducedMotionState: () => ({
    bulbs: document.querySelectorAll("[data-testid='christmas-bulb']").length,
    animated: [...document.querySelectorAll(".tls-lights__chain, .tls-lights__glow, .tls-lights__bulbBody")].filter((el) => getComputedStyle(el).animationName !== "none").length,
  }),
  // Reduced Motion: die Lämpchen leuchten ruhig, nichts glimmt oder schwingt.
  reducedMotion: (state) => {
    expect(state.bulbs).toBeGreaterThan(0);
    expect(state.animated).toBe(0);
  },
});

test.describe("Weihnachten: Gruß und Lücken", () => {
  test("Gruß einmal je Tag: erscheint nach 1,5 s mit Heiligabend, Escape schließt, beim nächsten Laden nicht mehr", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, activePayload({ season: christmas(), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const toast = page.getByTestId("christmas-toast");
    await expect(toast).toBeVisible({ timeout: 8000 });
    await expect(toast).toContainText("Heiligabend");
    await expect(toast).toContainText("Frohe Weihnachten wünscht THE LION SQUAD");
    await expect(toast).toHaveAttribute("role", "status");
    await page.keyboard.press("Escape");
    await expect(toast).toHaveCount(0);
    await page.goto("/news");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("christmas-toast")).toHaveCount(0);
  });

  test("Kette: Lücke am Logo, kein Lämpchen über Logo, Menü oder Knöpfen; Lichtinseln vorhanden", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, activePayload({ season: christmas(), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='christmas-bulb']").length), { timeout: 15000 }).toBeGreaterThan(10);
    const overlap = await page.evaluate(() => {
      const targets = [...document.querySelectorAll("header img, header a, header button, header input")].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const bulbs = [...document.querySelectorAll("[data-testid='christmas-lights'][data-anchor='header'] .tls-lights__bulbBody")].map((el) => el.getBoundingClientRect());
      const hits = bulbs.filter((b) => targets.some((t) => b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top));
      return { bulbs: bulbs.length, hits: hits.length, gaps: Number(document.querySelector("[data-testid='christmas-lights'][data-anchor='header']")?.dataset.gaps || 0) };
    });
    expect(overlap.hits, `Lämpchen über Logo/Menü/Knöpfen: ${overlap.hits} von ${overlap.bulbs}`).toBe(0);
    expect(overlap.gaps).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => document.querySelectorAll("[data-testid='christmas-glow']").length)).toBe(1);
    await testInfo.attach("weihnachten-kopfzeile.png", { body: await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 120 } }), contentType: "image/png" });
  });
});
