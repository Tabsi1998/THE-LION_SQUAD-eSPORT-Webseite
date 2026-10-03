const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Vereinsgeburtstag (S13 #644, B1–B3 #749–#751) über den Abnahme-Standard (C6, seasonQa.js): die Wimpelketten nie über
// Text, auf dem Handy höchstens zwei, Reduced Motion ohne Bewegung, Saison aus = nichts. Dazu die Karte: Kerzen nach
// Jahren, die nacheinander angehen, und einmal am Tag.

const NOW = "2027-03-01T11:00:00+01:00";

function birthday(overrides = {}) {
  return { key: "club_birthday", label: "Vereinsgeburtstag", phase: "feier", intensity: "normal", channels: ["web", "app"], texts: { greeting: "8 Jahre THE LION SQUAD – danke, dass ihr dabei seid" }, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "2027-03-01T23:59:59+01:00", forced: false, data: { years: 8, founded_on: "2019-03-01" }, ...overrides };
}

defineSeasonQa({
  title: "Vereinsgeburtstag: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "club_birthday",
  now: NOW,
  season: birthday(),
  pieces: "[data-testid='birthday-garland']",
  layers: ".tls-garlands, [data-testid='birthday-card']",
  offPieces: "[data-testid^='birthday-']",
  countPieces: () => ({ garlands: document.querySelectorAll("[data-testid='birthday-garland']").length }),
  mobileLimits: (counts, viewport, path) => {
    expect(counts.garlands, `höchstens zwei Ketten (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(2);
  },
  reducedMotionState: () => ({
    animated: [...document.querySelectorAll(".tls-garland, .tls-garland *, .tls-birthday-card, .tls-birthday-card *")].filter((el) => getComputedStyle(el).animationName !== "none").length,
    sky: document.querySelectorAll("[data-testid='season-sky']").length,
    unlit: document.querySelectorAll("[data-testid='birthday-candle'][data-lit='0']").length,
  }),
  reducedMotion: (state) => {
    expect(state.animated).toBe(0);
    expect(state.sky).toBe(0);
    expect(state.unlit).toBe(0);
  },
});

test.describe("Vereinsgeburtstag: die Karte", () => {
  test("Kerzen nach Jahren gehen nacheinander an; die Karte kommt einmal am Tag", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await page.clock.setFixedTime(new Date(NOW));
    await mockSeason(page, activePayload({ season: birthday(), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const card = page.getByTestId("birthday-card");
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toContainText("8 Jahre");
    await expect(page.getByTestId("birthday-candle")).toHaveCount(8);
    await expect(page.locator("[data-testid='birthday-candle'][data-lit='1']")).toHaveCount(8, { timeout: 8000 });
    await testInfo.attach("geburtstag-karte.png", { body: await card.screenshot(), contentType: "image/png" });
    // Ohne Anmeldung kein Sticker-Knopf.
    await expect(page.getByTestId("birthday-sticker-claim")).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("birthday-card")).toHaveCount(0);
  });
});
