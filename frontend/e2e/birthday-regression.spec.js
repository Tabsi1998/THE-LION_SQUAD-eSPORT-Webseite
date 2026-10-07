const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Vereinsgeburtstag (S13 #644, B1–B3 #749–#751) über den Abnahme-Standard (C6, seasonQa.js): die Wimpelketten nie über
// Text, auf dem Handy höchstens zwei, Reduced Motion ohne Bewegung, Saison aus = nichts. Dazu die Karte: die Jahre als
// Zahlkerzen, die nacheinander angehen, und einmal am Tag. Seit #856 die Mütze mit der Zahl der Jahre auf dem Löwen
// (nie über Text, ohne Bewegung kein Knopf) und Luftballons auf dem Himmel hinter dem Inhalt.

const NOW = "2027-03-01T11:00:00+01:00";

function birthday(overrides = {}) {
  return { key: "club_birthday", label: "Vereinsgeburtstag", phase: "feier", intensity: "normal", channels: ["web", "app"], texts: { greeting: "8 Jahre THE LION SQUAD – danke, dass ihr dabei seid" }, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "2027-03-01T23:59:59+01:00", forced: false, data: { years: 8, founded_on: "2019-03-01" }, ...overrides };
}

defineSeasonQa({
  title: "Vereinsgeburtstag: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "club_birthday",
  now: NOW,
  season: birthday(),
  // Seit #1094 auch Wimpelketten an Karten - jeder Wimpel einzeln.
  pieces: "[data-testid='birthday-garland'], [data-testid='birthday-hat'], [data-testid='birthday-hero-hat'], [data-testid='birthday-card-pennant']",
  layers: ".tls-garlands, .tls-mascot-hat-page, [data-testid='birthday-card']",
  exempt: "[data-testid='tls-logo-link'], [data-testid='tls-logo'], [data-season-anchor='lion']",
  offPieces: "[data-testid^='birthday-']",
  countPieces: () => ({
    garlands: document.querySelectorAll("[data-testid='birthday-garland']").length,
    hats: document.querySelectorAll("[data-testid='birthday-hat'], [data-testid='birthday-hero-hat']").length,
  }),
  mobileLimits: (counts, viewport, path) => {
    expect(counts.garlands, `höchstens zwei Ketten (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(2);
    expect(counts.hats, `höchstens zwei Mützen (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(2);
  },
  reducedMotionState: () => ({
    animated: [...document.querySelectorAll(".tls-garland, .tls-garland *, .tls-birthday-card, .tls-birthday-card *, .tls-birthday-hat, .tls-birthday-hat *")].filter((el) => getComputedStyle(el).animationName !== "none").length,
    sky: document.querySelectorAll("[data-testid='season-sky']").length,
    unlit: document.querySelectorAll("[data-testid='birthday-candle'][data-lit='0']").length,
    buttons: document.querySelectorAll("button[data-testid='birthday-hat'], button[data-testid='birthday-hero-hat']").length,
  }),
  reducedMotion: (state) => {
    expect(state.animated).toBe(0);
    expect(state.sky).toBe(0);
    expect(state.unlit).toBe(0);
    expect(state.buttons).toBe(0);
  },
});

test.describe("Vereinsgeburtstag: die Karte", () => {
  test("die Jahre als Zahlkerze gehen an; die Karte kommt einmal am Tag", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await page.clock.setFixedTime(new Date(NOW));
    await mockSeason(page, activePayload({ season: birthday(), now: NOW }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const card = page.getByTestId("birthday-card");
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toContainText("8 Jahre");
    await expect(page.getByTestId("birthday-candle")).toHaveCount(1);
    await expect(page.getByTestId("birthday-candle")).toHaveAttribute("data-digit", "8");
    await expect(page.locator("[data-testid='birthday-candle'][data-lit='1']")).toHaveCount(1, { timeout: 8000 });
    await testInfo.attach("geburtstag-karte.png", { body: await card.screenshot(), contentType: "image/png" });
    // Ohne Anmeldung kein Sticker-Knopf.
    await expect(page.getByTestId("birthday-sticker-claim")).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("birthday-card")).toHaveCount(0);
  });
});

test.describe("Vereinsgeburtstag: die Mütze", () => {
  test("die Mütze mit der Zahl der Jahre sitzt auf dem Löwen im Kopf und lässt sich antippen", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date(NOW));
    await mockSeason(page, activePayload({ season: birthday(), now: NOW }));
    await page.goto("/");
    const hat = page.getByTestId("birthday-hat");
    await expect(hat).toBeVisible({ timeout: 15000 });
    await expect(hat.getByTestId("birthday-hat-number")).toHaveText("8");
    const logo = await page.getByTestId("tls-logo").first().boundingBox();
    const box = await hat.boundingBox();
    expect(box.y + box.height).toBeGreaterThan(logo.y - 2);
    expect(box.x + box.width / 2).toBeGreaterThan(logo.x);
    await hat.click();
    await expect(hat).toHaveClass(/tls-mascot-hat--wiggle/);
    await testInfo.attach("geburtstag-muetze.png", { body: await page.screenshot({ clip: { x: 0, y: 0, width: page.viewportSize().width, height: 140 } }), contentType: "image/png" });
  });
});
