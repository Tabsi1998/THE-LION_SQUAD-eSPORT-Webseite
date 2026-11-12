const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Spielseite der Verwaltung (#2249) gegen den echten Server, ohne nachgestellte API. Stand aus scripts/seed_abnahme_liga.py
// (ABNAHME_STATE auf dessen Stand-Datei): Spiel „Call of Duty“ mit seinen Modi. Je Breite (390 und 1440 px): über das Zahnrad
// die Spielseite öffnen, im Reiter Modi einen Modus anlegen, im Reiter Maps eine neue Map anlegen und per Häkchen in zwei Modi
// freigeben, den Modus deaktivieren, die alte Map-Adresse leitet auf den Reiter Maps. Am Ende räumt der Lauf seine erfundene
// Map und seinen Modus wieder weg, damit das Spiel nicht vollläuft.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const stamp = Date.now().toString(36);
const game = state?.game;

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

test.describe("Abnahme: Spielseite gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !game, `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  for (const [width, height] of WIDTHS) {
    test(`Spiel öffnen, Modus anlegen, Map in zwei Modi freigeben, Modus deaktivieren (${width} px)`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT", timezoneId: "Europe/Vienna" });
      const page = await context.newPage();
      await signIn(page, "admin");
      const problems = watch(page);
      const label = `Probe ${stamp} ${width}`;
      const mapName = `Probekarte ${stamp} ${width}`;

      // 1. Über das Zahnrad der Spieleliste auf die Spielseite.
      await page.goto("/admin/games");
      await page.getByTestId(`game-settings-${game.slug}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/games/${game.id}$`));
      await expect(page.getByTestId("game-tab-allgemein")).toHaveAttribute("aria-selected", "true");
      await noSideScroll(page);
      await shot(page, `spielseite-allgemein-${width}.png`);

      // 2. Reiter Modi: Modus anlegen und speichern.
      const before = (await apiJson(page, "GET", `/api/games/${game.id}`)).body;
      const index = (before.match_modes || []).length;
      test.skip(index >= 19, "Das Spiel hat fast 20 Modi - Stand neu aufsetzen");
      const seedMode = (before.match_modes || []).find((mode) => (mode.status || "active") === "active");
      await page.getByTestId("game-tab-modi").click();
      await expect(page).toHaveURL(/#modi$/);
      await page.getByTestId("game-edit-mode-add").click();
      await page.getByTestId(`game-edit-mode-label-${index}`).fill(label);
      await page.getByTestId(`game-edit-mode-players-${index}`).fill("4");
      await expect(page.getByTestId("game-tab-dirty-modi")).toBeVisible();
      await noSideScroll(page);
      await page.getByTestId("game-save-modi").click();
      await expect(page.getByText("Spiel gespeichert.", { exact: false }).first()).toBeVisible();
      await expect(page.getByTestId("game-saved-state")).toBeVisible();
      const created = (await apiJson(page, "GET", `/api/games/${game.id}`)).body.match_modes.find((mode) => mode.label === label);
      expect(created).toMatchObject({ players_per_side: 4 });
      const key = created.mode;

      // 3. Reiter Maps: neue Map anlegen, per Häkchen im neuen und in einem Seed-Modus freigeben.
      await page.getByTestId("game-tab-maps").click();
      await page.getByTestId("game-maps-add").click();
      const sheet = page.getByRole("dialog", { name: "Map hinzufügen" });
      await sheet.getByTestId("game-map-name").fill(mapName);
      await sheet.getByTestId("game-map-save").click();
      await expect(page.getByText("Map angelegt.").first()).toBeVisible();
      const map = (await apiJson(page, "GET", `/api/games/${game.id}/maps`)).body.maps.find((row) => row.name === mapName);
      await page.getByRole("checkbox", { name: `${mapName} in ${label} freigeben` }).check();
      await expect(page.getByText(`${mapName}: in ${label} freigegeben.`).first()).toBeVisible();
      await page.getByRole("checkbox", { name: `${mapName} in ${seedMode.label} freigeben` }).check();
      await expect(page.getByText(`${mapName}: in ${seedMode.label} freigegeben.`).first()).toBeVisible();
      const stored = (await apiJson(page, "GET", `/api/games/${game.id}/maps`)).body.maps.find((row) => row.id === map.id);
      expect([...stored.modes].sort()).toEqual([key, seedMode.mode].sort());
      await noSideScroll(page);
      await shot(page, `spielseite-maps-${width}.png`);

      // 4. Reiter Modi: den neuen Modus deaktivieren - er steht weiter an der Map, die Spalte sagt „inaktiv“.
      await page.getByTestId("game-tab-modi").click();
      await page.getByTestId(`game-edit-mode-more-${index}`).click();
      await page.getByTestId(`game-edit-mode-status-${index}`).selectOption("inactive");
      await expect(page.getByTestId(`game-edit-mode-status-hint-${index}`)).toContainText("nicht mehr zur Wahl");
      await page.getByTestId("game-save-modi").click();
      await expect(page.getByText("Spiel gespeichert.", { exact: false }).first()).toBeVisible();
      await expect(page.getByTestId(`game-edit-mode-chip-${index}`)).toHaveText("Inaktiv");
      const after = (await apiJson(page, "GET", `/api/games/${game.id}`)).body.match_modes.find((mode) => mode.mode === key);
      expect(after.status).toBe("inactive");
      await noSideScroll(page);
      await shot(page, `spielseite-modi-${width}.png`);

      // 5. Die alte Map-Adresse leitet auf den Reiter Maps.
      await page.goto(`/admin/games/${game.id}/maps`);
      await expect(page).toHaveURL(new RegExp(`/admin/games/${game.id}#maps$`));
      await expect(page.getByTestId(`game-maps-mode-${key}`)).toContainText("inaktiv");
      await expect(page.getByRole("checkbox", { name: `${mapName} in ${label} freigeben` })).toBeChecked();
      await noSideScroll(page);

      // Aufräumen: Map löschen (stand in keinem Pool), dann den unbenutzten Modus entfernen.
      expect((await apiJson(page, "DELETE", `/api/games/${game.id}/maps/${map.id}`)).status).toBe(200);
      const modes = (await apiJson(page, "GET", `/api/games/${game.id}`)).body.match_modes.filter((mode) => mode.mode !== key);
      expect((await apiJson(page, "PATCH", `/api/games/${game.id}`, { match_modes: modes })).status).toBe(200);

      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
