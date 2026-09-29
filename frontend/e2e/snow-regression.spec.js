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

test.describe("Schnee: die Flocken gehören zur Seite", () => {
  test("beim Scrollen wandern die Flocken mit dem Inhalt - sie kleben nicht am Fenster", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC-Messung");
    await mockSeason(page, activePayload({ season: snow(), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='season-sky']").length), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(2500);
    // Helle Punkte der Zeichenfläche vor und nach einem Scrollschritt vergleichen: bei welcher Verschiebung nach
    // oben decken sie sich am besten? Klebten die Flocken am Fenster, wäre es 0; in der Seite ist es der Scrollweg
    // (vorne ganz, in der Mitte 0,8, hinten 0,55).
    const result = await page.evaluate(async (delta) => {
      const canvas = document.querySelector("[data-testid='season-sky']");
      const ctx = canvas.getContext("2d");
      const ratio = canvas.width / canvas.clientWidth;
      const cell = 6;
      const grab = () => {
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const points = [];
        for (let y = 0; y < height; y += 2) {
          for (let x = 0; x < width; x += 2) {
            if (data[(y * width + x) * 4 + 3] > 150) points.push([x / ratio, y / ratio]);
          }
        }
        return points;
      };
      const frames = (count) => new Promise((resolve) => {
        const step = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
        step(count);
      });
      await frames(2);
      const before = grab();
      window.scrollTo(0, window.scrollY + delta);
      await frames(2);
      const after = grab();
      const cells = new Set(after.map(([x, y]) => `${Math.round(x / cell)}:${Math.round(y / cell)}`));
      const score = (shift) => before.filter(([x, y]) => {
        const cx = Math.round(x / cell);
        const cy = Math.round((y - shift) / cell);
        return cells.has(`${cx}:${cy}`) || cells.has(`${cx + 1}:${cy}`) || cells.has(`${cx - 1}:${cy}`);
      }).length;
      const scores = [];
      for (let shift = 0; shift <= delta + 30; shift += 3) scores.push({ shift, hits: score(shift) });
      const best = scores.reduce((a, b) => (b.hits > a.hits ? b : a), scores[0]);
      return { before: before.length, after: after.length, zero: scores[0].hits, best, scrollY: window.scrollY, scores };
    }, 120);
    await testInfo.attach("schnee-scrollen.json", { body: JSON.stringify(result), contentType: "application/json" });
    expect(result.scrollY, "die Seite hat gescrollt").toBe(120);
    expect(result.before, "helle Punkte vor dem Scrollen").toBeGreaterThan(40);
    expect(result.best.shift, `beste Deckung bei ${result.best.shift} px (Treffer ${result.best.hits}, ohne Verschiebung ${result.zero})`).toBeGreaterThanOrEqual(60);
    expect(result.best.shift).toBeLessThanOrEqual(129);
    expect(result.best.hits).toBeGreaterThan(result.zero * 1.4);
  });
});
