const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Season-Seite mit Reitern (#2267, docs/LIGA.md „Season-Seite der Verwaltung“) gegen den echten Server, ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (ABNAHME_STATE auf dessen Stand-Datei): Spiel „Call of Duty“ mit den Seed-Modi und die Liga der
// Anmeldung. Eine neue, leere Season wird nur über die Reiter eingerichtet, bis „Was fehlt noch?“ „Bereit zur Veröffentlichung“ sagt:
// Termine, Modi und Maps, Serie, Liga 1 (mit Hinweis beim Beinamen „Liga 1“) und Staffel, Regelwerk (über den Weg aus dem Reiter),
// Anmeldefenster, dann Veröffentlichen im Überblick. Danach jeder Reiter bei 390 px ohne seitliches Scrollen.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const stamp = Date.now().toString(36);
const game = state?.game;
const anmeldung = state?.anmeldung;

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function csrfHeaders(page) {
  const cookie = (await page.context().cookies()).find((row) => row.name === "csrf_token");
  return cookie ? { "X-CSRF-Token": decodeURIComponent(cookie.value) } : {};
}

async function ok(page, method, url, data) {
  const response = await page.request.fetch(url, { method, data, headers: await csrfHeaders(page) });
  const body = await response.json().catch(() => null);
  expect(response.status(), `${method} ${url}: ${JSON.stringify(body)}`).toBe(200);
  return body;
}

function viennaToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(new Date());
}

/** Ein Wert für ein Feld datetime-local in Wiener Zeit. */
function localInput(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const TABS = ["ueberblick", "spielbetrieb", "termine", "anmeldung", "tabelle", "regelwerk", "ligen"];

test.describe("Abnahme: Season von null über die Reiter einrichten", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !(game && anmeldung), `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  let seasonId = "";

  test("Leitung richtet die Season nur über die Reiter ein, bis sie bereit ist (1440 px)", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 }, locale: "de-AT", timezoneId: "Europe/Vienna" });
    const page = await context.newPage();
    await signIn(page, "admin");
    const problems = watch(page);

    // Die leere Season (wie „Season anlegen“: nur Name und Beginn) - neun Tage voraus.
    const start = new Date(Date.now() + 9 * 86_400_000);
    const fresh = await ok(page, "POST", `/api/admin/leagues/${anmeldung.league.id}/seasons`, {
      name: `Reiter ${stamp}`, slug: `reiter-${stamp}`, start_date: `${start.toISOString().slice(0, 10)}T00:00:00` });
    seasonId = fresh.id;

    // Überblick: Ablauf und was noch fehlt.
    await page.goto(`/admin/leagues/seasons/${seasonId}`);
    await expect(page.getByTestId("season-phases")).toBeVisible();
    await expect(page.getByTestId("season-readiness-state")).toContainText("Probleme vor der Veröffentlichung");
    await expect(page.getByTestId("season-readiness-problems")).toContainText("keinen Map-Pool");
    await shot(page, "season-reiter-start-1440.png");

    // Sprung aus „Was fehlt noch?“ in den Reiter Spielbetrieb: Modi anhaken, je Modus zwei Maps.
    await page.getByTestId("season-readiness-problems-go-pool_missing").click();
    await expect(page.getByTestId("season-tab-spielbetrieb")).toHaveAttribute("aria-selected", "true");
    for (const mode of ["stellung", "suchen"]) {
      await page.getByTestId(`season-pool-pick-${mode}`).check();
      const group = page.getByTestId(`season-pool-mode-${mode}`);
      for (const index of [0, 1]) await group.getByRole("checkbox").nth(index).check();
    }
    await expect(page.getByTestId("season-tab-dirty-spielbetrieb")).toBeVisible();
    await page.getByTestId("season-pool-save").click();
    await expect(page.getByText("Map-Pool gespeichert.").first()).toBeVisible();
    await expect(page.getByTestId("season-pool-pick-stellung")).toBeChecked();

    // Serie: Modus je Map setzen und speichern - nur die Felder des Reiters gehen an den Server.
    const sent = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && new URL(request.url()).pathname === `/api/admin/leagues/seasons/${seasonId}`) sent.push(request.postDataJSON());
    });
    await page.getByTestId("mode-order-0").selectOption("suchen");
    await page.getByTestId("mode-order-1").selectOption("stellung");
    await page.getByTestId("mode-order-2").selectOption("suchen");
    await expect(page.getByTestId("season-mode-order-hints")).toHaveCount(0);
    await page.getByTestId("season-save-spielbetrieb").click();
    await expect(page.getByText("Spielbetrieb gespeichert.").first()).toBeVisible();
    expect(Object.keys(sent.at(-1)).sort()).toEqual(["best_of", "game_mode_order", "lineup_amend_hours", "map_repeat", "result_confirm_hours", "team_size"]);
    await expect(page.getByTestId("result-rules-stellung")).toBeVisible();
    await expect(page.getByTestId("result-rules-kontrolle")).toHaveCount(0);
    await shot(page, "season-reiter-spielbetrieb-1440.png");

    // Termine: eine Sperrzeit eintragen, Rückfrage beim Wechsel, dann speichern.
    await page.getByTestId("season-tab-termine").click();
    await page.getByTestId("season-form-weeks").fill("9");
    await page.getByTestId("season-tab-tabelle").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("„Termine“ ist nicht gespeichert");
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByText("Termine gespeichert.").first()).toBeVisible();
    await expect(page.getByTestId("season-tab-tabelle")).toHaveAttribute("aria-selected", "true");
    expect(sent.at(-1).weeks_total).toBe(9);

    // Ligen und Staffeln: Beiname „Liga 1“ bekommt den Hinweis, dann ohne Beinamen anlegen, Staffel A dazu.
    await page.getByTestId("season-tab-ligen").click();
    await page.getByTestId("division-add").click();
    const sheet = page.getByTestId("division-sheet");
    await sheet.getByTestId("division-nickname").fill("Liga 1");
    await expect(sheet.getByTestId("division-nickname-repeat")).toBeVisible();
    await sheet.getByTestId("division-nickname").fill("");
    await sheet.getByTestId("division-save").click();
    await expect(page.getByTestId("division-1")).toContainText("Liga 1");
    await page.getByTestId("staffel-add-1").click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId("staffel-1-A")).toBeVisible();

    // Regelwerk: der Weg aus dem Reiter, eine Fassung veröffentlichen (Inhalt prüfen andere Specs), zurück in den Reiter.
    await page.getByTestId("season-tab-regelwerk").click();
    await expect(page.getByTestId("season-rules-missing")).toBeVisible();
    await page.getByTestId("season-rules-link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/leagues/rules/league_season/${seasonId}`));
    const scope = `/api/admin/league-rules/league_season/${seasonId}`;
    const draft = await ok(page, "PUT", `${scope}/draft`, { title: "Regelwerk Reiter", body_md: "# Fairplay\n\nFair spielen. Erfunden.\n", annexes: [] });
    await ok(page, "POST", `${scope}/publish`, { revision: draft.revision, valid_from: viennaToday(), change_reason: "Fassung für die Abnahme", requires_consent: false });
    await page.getByTestId("rules-back").click();
    await expect(page).toHaveURL(new RegExp(`/admin/leagues/seasons/${seasonId}#regelwerk$`));
    await expect(page.getByTestId("season-rules-state")).toContainText("Gültig: Version 1");

    // Anmeldung und Kader: Fenster ab jetzt bis vor den Beginn, Startplätze.
    await page.getByTestId("season-tab-anmeldung").click();
    await page.getByTestId("season-form-application-opens").fill(localInput(new Date(Date.now() - 60 * 60 * 1000)));
    await page.getByTestId("season-form-application-closes").fill(localInput(new Date(Date.now() + 2 * 86_400_000)));
    await page.getByTestId("season-form-application-slots").fill("8");
    await page.getByTestId("season-save-anmeldung").click();
    await expect(page.getByText("Anmeldung und Kader gespeichert.").first()).toBeVisible();

    // Überblick: bereit, Phase Anmeldung, veröffentlichen.
    await page.getByTestId("season-tab-ueberblick").click();
    await page.getByTestId("season-readiness-reload").click();
    await expect(page.getByTestId("season-readiness-state")).toContainText("Bereit zur Veröffentlichung");
    await expect(page.getByTestId("season-phase-anmeldung")).toHaveAttribute("data-state", "current");
    await page.getByTestId("season-form-visibility").selectOption("members");
    await page.getByTestId("season-save-ueberblick").click();
    await expect(page.getByText("Überblick gespeichert.").first()).toBeVisible();
    expect((await ok(page, "GET", `/api/admin/leagues/seasons/${seasonId}`)).season.visibility).toBe("members");
    await noSideScroll(page);
    await shot(page, "season-reiter-bereit-1440.png");
    expect(problems).toEqual([]);
    await context.close();
  });

  test("jeder Reiter bei 390 px ohne seitliches Scrollen", async ({ browser }, testInfo) => {
    test.skip(!seasonId, "braucht die Season aus dem Test davor");
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 390, height: 844 }, locale: "de-AT", timezoneId: "Europe/Vienna" });
    const page = await context.newPage();
    await signIn(page, "admin");
    const problems = watch(page);
    await page.goto(`/admin/leagues/seasons/${seasonId}`);
    await expect(page.getByTestId("season-tabs-hint")).toBeVisible();
    for (const tab of TABS) {
      await page.getByTestId(`season-tab-${tab}`).click();
      await expect(page.getByTestId(`season-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
      await noSideScroll(page);
      await shot(page, `season-reiter-${tab}-390.png`);
    }
    expect(problems).toEqual([]);
    await context.close();
  });
});
