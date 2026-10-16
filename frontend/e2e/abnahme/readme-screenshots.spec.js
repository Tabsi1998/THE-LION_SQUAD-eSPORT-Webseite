const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn } = require("./abnahmeSession");

// Bilder für die README (#1734), aufgenommen im Abnahme-Stand gegen den echten Server mit den Testdaten aus
// scripts/seed_abnahme.py - keine echten Mitglieder, keine echten Namen. Läuft nur mit ABNAHME=1 und README_SHOTS
// (Zielordner, z. B. ../docs/assets/readme). Der Workflow .github/workflows/readme-screenshots.yml erzeugt sie
// automatisch; von Hand: docs/entwicklung/github.md.

const TARGET = process.env.README_SHOTS || "";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function settle(page) {
  // Kein "networkidle": Live-Seiten fragen laufend nach und würden nie ruhig. Stattdessen laden lassen, warten, bis
  // keine Lade-Platzhalter mehr stehen, und Einblendungen zu Ende laufen lassen.
  await page.waitForLoadState("load");
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_500);
}

async function shot(page, name) {
  fs.mkdirSync(TARGET, { recursive: true });
  await page.screenshot({ path: path.join(TARGET, `${name}.jpg`), type: "jpeg", quality: 82 });
}

test.describe("README-Bilder aus dem Abnahme-Stand", () => {
  test.skip(!ENABLED || !TARGET, "nur mit ABNAHME=1 und README_SHOTS (siehe docs/entwicklung/github.md)");
  test.skip(ENABLED && !state?.slugs?.local_live, `Kein passender Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  });

  test("öffentlich am PC: Startseite, Turnierbaum, Fast Lap", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, "anon");

    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();
    await settle(page);
    await shot(page, "startseite");

    await page.goto(`/tournaments/${state.slugs.local_live}/bracket`);
    await expect(page.locator("#main-content")).toBeVisible();
    await settle(page);
    await shot(page, "turnierbaum");

    await page.goto(`/fastlap/${state.fastlap}`);
    await expect(page.locator("#main-content")).toBeVisible();
    await settle(page);
    await shot(page, "fastlap");
  });

  test("als Spieler am PC: Mein Bereich und Sieger-Moment", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, "player");

    await page.goto("/dashboard");
    await expect(page.locator("#main-content")).toBeVisible();
    await settle(page);
    await shot(page, "mein-bereich");

    // Beendete Liga mit geteiltem Platz 1: Spieler 1 sieht seinen Sieger-Moment (nur beim ersten Besuch).
    await page.goto(`/tournaments/${state.slugs.league_published}`);
    const moment = page.getByTestId("placement-moment");
    if (await moment.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.waitForTimeout(1_000);
      await shot(page, "sieger-moment");
      await page.getByTestId("placement-moment-close").click();
    }
    const podium = page.getByTestId("podium");
    await podium.scrollIntoViewIfNeeded();
    await expect(podium).toBeVisible();
    await settle(page);
    await shot(page, "podest");
  });

  test("am Handy: Startseite und Turnier", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, "player");

    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();
    await settle(page);
    await shot(page, "handy-startseite");

    await page.goto(`/tournaments/${state.slugs.local_live}`);
    await expect(page.locator("#main-content")).toBeVisible();
    await settle(page);
    await shot(page, "handy-turnier");
  });
});
