const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Ostern (S14 #645, E1 #753, E4 #756) über den Abnahme-Standard (C6, seasonQa.js): Eier-Reihe und Wiese nie
// über Text oder Bedienelementen, kein Querscrollen, Kopfzeile und Dropdown bedienbar, Handy mit drei Eiern,
// Reduced Motion still, Saison aus = nichts, keine Hasenohren (#857). Dazu Karfreitag (still) und Screenshots.

function easter(overrides = {}, data = {}) {
  return { key: "easter", label: "Ostern", phase: "deko", intensity: "normal", channels: ["web", "app"], texts: { greeting: "Frohe Ostern wünscht THE LION SQUAD" }, starts_at: "2027-03-21T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", forced: false, data: { quiet: false, sunday: "2027-03-28", ...data }, ...overrides };
}

const NOW = "2027-03-24T11:00:00+01:00";
const PIECES = "[data-testid='easter-row'], [data-testid='easter-meadow'] .tls-meadow__item";

defineSeasonQa({
  title: "Ostern: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "easter",
  now: NOW,
  season: easter(),
  pieces: PIECES,
  layers: ".tls-easter-layer, .tls-easter-light",
  exempt: "[data-season-anchor='lion']",
  offPieces: "[data-testid^='easter-']",
  settleMs: 2400,
  countPieces: () => ({
    eggs: document.querySelectorAll("[data-testid='easter-row'] [data-testid='easter-row-item']").length,
    ears: document.querySelectorAll("[data-testid='easter-ears'], [data-testid='easter-hero-ears']").length,
  }),
  // Handy: höchstens drei Eier in der Reihe (oder keine Reihe, wenn unter der Kopfzeile nichts frei ist); nie Ohren.
  mobileLimits: (counts, viewport, path) => {
    if (viewport.width < 640) expect(counts.eggs, `höchstens drei Eier am Handy (${path})`).toBeLessThanOrEqual(3);
    expect(counts.ears, `keine Hasenohren (${path})`).toBe(0);
  },
  reducedMotionState: () => ({
    ears: document.querySelectorAll("[data-testid='easter-ears']").length,
    animated: [...document.querySelectorAll(".tls-easter-row__item, .tls-meadow__item, .tls-easter-light")].filter((el) => getComputedStyle(el).animationName !== "none").length,
  }),
  reducedMotion: (state) => {
    expect(state.ears).toBe(0);
    expect(state.animated).toBe(0);
  },
});

const overflowOf = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);

async function shot(page, testInfo, name, options = {}) {
  const file = testInfo.outputPath(name);
  await page.screenshot({ path: file, ...options });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

test.describe("Ostern: Tage und Sichtprobe", () => {
  test("Startseite: keine Ohren, Reihe unter der Kopfzeile, Wiese über der Fußzeile", async ({ page, isMobile }, testInfo) => {
    await mockSeason(page, activePayload({ season: easter(), now: NOW }));
    await page.goto("/");
    await expect(page.getByTestId("easter-light")).toBeAttached({ timeout: 20000 });
    await page.waitForTimeout(2400);
    expect(await page.locator("[data-testid='easter-ears'], [data-testid='easter-hero-ears']").count(), "keine Hasenohren (#857)").toBe(0);
    expect(await overflowOf(page)).toBeLessThanOrEqual(2);
    await shot(page, testInfo, `start-${isMobile ? "handy" : "pc"}.png`);
    // Die Wiese über der Fußzeile.
    await page.evaluate(() => document.querySelector("footer").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(600);
    await expect(page.getByTestId("easter-meadow")).toBeVisible();
    await shot(page, testInfo, `wiese-${isMobile ? "handy" : "pc"}.png`);
  });

  test("Karfreitag: alles da, aber still - nichts schwingt, kein Gruß", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    // Erst die Uhr, dann die gespeicherte Einwilligung - sonst gälte sie zum Testzeitpunkt als abgelaufen.
    await page.clock.install({ time: new Date("2027-03-26T11:00:00+01:00") });
    await mockSeason(page, activePayload({ season: easter({}, { quiet: true }), now: "2027-03-26T11:00:00+01:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/news");
    await expect(page.getByTestId("easter-light")).toBeAttached({ timeout: 20000 });
    await page.waitForTimeout(2400);
    const moving = await page.evaluate(() => [...document.querySelectorAll(".tls-easter-row__item, .tls-meadow__item, .tls-easter-light")].filter((el) => getComputedStyle(el).animationName !== "none").length);
    expect(moving).toBe(0);
    await expect(page.getByTestId("easter-toast")).toHaveCount(0);
  });

  test("Ostersonntag: der Gruß kommt einmal", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await page.clock.install({ time: new Date("2027-03-28T11:00:00+02:00") });
    await mockSeason(page, activePayload({ season: easter(), now: "2027-03-28T11:00:00+02:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const toast = page.getByTestId("easter-toast");
    await expect(toast).toBeVisible({ timeout: 8000 });
    // Kein Dialog davor: der Gruß ist das Oberste an seiner Stelle.
    expect(await toast.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })).toBe(true);
    await expect(toast).toContainText("Frohe Ostern wünscht THE LION SQUAD");
    await shot(page, testInfo, "gruss-pc.png");
    await page.goto("/news");
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("easter-toast")).toHaveCount(0);
  });
});
