const { test, expect } = require("@playwright/test");
const { activePayload, mockSeason } = require("./seasonQa");

// Wetter auf der Seite (#673, Betreiber 29.09.): das ganze Jahr als Saison „Wetter“. Regnet es am Vereinsort, regnet
// es auf der Seite (Striche unter 0,35 Deckkraft, Kopfzeile bleibt bedienbar); ohne Niederschlag ruht die Ebene; in
// der Schnee-Saison regnet es nie; Reduced Motion: nichts; Saison aus: nichts.

function weatherSeason(overrides = {}) {
  return { key: "weather", label: "Wetter", phase: "wetter", intensity: "full", channels: ["web", "app"], texts: {}, starts_at: "2026-01-01T00:00:00+01:00", ends_at: "2026-12-31T23:59:59+01:00", forced: false, data: {}, ...overrides };
}

function snowSeason() {
  return { key: "snow", label: "Schnee", phase: "schnee", intensity: "full", channels: ["web", "app"], texts: {}, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false, data: { night: false, snowcap_stage: 2 } };
}

function weather(overrides = {}) {
  return { location: "Innsbruck", night: false, sunrise: "2026-07-14T05:30:00+02:00", sunset: "2026-07-14T21:05:00+02:00", temp_c: 17, wind_kmh: 18, wind_dir: 270, wind_factor: 1, rain_mm: 0, snow_cm: 0, code: 3, stale: false, source: "open-meteo", ...overrides };
}

function payload(seasons, conditions, now = "2026-07-14T16:00:00+02:00") {
  return { ...activePayload({ season: seasons[0], now }), seasons, weather: conditions };
}

/** Wie viele Punkte der Zeichenfläche gerade etwas zeigen und wie deckend der hellste ist. */
async function canvasInk(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-testid='season-sky']");
    if (!canvas) return { canvas: false, points: 0, maxAlpha: 0 };
    const ctx = canvas.getContext("2d");
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let points = 0;
    let maxAlpha = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 8) points += 1;
        if (alpha > maxAlpha) maxAlpha = alpha;
      }
    }
    return { canvas: true, points, maxAlpha };
  });
}

test.describe("Wetter: das ganze Jahr auf der Seite", () => {
  test("Regen am Vereinsort: es regnet auf der Seite, nie deckender als 0,35, Kopfzeile bedienbar, kein Überlauf", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, payload([weatherSeason()], weather({ rain_mm: 2.4, code: 63 })));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain("weather");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='season-sky']").length), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(1500);
    const ink = await canvasInk(page);
    expect(ink.points, "Regenstriche auf der Zeichenfläche").toBeGreaterThan(150);
    expect(ink.maxAlpha / 255, `deckendster Punkt ${(ink.maxAlpha / 255).toFixed(2)}`).toBeLessThanOrEqual(0.4);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    const top = await page.evaluate(() => {
      const link = document.querySelector("header nav a, header a[href]");
      const r = link.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && hit.closest("header"));
    });
    expect(top, "Kopfzeile bedienbar").toBe(true);
    await testInfo.attach("wetter-regen.png", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  });

  test("ohne Niederschlag ruht die Ebene: nichts gezeichnet, der Loop schläft", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, payload([weatherSeason()], weather({ rain_mm: 0, snow_cm: 0, code: 1 })));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain("weather");
    await page.waitForTimeout(1500);
    const ink = await canvasInk(page);
    expect(ink.points).toBe(0);
    // Schläft der Loop, kommen in einer Sekunde höchstens ein paar Bilder der Seite selbst - die Ebene zeichnet keines.
    const frames = await page.evaluate(() => new Promise((resolve) => {
      const canvas = document.querySelector("[data-testid='season-sky']");
      if (!canvas) return resolve(0);
      const ctx = canvas.getContext("2d");
      let clears = 0;
      const original = ctx.clearRect.bind(ctx);
      ctx.clearRect = (...args) => {
        clears += 1;
        return original(...args);
      };
      setTimeout(() => resolve(clears), 1000);
      return undefined;
    }));
    expect(frames, `Bilder der Wetter-Ebene in einer Sekunde: ${frames}`).toBeLessThanOrEqual(2);
  });

  test("Schnee-Saison: es regnet nie - die Wetter-Ebene ruht, der Schnee schneit", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, payload([weatherSeason(), snowSeason()], weather({ rain_mm: 3, code: 63, temp_c: 2 }), "2026-12-07T18:00:00+01:00"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain("snow");
    await page.waitForTimeout(2000);
    const ink = await canvasInk(page);
    expect(ink.canvas).toBe(true);
    expect(ink.points, "Flocken auf der Zeichenfläche").toBeGreaterThan(50);
    // Flocken sind heller als Regen je sein darf: gäbe es nur Regen, bliebe der hellste Punkt unter 0,4.
    expect(ink.maxAlpha / 255).toBeGreaterThan(0.45);
  });

  test("Reduced Motion: kein Wetter; Saison aus: nichts", async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const quiet = await context.newPage();
    await mockSeason(quiet, payload([weatherSeason()], weather({ rain_mm: 2.4, code: 95 })));
    await quiet.goto("/");
    await quiet.waitForLoadState("networkidle");
    await quiet.waitForTimeout(1500);
    expect(await quiet.evaluate(() => document.querySelectorAll("[data-testid='season-sky']").length)).toBe(0);
    await context.close();
    await mockSeason(page, { now: "2026-07-14T16:00:00+02:00", enabled: false, preview: false, weather: weather({ rain_mm: 2.4 }), seasons: [] });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.querySelectorAll("[data-testid='season-sky'], [data-testid='season-corners']").length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset.season || "")).toBe("");
  });
});
