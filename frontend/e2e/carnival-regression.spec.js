const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Fasching (S12 #643, F1–F3 #745–#747) über den Abnahme-Standard (C6, seasonQa.js): Luftschlangen und Hüte nie über
// Text (der Hut im Kopf sitzt auf dem Logo, der große auf dem Löwen - beide zählen nicht als Untergrund), auf dem
// Handy höchstens eine Luftschlange je Seite, Reduced Motion ohne Konfetti und ohne Bewegung, Saison aus = nichts.
// Dazu: der Konfetti-Regen kommt einmal am Tag, danach schläft die Himmelsfläche; der Hut auf dem Löwen wirft Konfetti.

const NOW = "2027-02-09T15:00:00+01:00";

function carnival(overrides = {}) {
  return { key: "carnival", label: "Fasching", phase: "deko", intensity: "normal", channels: ["web", "app"], texts: { greeting: "Schönen Fasching" }, starts_at: "2027-02-09T00:00:00+01:00", ends_at: "2027-02-09T23:59:59+01:00", forced: false, data: {}, ...overrides };
}

defineSeasonQa({
  title: "Fasching: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "carnival",
  now: NOW,
  season: carnival(),
  pieces: "[data-testid='carnival-streamer'], [data-testid='carnival-hat'], [data-testid='carnival-hero-hat']",
  layers: ".tls-streamers, .tls-party-hat-page, [data-testid='carnival-toast']",
  exempt: "[data-testid='tls-logo-link'], [data-testid='tls-logo'], [data-season-anchor='lion']",
  offPieces: "[data-testid^='carnival-']",
  countPieces: () => ({
    streamers: document.querySelectorAll("[data-testid='carnival-streamer']").length,
    hats: document.querySelectorAll("[data-testid='carnival-hat'], [data-testid='carnival-hero-hat']").length,
  }),
  mobileLimits: (counts, viewport, path) => {
    if (viewport.width < 640) expect(counts.streamers, `höchstens eine Luftschlange je Seite (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(2);
    expect(counts.hats, `höchstens zwei Hüte (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(2);
  },
  reducedMotionState: () => ({
    animated: [...document.querySelectorAll(".tls-streamer, .tls-streamer *, .tls-party-hat, .tls-party-hat *, .tls-carnival-toast")].filter((el) => getComputedStyle(el).animationName !== "none").length,
    sky: document.querySelectorAll("[data-testid='season-sky']").length,
    buttons: document.querySelectorAll("button[data-testid='carnival-hat'], button[data-testid='carnival-hero-hat']").length,
  }),
  reducedMotion: (state) => {
    expect(state.animated).toBe(0);
    // Kein Konfetti (keine Himmelsfläche) und kein Hut, der sich antippen lässt.
    expect(state.sky).toBe(0);
    expect(state.buttons).toBe(0);
  },
});

/** Zeichnet die Himmelsfläche gerade? Geparkt (schlafend) hat sie nur einen Punkt. */
async function skyAwake(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-testid='season-sky']");
    return Boolean(canvas && canvas.width > 1);
  });
}

test.describe("Fasching: Konfetti", () => {
  test("Regen einmal am Tag, danach schläft der Himmel; der Hut auf dem Löwen weckt ihn mit einer Handvoll Konfetti", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    test.setTimeout(90000);
    await page.clock.setFixedTime(new Date(NOW));
    await mockSeason(page, activePayload({ season: carnival(), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect.poll(() => skyAwake(page), { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(1200);
    await testInfo.attach("fasching-regen.png", { body: await page.screenshot(), contentType: "image/png" });
    // Der Regen dauert ein paar Sekunden, liegende Stücke verblassen - dann schläft die Fläche.
    await expect.poll(() => skyAwake(page), { timeout: 25000, intervals: [1000] }).toBe(false);

    // Zweiter Aufruf am selben Tag: kein Regen mehr.
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='carnival-hero-hat']").length), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(1500);
    expect(await skyAwake(page)).toBe(false);

    // Der Hut wirft Konfetti und wippt.
    const hat = page.getByTestId("carnival-hero-hat");
    await hat.click();
    await expect(hat).toHaveClass(/tls-party-hat--wiggle/);
    await expect.poll(() => skyAwake(page), { timeout: 3000 }).toBe(true);
    await testInfo.attach("fasching-hut.png", { body: await page.screenshot({ clip: { x: 760, y: 80, width: 680, height: 520 } }), contentType: "image/png" });
  });

  test("dezent: Hüte und Luftschlangen bleiben, aber kein Konfetti und nichts zum Antippen", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, activePayload({ season: carnival({ intensity: "subtle" }), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-testid='carnival-hero-hat']").length), { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => ({
      sky: document.querySelectorAll("[data-testid='season-sky']").length,
      buttons: document.querySelectorAll("button[data-testid^='carnival-']").length,
      streamers: document.querySelectorAll("[data-testid='carnival-streamer']").length,
      swaying: document.querySelectorAll(".tls-streamer--sway").length,
    }));
    expect(state.sky).toBe(0);
    expect(state.buttons).toBe(0);
    expect(state.streamers).toBeGreaterThan(0);
    expect(state.swaying).toBe(0);
  });
});
