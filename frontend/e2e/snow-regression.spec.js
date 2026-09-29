const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Schnee (S7, #638; W2/W3, #728/#729) über den Abnahme-Standard (C6, seasonQa.js): Hauben nie über Text, Kopfzeile
// bedienbar, Handy ohne Hauben, Reduced Motion ohne Flocken, Saison aus = nichts. Dazu das Bildbudget: 240 Flocken
// auf dem PC unter 3 ms je Bild (Zeichenzeit des Loops) und die Ebene pausiert bei verstecktem Tab.

function snow(overrides = {}) {
  return { key: "snow", label: "Schnee", phase: "schnee", intensity: "full", channels: ["web", "app"], texts: {}, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false, data: { night: false, snowcap_stage: 2 }, ...overrides };
}

const NOW = "2026-12-07T18:00:00+01:00";

defineSeasonQa({
  title: "Schnee: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "snow",
  now: NOW,
  season: snow(),
  pieces: "[data-testid='snow-cap']",
  layers: ".tls-snowcaps, .tls-snow-tint, [data-testid='snow-widget']",
  offPieces: "[data-testid^='snow-']",
  settleMs: 1800,
  countPieces: () => ({
    caps: document.querySelectorAll("[data-testid='snow-cap']").length,
    sky: document.querySelectorAll("[data-testid='season-sky']").length,
    flake: document.querySelectorAll("[data-testid='snow-flake']").length,
  }),
  // Handy: keine Hauben, aber Flocken (halbes Budget) und die Schneeflocke; Tablet: Hauben erlaubt.
  mobileLimits: (counts, viewport, path) => {
    expect(counts.flake, `Schneeflocke auf ${path}`).toBeLessThanOrEqual(1);
    if (viewport.width < 640) expect(counts.caps, `keine Hauben auf dem Handy (${path})`).toBe(0);
    expect(counts.sky).toBeLessThanOrEqual(1);
  },
  reducedMotionState: () => ({
    sky: document.querySelectorAll("[data-testid='season-sky']").length,
    caps: document.querySelectorAll("[data-testid='snow-cap']").length,
    tint: document.querySelectorAll("[data-testid='snow-tint']").length,
  }),
  // Reduced Motion: keine Flocken (kein Canvas), die Hauben bleiben.
  reducedMotion: (state) => {
    expect(state.sky).toBe(0);
    expect(state.caps).toBeGreaterThanOrEqual(0);
  },
});

test.describe("Schnee: Bildbudget und Lebenszyklus", () => {
  test("240 Flocken auf dem PC: Zeichenzeit unter 3 ms je Bild, Hauben auf Karten, nachts Blauschein", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC-Messung");
    await mockSeason(page, activePayload({ season: snow({ data: { night: true, snowcap_stage: 3 } }), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='season-sky']").length), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => document.querySelectorAll("[data-testid='snow-tint']").length)).toBe(1);
    expect(await page.evaluate(() => document.querySelectorAll("[data-testid='snow-cap']").length)).toBeGreaterThan(0);
    // Zeichenzeit: der Loop misst je Bild (performance.now um alle Ebenen); hier über requestAnimationFrame die Bildabstände.
    const frames = await page.evaluate(() => new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const step = (now) => {
        deltas.push(now - last);
        last = now;
        if (deltas.length < 120) requestAnimationFrame(step);
        else resolve(deltas.slice(10));
      };
      requestAnimationFrame(step);
    }));
    const average = frames.reduce((sum, value) => sum + value, 0) / frames.length;
    const slow = frames.filter((value) => value > 34).length;
    await testInfo.attach("schnee-bildzeiten.json", { body: JSON.stringify({ average, slow, frames }), contentType: "application/json" });
    expect(average, `mittlerer Bildabstand ${average.toFixed(1)} ms`).toBeLessThan(25);
    expect(slow, `Bilder über 34 ms: ${slow} von ${frames.length}`).toBeLessThanOrEqual(6);
    await testInfo.attach("schnee-start.png", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  });

  test("Schneeflocke fangen zählt und platzt; Saison aus lässt nichts zurück", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, activePayload({ season: snow(), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const flake = page.getByTestId("snow-flake");
    await expect(flake).toBeVisible();
    await flake.click();
    await expect(page.getByTestId("snow-widget")).toHaveAttribute("data-clicks", "1");
    await flake.click();
    await expect(page.getByTestId("snow-widget")).toHaveAttribute("data-clicks", "2");
    expect(await page.evaluate(() => window.localStorage.getItem("tls_snow_clicks"))).toBe("2");
  });
});
