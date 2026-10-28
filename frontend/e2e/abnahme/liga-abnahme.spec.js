const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Liga Stufe 1 gegen den echten Server (docs/LIGA.md, P6, #2096) - ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (eigene Stand-Datei, ABNAHME_STATE): CoD-Liga, Season 1 mit Weihnachtspause, Liga 1,
// Staffel A mit acht zugeteilten Co-Teams, Sichtbarkeit „Nur Turnierleitung“. Bei 390 und 1440 px: Verwaltung „Liga“
// mit Season und Staffel, die Staffel in der Turnierverwaltung (Co-Team zuteilen, „Liga starten“) und die Ligaseite;
// ohne Anmeldung ist die Season noch nicht da. Liest nur - der Seed stellt eine gestartete Staffel nicht zurück.
// Keine Konsolenfehler, keine Antwort 4xx/5xx außer dem erwarteten 404 ohne Anmeldung.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const seasonUrl = () => `/liga/${state.league.slug}/${state.season.slug}`;

test.describe("Abnahme: Liga gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !state?.league, `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  for (const [width, height] of WIDTHS) {
    test(`Verwaltung (${width} px): Liga, Season mit Pause und Pool, Staffel A mit acht Co-Teams`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
      await page.setViewportSize({ width, height });
      await signIn(page, "lead");
      const problems = watch(page);

      await page.goto("/admin/leagues");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Liga");
      await expect(page.getByTestId(`season-link-${state.season.slug}`)).toBeVisible();
      await noSideScroll(page);
      await shot(page, `liga-verwaltung-${width}.png`);

      await page.goto(`/admin/leagues/seasons/${state.season.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Season 1");
      await expect(page.getByTestId("season-calendar")).toContainText("8 Spielwochen");
      await expect(page.getByTestId("blocked-label-0")).toHaveValue("Weihnachtspause");
      await expect(page.getByTestId("season-pool")).toContainText("Hafenkante");
      await expect(page.getByTestId("staffel-1-A")).toContainText("8 von 8 Teams");
      await noSideScroll(page);
      await shot(page, `liga-season-${width}.png`);

      await page.getByTestId("staffel-manage-1-A").click();
      await expect(page).toHaveURL(new RegExp(`/admin/tournaments/${state.staffel.tournament_id}`));
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Staffel A");
      if (state.staffel.status === "draft") {
        // Eine Staffel startet ohne Check-in (#2096) - der Knopf heißt „Liga starten“. Gedrückt wird er hier nicht.
        await expect(page.getByTestId("admin-tr-primary-action")).toContainText("Liga starten");
      }
      await page.getByTestId("admin-tr-tab-participants").click();
      await expect(page.getByTestId("squad-assign-open")).toBeVisible();
      // Handy: Karten, Desktop: Tabelle - je Breite ist nur eine Fassung sichtbar.
      await expect(page.getByText(`${state.teams[0].name} · ${state.teams[0].squad_name}`).filter({ visible: true }).first()).toBeVisible();
      await noSideScroll(page);
      await shot(page, `liga-staffel-verwaltung-${width}.png`);
      expect(problems).toEqual([]);
    });

    test(`Ligaseite (${width} px): Staffel A, acht Teams, Weihnachtspause`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein");
      await page.setViewportSize({ width, height });
      await signIn(page, "lead");
      const problems = watch(page);

      await page.goto(seasonUrl());
      await expect(page.getByTestId("league-facts")).toBeVisible();
      const staffel = page.getByTestId("league-staffel-A");
      await expect(staffel).toBeVisible();
      await expect(staffel.locator('[data-testid^="league-team-"]')).toHaveCount(8);
      await expect(staffel.getByTestId("league-week-7")).toContainText("Weihnachtspause");
      await expect(staffel.getByTestId("league-week-8")).toContainText("Weihnachtspause");
      await noSideScroll(page);
      await shot(page, `liga-seite-${width}.png`);
      expect(problems).toEqual([]);
    });
  }

  test("Ohne Anmeldung: die Season ist noch nicht sichtbar (Nur Turnierleitung)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "einmal genügt");
    test.skip(state.season.visibility !== "admins", "der Seed stellt „Nur Turnierleitung“ - hier ist schon etwas anderes eingestellt");
    await signIn(page, "anon");
    // Das 404 der Lese-API ist hier die erwartete Antwort - der Browser meldet es zusätzlich in der Konsole.
    const problems = watch(page, {
      allow: (response) => response.status() === 404 && response.url().includes("/api/leagues/"),
      allowConsole: (text) => text.includes("status of 404"),
    });
    await page.goto(seasonUrl());
    await expect(page.getByTestId("league-missing")).toContainText("Liga nicht gefunden");
    expect(problems).toEqual([]);
  });
});
