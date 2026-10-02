const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Silvester (S9 #640, N1–N6 #739–#744) über den Abnahme-Standard (C6, seasonQa.js): in der Show kein Überlauf, keine
// Deko über Text (das Feuerwerk liegt auf der Himmelsfläche, Countdown und Gruß sind Karten), Reduced Motion ohne
// Raketen und ohne Bewegung, Saison aus = nichts. Dazu der Countdown nach der Serveruhr bis zum Gruß um 00:00.

function newYear(phase, overrides = {}) {
  return { key: "new_year", label: "Silvester", phase, intensity: "full", channels: ["web", "app"], texts: { greeting: "Frohes neues Jahr wünscht THE LION SQUAD" }, starts_at: "2026-12-29T18:00:00+01:00", ends_at: "2027-01-01T23:59:59+01:00", forced: false, data: { seed: 2027000, salvos: [5, 9, 14, 20, 26, 33, 41, 50], rate_per_hour: { min: 720, max: 1440 }, show_start: "2027-01-01T00:00:00+01:00" }, ...overrides };
}

defineSeasonQa({
  title: "Silvester: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "new_year",
  now: "2027-01-01T00:00:03+01:00",
  season: newYear("show"),
  pieces: "[data-testid='new-year-widget']",
  // Das Kopf-Element zählt mit seinem eigenen Knopf nicht als Untergrund - geprüft wird, dass es nichts anderes verdeckt.
  layers: "[data-testid='new-year-widget'], [data-testid='new-year-countdown'], [data-testid='new-year-zero'], [data-testid='new-year-toast']",
  offPieces: "[data-testid^='new-year-']",
  settleMs: 2500,
  countPieces: () => ({ widgets: document.querySelectorAll("[data-testid='new-year-widget']").length }),
  mobileLimits: (counts, viewport, path) => {
    expect(counts.widgets, `höchstens ein Silvester-Platz im Kopf (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(1);
  },
  reducedMotionState: () => ({
    animated: [...document.querySelectorAll(".tls-ny-countdown, .tls-ny-countdown *, .tls-ny-toast, .tls-ny-toast *")].filter((el) => getComputedStyle(el).animationName !== "none").length,
  }),
  reducedMotion: (state) => {
    expect(state.animated).toBe(0);
  },
});

test.describe("Silvester: Countdown und Gruß", () => {
  test("Countdown nach der Serveruhr: ruhig, Puls in den letzten zehn Sekunden, um 00:00 der Gruß; Ton aus", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, activePayload({ season: newYear("countdown"), now: "2026-12-31T23:59:45+01:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const countdown = page.getByTestId("new-year-countdown");
    await expect(countdown).toBeVisible({ timeout: 8000 });
    await expect(countdown).toHaveAttribute("role", "timer");
    await expect(page.getByTestId("new-year-countdown-sound")).toHaveAttribute("aria-pressed", "false");
    await expect(countdown).toHaveAttribute("data-stage", "pulse", { timeout: 8000 });
    await testInfo.attach("silvester-countdown.png", { body: await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 400 } }), contentType: "image/png" });
    const zero = page.getByTestId("new-year-zero");
    await expect(zero).toBeVisible({ timeout: 15000 });
    await expect(zero).toContainText("Frohes neues Jahr 2027!");
    // Nie blockierend: die Navigation bleibt bedienbar, während der Gruß steht.
    const link = page.locator("header nav a").first();
    const point = await link.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("header")), point)).toBe(true);
  });
});
