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

// Ein Regenstrich ist nie deckender als 0,35 (rain.js MAX_ALPHA, dort geprüft; die Kantenglättung rundet auf 0,36).
// Wo sich zwei Striche kreuzen, addiert sich die Deckkraft für einen Augenblick - das sind einzelne Punkte, nie
// Flächen. Geprüft wird deshalb der Anteil: praktisch alles, was gezeichnet ist, liegt unter der Grenze.
const STROKE_CAP = 0.36;
const CROSSING_SHARE = 0.03;
// Drei Regenstriche übereinander kämen auf 0,66 - Schneeflocken sind heller.
const FLAKE_ALPHA = 0.66;

/** Wie viele Punkte der Zeichenfläche gerade etwas zeigen, wie deckend der hellste ist und wie viele über `cap` liegen. */
async function canvasInk(page, cap = STROKE_CAP) {
  return page.evaluate((limit) => {
    const canvas = document.querySelector("[data-testid='season-sky']");
    if (!canvas) return { canvas: false, points: 0, maxAlpha: 0, above: 0 };
    const ctx = canvas.getContext("2d");
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let points = 0;
    let maxAlpha = 0;
    let above = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 8) points += 1;
        if (alpha > limit) above += 1;
        if (alpha > maxAlpha) maxAlpha = alpha;
      }
    }
    return { canvas: true, points, maxAlpha, above };
  }, Math.round(cap * 255));
}

test.describe("Wetter: das ganze Jahr auf der Seite", () => {
  test("Regen am Vereinsort: es regnet auf der Seite, kein Strich deckender als 0,35, Kopfzeile bedienbar, kein Überlauf", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, payload([weatherSeason()], weather({ rain_mm: 2.4, code: 63 })));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain("weather");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='season-sky']").length), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(1500);
    // Drei Bilder im Abstand, damit die Aussage nicht an einem glücklichen Augenblick hängt.
    for (let shot = 0; shot < 3; shot += 1) {
      const ink = await canvasInk(page);
      expect(ink.points, "Regenstriche auf der Zeichenfläche").toBeGreaterThan(150);
      expect(ink.above / ink.points, `Punkte über ${STROKE_CAP}: ${ink.above} von ${ink.points}`).toBeLessThan(CROSSING_SHARE);
      await page.waitForTimeout(250);
    }
    const size = await page.evaluate(() => document.querySelector("[data-testid='season-sky']").width);
    expect(size, "Zeichenfläche wach").toBeGreaterThanOrEqual(1440);
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
    // Ein trockener Tag kostet nichts: die Zeichenfläche hat keinen Speicher (ein Punkt), liegt aber bereit.
    const parked = await page.evaluate(() => {
      const canvas = document.querySelector("[data-testid='season-sky']");
      return canvas ? [canvas.width, canvas.height] : null;
    });
    expect(parked, "Zeichenfläche im Schlaf").toEqual([1, 1]);
    // Schläft der Loop, zeichnet die Ebene in drei Sekunden kein einziges Bild (Nachschauen kostet keines).
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
      setTimeout(() => resolve(clears), 3000);
      return undefined;
    }));
    expect(frames, `Bilder der Wetter-Ebene in drei Sekunden: ${frames}`).toBe(0);
  });

  test("es beginnt zu regnen: die ruhende Ebene wacht beim nächsten Wetterstand auf - ohne Neuladen", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, payload([weatherSeason()], weather({ rain_mm: 0, snow_cm: 0, code: 3 })));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='season-sky']").length), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(800);
    expect((await canvasInk(page)).points).toBe(0);
    // Der nächste Abruf des Wetters meldet Regen: die Seite sagt es den Ebenen über das Ereignis.
    await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("tls:season-weather", { detail })), weather({ rain_mm: 2.4, code: 63 }));
    await expect.poll(async () => (await canvasInk(page)).points, { timeout: 8000, message: "Regen nach dem Wetterwechsel" }).toBeGreaterThan(100);
    const size = await page.evaluate(() => document.querySelector("[data-testid='season-sky']").width);
    expect(size, "Zeichenfläche wach").toBeGreaterThanOrEqual(1440);
    // Und wieder trocken: der Regen läuft aus, dann ruht die Ebene wieder.
    await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("tls:season-weather", { detail })), weather({ rain_mm: 0, code: 3 }));
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-testid='season-sky']").width), { timeout: 12000, message: "Zeichenfläche wieder im Schlaf" }).toBe(1);
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
    // Flocken sind heller als Regen: gäbe es nur Regen, läge praktisch nichts über der Grenze für Striche.
    expect(ink.maxAlpha / 255, `hellster Punkt ${(ink.maxAlpha / 255).toFixed(2)}`).toBeGreaterThan(FLAKE_ALPHA);
    expect(ink.above / ink.points, `Punkte über ${STROKE_CAP}: ${ink.above} von ${ink.points}`).toBeGreaterThan(0.1);
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
