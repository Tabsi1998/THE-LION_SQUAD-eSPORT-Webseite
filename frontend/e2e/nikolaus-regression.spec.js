const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Nikolaus (S8, X3 #736) über den Abnahme-Standard (C6, seasonQa.js): der Stiefel steht auf der Linie über dem
// Impressum - nie über Text oder Knöpfen, kein Überlauf, Reduced Motion still, Saison aus = nichts. Dazu der Hinweis
// „Zum Stiefel“ und das Öffnen ohne Anmeldung (die Karte zeigt den Weg zum Login).

function nikolaus(overrides = {}) {
  return { key: "nikolaus", label: "Nikolaus", phase: "stiefel", intensity: "normal", channels: ["web", "app"], texts: { greeting: "Der Nikolaus war da" }, starts_at: "2026-12-06T00:00:00+01:00", ends_at: "2026-12-06T23:59:59+01:00", forced: false, data: {}, ...overrides };
}

const NOW = "2026-12-06T10:00:00+01:00";

defineSeasonQa({
  title: "Nikolaus: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "nikolaus",
  now: NOW,
  season: nikolaus(),
  pieces: "[data-testid='nikolaus-boot']",
  layers: ".tls-nikolaus-scene, [data-testid='nikolaus-hint']",
  offPieces: "[data-testid^='nikolaus-']",
  settleMs: 2500,
  countPieces: () => ({ boots: document.querySelectorAll("[data-testid='nikolaus-boot']").length }),
  // Ein Stiefel, nie mehr - auch auf dem Handy steht er auf der Linie.
  mobileLimits: (counts, viewport, path) => {
    expect(counts.boots, `höchstens ein Stiefel (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(1);
  },
  reducedMotionState: () => ({
    boots: document.querySelectorAll("[data-testid='nikolaus-boot']").length,
    animated: [...document.querySelectorAll(".tls-nikolaus-boot, .tls-nikolaus-hint")].filter((el) => getComputedStyle(el).animationName !== "none").length,
  }),
  reducedMotion: (state) => {
    expect(state.boots).toBe(1);
    expect(state.animated).toBe(0);
  },
});

test.describe("Nikolaus: Hinweis und Stiefel", () => {
  test("Hinweis führt zum Stiefel, ohne Anmeldung zeigt die Karte den Weg zum Login", async ({ page, isMobile }, testInfo) => {
    await mockSeason(page, activePayload({ season: nikolaus(), now: NOW }));
    await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const hint = page.getByTestId("nikolaus-hint");
    await expect(hint).toBeVisible({ timeout: 8000 });
    await expect(hint).toContainText("Der Nikolaus war da");
    await expect(hint).toHaveAttribute("role", "status");
    await page.getByTestId("nikolaus-hint-go").click();
    await expect(hint).toHaveCount(0);
    const boot = page.getByTestId("nikolaus-boot");
    await expect(boot).toBeInViewport({ timeout: 5000 });
    await expect(boot).toBeFocused();
    // Der Stiefel steht auf der Linie über dem Impressum - seine Unterkante liegt auf ihr.
    const gap = await page.evaluate(() => {
      const line = document.querySelector("footer [data-season-line]").getBoundingClientRect();
      const art = document.querySelector("[data-testid='nikolaus-boot'] svg").getBoundingClientRect();
      return Math.abs(art.bottom - line.top);
    });
    expect(gap).toBeLessThanOrEqual(2);
    await boot.click();
    const card = page.getByTestId("nikolaus-card");
    await expect(card).toBeVisible({ timeout: 4000 });
    await expect(card).toHaveAttribute("data-kind", "guest");
    await expect(page.getByTestId("nikolaus-card-login")).toHaveAttribute("href", "/login");
    await testInfo.attach(`nikolaus-${isMobile ? "handy" : "pc"}.png`, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByTestId("nikolaus-card-close").click();
    await expect(card).toHaveCount(0);
  });
});
