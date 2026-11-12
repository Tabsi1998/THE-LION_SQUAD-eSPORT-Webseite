const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Spielmodi mit Zustand und Ergebnisregel (#2206, docs/LIGA.md C.1) gegen den echten Server, ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (ABNAHME_STATE auf dessen Stand-Datei): Spiel „Call of Duty“ und die Season der Liga-Anmeldung.
// Je Breite (390 und 1440 px): Modus mit Ergebnisregel in der Spiele-Verwaltung anlegen, im Map-Pool der Season verwenden und auf
// die Staffel übertragen, Entfernen wird abgelehnt (Schloss im Formular, 409 über die API), deaktivieren, im neuen Pool nicht mehr
// wählbar (Hinweis im Editor, 422 über die API), Staffel und Ligaseite zeigen ihn weiter. Die Seed-Modi bleiben unberührt; jeder
// Lauf legt eigene, erfundene Modi an.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const stamp = Date.now().toString(36);
const game = state?.game;
const anmeldung = state?.anmeldung;
const MAP = "Hafenkante";
// Erwartete Ablehnungen dieser Spec: 409 beim Entfernen, 422 beim neuen Pool.
const expected = (response) => (response.status() === 409 && /\/api\/games\/[^/]+$/.test(response.url()))
  || (response.status() === 422 && /\/default-pool$/.test(response.url()));

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

async function apiJson(page, method, url, data) {
  const response = await page.request.fetch(url, { method, data, headers: await csrfHeaders(page) });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

// Seit #2249 stehen die Modi auf der Spielseite im Reiter Modi - erreicht über das Zahnrad der Spieleliste.
async function openGameSheet(page) {
  await page.goto("/admin/games");
  await page.getByTestId(`game-settings-${game.slug}`).click();
  await page.getByTestId("game-tab-modi").click();
  await expect(page.getByTestId("game-tab-modi")).toHaveAttribute("aria-selected", "true");
}

test.describe("Abnahme: Spielmodi gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !(game && anmeldung), `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  for (const [width, height] of WIDTHS) {
    test(`Modus anlegen, verwenden, nur deaktivieren (${width} px)`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT", timezoneId: "Europe/Vienna" });
      const page = await context.newPage();
      await signIn(page, "admin");
      const problems = watch(page, { allow: expected });
      const label = `Probe ${stamp} ${width}`;

      // 1. Anlegen mit Ergebnisregel - geführt in der Spiele-Verwaltung.
      const before = (await apiJson(page, "GET", `/api/games/${game.id}`)).body;
      const index = (before.match_modes || []).length;
      test.skip(index >= 19, "Das Spiel hat fast 20 Modi - Stand neu aufsetzen");
      await openGameSheet(page);
      await page.getByTestId("game-edit-mode-add").click();
      // Eine neue Zeile kommt aufgeklappt.
      await page.getByTestId(`game-edit-mode-label-${index}`).fill(label);
      await page.getByTestId(`game-edit-mode-players-${index}`).fill("4");
      await page.getByTestId(`game-edit-mode-rule-kind-${index}`).selectOption("rounds");
      await page.getByTestId(`game-edit-mode-rule-target-${index}`).fill("6");
      await page.getByTestId(`game-edit-mode-rule-limit-${index}`).fill("11");
      await page.getByTestId(`game-edit-mode-rule-overtime-${index}`).check();
      await expect(page.getByTestId(`game-edit-mode-more-${index}`)).toContainText("Runden gewinnen: 6 Siege, höchstens 11 Runden");
      await noSideScroll(page);
      await shot(page, `spielmodi-anlegen-${width}.png`);
      await page.getByTestId("game-save-modi").click();
      await expect(page.getByText("Spiel gespeichert.", { exact: false }).first()).toBeVisible();
      const created = (await apiJson(page, "GET", `/api/games/${game.id}`)).body.match_modes.find((mode) => mode.label === label);
      expect(created).toMatchObject({ players_per_side: 4, result_rule: { kind: "rounds", target: 6, round_limit: 11, overtime: true } });
      expect(created.status).toBeUndefined();
      const key = created.mode;

      // 2. Verwenden: Map zuordnen, im Pool der Season wählen, auf die Staffel übertragen.
      const maps = (await apiJson(page, "GET", `/api/games/${game.id}/maps`)).body.maps;
      const map = maps.find((row) => row.name === MAP);
      expect((await apiJson(page, "PATCH", `/api/games/${game.id}/maps/${map.id}`, { modes: [...map.modes, key] })).status).toBe(200);
      // Reiter Spielbetrieb (#2267): den Modus der Season anhaken, dann erscheinen seine Maps.
      await page.goto(`/admin/leagues/seasons/${anmeldung.season.id}#modi`);
      await page.getByTestId(`season-pool-pick-${key}`).check();
      const group = page.getByTestId(`season-pool-mode-${key}`);
      await expect(group).toContainText(label);
      await group.getByRole("checkbox", { name: `${MAP} in ${label}` }).check();
      await page.getByTestId("season-pool-save").click();
      await expect(page.getByText("Map-Pool gespeichert.").first()).toBeVisible();
      expect((await apiJson(page, "POST", `/api/admin/leagues/seasons/${anmeldung.season.id}/sync`)).status).toBe(200);
      const staffelPool = (await apiJson(page, "GET", `/api/map-pools/tournaments/${anmeldung.tournament_id}`)).body;
      expect(JSON.stringify(staffelPool)).toContain(label);

      // 3. Entfernen wird abgelehnt: Schloss im Formular, 409 auch direkt über die API.
      await openGameSheet(page);
      await expect(page.getByTestId(`game-edit-mode-locked-${index}`)).toBeVisible();
      await expect(page.getByTestId(`game-edit-mode-remove-${index}`)).toHaveCount(0);
      await expect(page.getByTestId(`game-edit-mode-used-${index}`)).toContainText("nur deaktivieren oder archivieren");
      const current = (await apiJson(page, "GET", `/api/games/${game.id}`)).body.match_modes;
      const refused = await apiJson(page, "PATCH", `/api/games/${game.id}`, { match_modes: current.filter((mode) => mode.mode !== key) });
      expect(refused.status).toBe(409);
      expect(refused.body.detail).toContain("wird verwendet");

      // 4. Deaktivieren.
      await page.getByTestId(`game-edit-mode-more-${index}`).click();
      await page.getByTestId(`game-edit-mode-status-${index}`).selectOption("inactive");
      await expect(page.getByTestId(`game-edit-mode-status-hint-${index}`)).toContainText("nicht mehr zur Wahl");
      await noSideScroll(page);
      await shot(page, `spielmodi-inaktiv-${width}.png`);
      await page.getByTestId("game-save-modi").click();
      await expect(page.getByText("Spiel gespeichert.", { exact: false }).first()).toBeVisible();

      // 5. In einem neuen Pool nicht mehr wählbar: der Editor nennt ihn, der Server lehnt ihn ab.
      await page.goto(`/admin/games/${game.id}/maps`);
      await page.getByTestId("game-default-pool-box").locator("summary").click();
      await expect(page.getByTestId(`game-default-pool-mode-${key}`)).toHaveCount(0);
      await expect(page.getByTestId("game-default-pool-inactive")).toContainText(label);
      const fresh = await apiJson(page, "PUT", `/api/games/${game.id}/default-pool`, { modes: [{ mode: key, map_ids: [map.id] }] });
      expect(fresh.status).toBe(422);
      expect(fresh.body.detail).toContain("inaktiv");
      await noSideScroll(page);

      // 6. Die Staffel zeigt ihn weiter - in der Verwaltung mit „(inaktiv)“, öffentlich auf der Ligaseite.
      await page.goto(`/admin/tournaments/${anmeldung.tournament_id}?tab=maps`);
      await expect(page.getByTestId(`tournament-pool-mode-${key}`)).toContainText(`${label} (inaktiv)`);
      await noSideScroll(page);
      await shot(page, `spielmodi-staffel-${width}.png`);
      const guest = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT" });
      const guestPage = await guest.newPage();
      await signIn(guestPage, "anon");
      await guestPage.goto(`/liga/${anmeldung.league.slug}/${anmeldung.season.slug}`);
      await expect(guestPage.getByTestId("league-map-pool")).toContainText(label);
      await noSideScroll(guestPage);
      await guest.close();

      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
