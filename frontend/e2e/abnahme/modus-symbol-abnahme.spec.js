const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Symbol je Modus (#2266) und Einstellungen je Modus (#2271) gegen den echten Server, ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (ABNAHME_STATE auf dessen Stand-Datei): Spiel „Call of Duty“ und die Season der Liga-Anmeldung.
// Je Breite (390 und 1440 px): im Reiter Modi einen eigenen Modus anlegen, ein synthetisches PNG als Symbol hochladen (Zuschnitt
// 1:1), Zeitlimit 1:30 und Zeit je Runde 1:45, drei Einstellungen und Regeltext; die Seed-Modi zeigen den Platzhalter. Die Mediathek
// zählt das Symbol als Verwendung. Im Map-Pool der Season verwenden (Symbol im Editor und als Schnappschuss im Pool), auf die Staffel
// übertragen, die Ligaseite zeigt es öffentlich. Die Season weicht bei einer Einstellung ab, der Baustein „Einstellungen je Modus“
// zeigt Symbol, Zeiten und Einstellungen. Zuletzt „Modus je Map“ mit Symbol. Den eigenen Modus archiviert der Lauf am Ende.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const stamp = Date.now().toString(36);
const game = state?.game;
const anmeldung = state?.anmeldung;
const MAP = "Hafenkante";
// Ein erfundenes, quadratisches Symbol (96 × 96, Kreis auf Blau).
const ICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAACQElEQVR4nO2bwVXEMAwFs3nugRpQJzQMnbgGqAIeB477krBrzZf95wxrR2M5VhLdXt8/vzeDsXNDGwsQwBkAYwEwFgBjATAWAGMBMBYAYwEwFgBjATAWAGMBMBYAYwEwFgBjATAWANO2QvS3l9N/Gx9fWwXaLAE/+l9VIW22wB/9ppqINnvg1UW0VQKvKmJfMfhK4+8rX7zCPNrKgVfYklq14MeJAD16fM2UcMv8OPe/gYkHAkKMWe4UNDIIf7+huO2lZoDKY4QuMo/UU5DSRceF38/ImuEZcPYiAiiIFOaGF2JkNUpXwcMFqN74lK4Dz4CAVyE9/k6umhDYAjKKO+kMWJ199dVPZ4EzAAYRoLb6yXlJPwu6uh2oik3NgMz3ukpjl9mCHl2l/SAAGe8blr0J95PBrVSBlxHQLwa1ioQyAmbFAmAsAMYCYMoIiIvHwypFWRkBV4JaJfiIgNGFUgwu9OQFZKy+uDMGOfZyD+Oi0DYjdw9QrVI7MK9SN+EZ2Wd7yV3tNaozAGaYgEpZ0MGPCPAM6O4RG8csR8WY/ePcDmUBnX1pDRpK/QFq80nJAKWmiC4UfPkmvXhiAMixyz4L6k/o3VXY52UyoEKf8C/T9glXWJUxe6e8au9uQDULWgeESKFGzgMvxGLxHjGJU1AAWxIdeCkBmSJUAi8pYKQItcBLC7gXNLXHCNMLqBrUUqeg1bEAGAuAsQAYC4CxABgLgLEAGAuAsQAYC4CxABgLgLEAGAuAsQAYC4CxgI3lByOn8NVf+hvOAAAAAElFTkSuQmCC",
  "base64",
);

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

test.describe("Abnahme: Symbol und Einstellungen je Modus gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !(game && anmeldung), `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  for (const [width, height] of WIDTHS) {
    test(`Symbol hochladen, Zeiten und Einstellungen, überall sichtbar (${width} px)`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT", timezoneId: "Europe/Vienna" });
      const page = await context.newPage();
      await signIn(page, "admin");
      const problems = watch(page);
      const label = `Symbol ${stamp} ${width}`;

      // 1. Reiter Modi: eigener Modus mit Symbol, Zeiten, Einstellungen und Regeltext.
      const before = (await apiJson(page, "GET", `/api/games/${game.id}`)).body;
      const index = (before.match_modes || []).length;
      test.skip(index >= 19, "Das Spiel hat fast 20 Modi - Stand neu aufsetzen");
      await page.goto("/admin/games");
      await page.getByTestId(`game-settings-${game.slug}`).click();
      await page.getByTestId("game-tab-modi").click();
      await expect(page.getByTestId("game-edit-mode-icon-thumb-0")).toHaveAttribute("data-icon", "placeholder");
      await page.getByTestId("game-edit-mode-add").click();
      await page.getByTestId(`game-edit-mode-label-${index}`).fill(label);
      await page.getByTestId(`game-edit-mode-icon-${index}-file`).setInputFiles({ name: `symbol-${stamp}.png`, mimeType: "image/png", buffer: ICON_PNG });
      await page.getByRole("button", { name: "Übernehmen" }).click();
      await expect(page.getByTestId(`game-edit-mode-icon-thumb-${index}`)).toHaveAttribute("data-icon", "image");
      await page.getByTestId(`game-edit-mode-rule-kind-${index}`).selectOption("rounds");
      await page.getByTestId(`game-edit-mode-rule-target-${index}`).fill("6");
      await page.getByTestId(`game-edit-mode-rule-limit-${index}`).fill("11");
      await page.getByTestId(`game-edit-mode-rule-time-${index}`).fill("1:30");
      await page.getByTestId(`game-edit-mode-rule-round-time-${index}`).fill("1:45");
      const prefix = `game-edit-mode-settings-${index}`;
      const rows = [["Lobby", "Ladungsuhr", "seconds", "0:45"], ["Spieler", "Rückblende", "toggle", null], ["Zonen", "Zonenzeit", "minutes", "2"]];
      for (const [row, [group, name, unit, value]] of rows.entries()) {
        await page.getByTestId(`${prefix}-add`).click();
        await page.getByTestId(`${prefix}-group-${row}`).fill(group);
        await page.getByTestId(`${prefix}-label-${row}`).fill(name);
        await page.getByTestId(`${prefix}-unit-${row}`).selectOption(unit);
        if (value === null) await page.getByTestId(`${prefix}-value-${row}`).check();
        else await page.getByTestId(`${prefix}-value-${row}`).fill(value);
      }
      await page.getByTestId(`${prefix}-rules`).fill("Die Uhr läuft nur, solange die Ladung liegt.");
      await noSideScroll(page);
      await shot(page, `modus-symbol-anlegen-${width}.png`);
      await page.getByTestId("game-save-modi").click();
      await expect(page.getByText("Spiel gespeichert.", { exact: false }).first()).toBeVisible();
      const created = (await apiJson(page, "GET", `/api/games/${game.id}`)).body.match_modes.find((mode) => mode.label === label);
      expect(created.icon_url).toMatch(/^\/api\/static\/uploads\//);
      expect(created.result_rule).toMatchObject({ kind: "rounds", time_limit_seconds: 90, round_time_seconds: 105 });
      expect(created.settings.map((row) => [row.label, row.value])).toEqual([["Ladungsuhr", 45], ["Rückblende", true], ["Zonenzeit", 2]]);
      expect(created.rules_text).toBe("Die Uhr läuft nur, solange die Ladung liegt.");
      const key = created.mode;
      const filename = created.icon_url.split("?")[0].split("/").pop();

      // 2. Mediathek: das Symbol ist verwendet.
      const media = (await apiJson(page, "GET", `/api/admin/media?include_usage=true&q=${encodeURIComponent(filename)}`)).body;
      expect(JSON.stringify(media)).toContain("Symbol eines Modus");

      // 3. Verwenden: Map zuordnen, im Pool der Season wählen (Symbol im Editor), auf die Staffel übertragen.
      const maps = (await apiJson(page, "GET", `/api/games/${game.id}/maps`)).body.maps;
      const map = maps.find((row) => row.name === MAP);
      expect((await apiJson(page, "PATCH", `/api/games/${game.id}/maps/${map.id}`, { modes: [...map.modes, key] })).status).toBe(200);
      await page.goto(`/admin/leagues/seasons/${anmeldung.season.id}`);
      await expect(page.getByTestId(`season-pool-mode-${key}-icon`)).toHaveAttribute("data-icon", "image");
      await page.getByTestId(`season-pool-mode-${key}`).getByRole("checkbox", { name: `${MAP} in ${label}` }).check();
      await page.getByTestId("season-pool-save").click();
      await expect(page.getByText("Map-Pool gespeichert.").first()).toBeVisible();
      expect((await apiJson(page, "POST", `/api/admin/leagues/seasons/${anmeldung.season.id}/sync`)).status).toBe(200);
      const staffelPool = (await apiJson(page, "GET", `/api/map-pools/tournaments/${anmeldung.tournament_id}`)).body;
      expect(JSON.stringify(staffelPool)).toContain(created.icon_url);

      // 4. Season weicht bei einer Einstellung ab: erst vom Spiel übernehmen, dann einen Wert ändern.
      await page.reload();
      const rules = page.getByTestId(`result-rules-${key}`);
      await expect(rules.getByTestId(`result-rules-${key}-icon`)).toHaveAttribute("data-icon", "image");
      // Die Ergebnisregel des neuen Modus kennt die Season noch nicht - übernehmen, dann stehen die Zeiten auch im Regelwerk.
      await page.getByTestId(`result-rules-${key}-adopt`).click();
      await expect(page.getByTestId(`result-rules-${key}-time`)).toHaveValue("1:30");
      await expect(page.getByTestId(`result-rules-${key}-round-time`)).toHaveValue("1:45");
      // Eine Season mit Kopie kennt den neuen Modus noch nicht (weicht ab, übernehmen); eine ältere ohne Kopie zeigt die Werte des Spiels.
      const adopt = page.getByTestId(`result-rules-${key}-settings-adopt`);
      if (await adopt.isVisible()) await adopt.click();
      else await page.getByTestId(`result-rules-${key}-settings-box`).locator("summary").click();
      await expect(page.getByTestId(`result-rules-${key}-settings-value-0`)).toHaveValue("45");
      await page.getByTestId(`result-rules-${key}-settings-value-0`).fill("0:40");
      await expect(page.getByTestId(`result-rules-${key}-settings-diff-0`)).toHaveText("weicht vom Spiel ab");
      await noSideScroll(page);
      await shot(page, `modus-symbol-season-${width}.png`);
      await page.getByTestId("result-rules-save").click();
      await expect(page.getByText("Ergebnisregeln gespeichert.").first()).toBeVisible();
      const overview = (await apiJson(page, "GET", `/api/admin/leagues/seasons/${anmeldung.season.id}/result-rules`)).body;
      const row = overview.rules.find((item) => item.mode === key);
      expect(row.season_settings.settings[0].value).toBe(40);
      expect(row.game_settings.settings[0].value).toBe(45);
      expect(row.settings_differ).toBe(true);

      // 5. Regelwerk: der Baustein „Einstellungen je Modus“ mit Symbol, Zeiten und Werten (Vorschau, speichert nichts).
      const preview = (await apiJson(page, "POST", `/api/admin/league-rules/league_season/${anmeldung.season.id}/preview`,
        { title: "Probe", body_md: "# Modi\n[[baustein:mode_settings]]", annexes: [] }));
      expect(preview.status).toBe(200);
      const text = JSON.stringify(preview.body);
      expect(text).toContain(`![Modus-Symbol](${created.icon_url})`);
      expect(text).toContain("Zeitlimit je Map: 1:30 Min.");
      expect(text).toContain("Zeit je Runde: 1:45 Min.");
      expect(text).toContain("| Lobby | Ladungsuhr | 0:40 Min. |");

      // 6. Öffentlich: die Ligaseite zeigt das Symbol im Map-Pool.
      const guest = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT" });
      const guestPage = await guest.newPage();
      await signIn(guestPage, "anon");
      await guestPage.goto(`/liga/${anmeldung.league.slug}/${anmeldung.season.slug}`);
      const pool = guestPage.getByTestId("league-map-pool");
      await expect(pool).toContainText(label);
      await expect(pool.locator('[data-testid="map-pool-mode-icon"][data-icon="image"]').first()).toBeVisible();
      await noSideScroll(guestPage);
      await shot(guestPage, `modus-symbol-ligaseite-${width}.png`);
      await guest.close();

      // 7. „Modus je Map“: gewählt steht das Symbol daneben (nur angesehen, nicht gespeichert).
      await page.goto(`/admin/leagues/seasons/${anmeldung.season.id}`);
      const order = page.getByTestId("mode-order-0");
      if (await order.count()) {
        await order.selectOption(key);
        await expect(page.getByTestId("mode-order-0-icon")).toHaveAttribute("data-icon", "image");
        await noSideScroll(page);
      }

      // Aufräumen: den eigenen Modus archivieren - er steht im Pool und bleibt dort sichtbar.
      const current = (await apiJson(page, "GET", `/api/games/${game.id}`)).body.match_modes
        .map((mode) => (mode.mode === key ? { ...mode, status: "archived" } : mode));
      expect((await apiJson(page, "PATCH", `/api/games/${game.id}`, { match_modes: current })).status).toBe(200);

      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
