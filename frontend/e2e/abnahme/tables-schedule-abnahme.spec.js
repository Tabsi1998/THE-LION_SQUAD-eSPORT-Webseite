const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Rangliste, Spielplan, Podest und Sieger-Moment
// (#1562) - nicht angemeldet, als Spieler und als Admin, am PC (1440) und am Handy (375). Keine Konsolenfehler, keine
// Antwort 4xx/5xx (außer „nicht angemeldet“ beim Abfragen der eigenen Sitzung, solange niemand angemeldet ist).
// Läuft nur mit ABNAHME=1; Kennungen und Zugänge aus .local-testing/abnahme/state.json (scripts/seed_abnahme.py).

const SHOTS = process.env.ABNAHME_SHOTS || "";
const SIZES = { desktop: { width: 1440, height: 900 }, handy: { width: 375, height: 812 } };

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "seitliches Überlaufen").toBeLessThanOrEqual(1);
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe("Abnahme #1562: Rangliste, Spielplan, Podest gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.slugs?.league_published, `Kein passender Seed-Stand: ${STATE_FILE} - erst scripts/seed_abnahme.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  for (const role of ["anon", "player", "admin"]) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      test(`${role} ${size}: Liga, Gruppen, Spielplan nach Runden und Stationen, Podest`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
        await page.setViewportSize(viewport);
        await signIn(page, role);
        // Nicht angemeldet ist die 401 der Sitzungsabfrage normal (der Browser meldet sie auch in der Konsole).
        const problems = role === "anon"
          ? watch(page, { allow: (response) => response.status() === 401 && /\/api\/auth\/(me|refresh)/.test(response.url()),
            allowConsole: (text) => /401/.test(text) })
          : watch(page);
        const slugs = state.slugs;
        const tag = `${role}-${size}`;

        // Liga (läuft): Tabelle, als Spieler die eigene Zeile mit „Du“.
        await page.goto(`/tournaments/${slugs.league}/standings`);
        await expect(page.getByRole("table").first()).toBeVisible();
        if (role === "player") await expect(page.locator("[data-mine='true']").first()).toContainText("Du");
        else await expect(page.locator("[data-mine='true']")).toHaveCount(0);
        await noSideScroll(page);
        await shot(page, `${tag}-liga-tabelle`);

        // Gruppen: je Gruppe eine Tabelle, als Spieler „Deine Gruppe“.
        await page.goto(`/tournaments/${slugs.groups}/standings`);
        await expect(page.getByRole("table")).toHaveCount(2);
        await expect(page.getByRole("heading", { name: /Gruppe A/ })).toBeVisible();
        if (role === "player") await expect(page.getByText("Deine Gruppe")).toBeVisible();
        else await expect(page.getByText("Deine Gruppe")).toHaveCount(0);
        await noSideScroll(page);
        await shot(page, `${tag}-gruppen-tabellen`);

        // Spielplan vor Ort: nach Runden, nach Stationen, als Spieler „Nur meine Spiele“.
        await page.goto(`/tournaments/${slugs.local_live}/matches`);
        await expect(page.getByTestId("schedule-toolbar")).toBeVisible();
        await expect(page.locator("[data-testid^='schedule-match-']").first()).toBeVisible();
        await noSideScroll(page);
        await shot(page, `${tag}-spielplan-runden`);
        await page.getByTestId("schedule-view-stations").click();
        await expect(page.getByTestId("schedule-stations")).toBeVisible();
        await expect(page.locator("[data-testid^='schedule-line-']").first()).toBeVisible();
        await noSideScroll(page);
        await shot(page, `${tag}-spielplan-stationen`);
        if (role === "player") {
          const before = await page.locator("[data-testid^='schedule-line-']").count();
          await page.getByTestId("schedule-only-mine").click();
          await expect.poll(() => page.locator("[data-testid^='schedule-line-']").count()).toBeLessThan(before);
          await expect(page.locator("[data-testid^='schedule-line-']").first()).toBeVisible();
          await shot(page, `${tag}-spielplan-nur-meine`);
        } else if (role === "anon") {
          await expect(page.getByTestId("schedule-only-mine")).toHaveCount(0);
        }

        // Liga beendet und veröffentlicht: Podest mit geteiltem Platz 1, Sieger-Moment nur für Spieler 1 - einmal.
        await page.goto(`/tournaments/${slugs.league_published}`);
        if (role === "player") {
          const moment = page.getByTestId("placement-moment");
          await expect(moment).toBeVisible();
          await expect(moment).toContainText("Champion");
          await page.waitForTimeout(800);
          await shot(page, `${tag}-sieger-moment`);
          await page.getByTestId("placement-moment-close").click();
          await expect(moment).toHaveCount(0);
        } else {
          await page.waitForTimeout(1_500);
          await expect(page.getByTestId("placement-moment")).toHaveCount(0);
        }
        const podium = page.getByTestId("podium");
        await podium.scrollIntoViewIfNeeded();
        await expect(podium).toBeVisible();
        await expect(page.getByTestId("podium-provisional")).toHaveCount(0);
        await page.waitForTimeout(1_200);
        await noSideScroll(page);
        await shot(page, `${tag}-podest`);
        if (role === "player") {
          await page.reload();
          await expect(page.getByTestId("podium")).toBeVisible();
          await page.waitForTimeout(1_500);
          await expect(page.getByTestId("placement-moment")).toHaveCount(0);
        }
        await page.goto(`/tournaments/${slugs.league_published}/standings`);
        await expect(page.getByRole("table").first()).toBeVisible();
        await shot(page, `${tag}-liga-beendet-tabelle`);

        expect(problems).toEqual([]);
      });
    }
  }
});
