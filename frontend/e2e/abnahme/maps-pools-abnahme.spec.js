const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Maps und Pools absichern, Prüfung vor der Veröffentlichung (#2207, docs/LIGA.md „C.2 Maps und Pools“) gegen den echten Server, ohne
// nachgestellte API. Stand aus scripts/seed_abnahme_liga.py (ABNAHME_STATE auf dessen Stand-Datei): Spiel „Call of Duty“ und die Season
// der Liga-Anmeldung mit Regelwerk, Pool und Staffel A. Je Breite (390 und 1440 px):
// 1. eine eigene, erfundene Map in den Pool der Season nehmen, übertragen, in der Bibliothek deaktivieren - die Rückfrage nennt die Season;
// 2. dieselbe Map auf der Season-Seite in einem Schritt sperren: neue Version, Staffel bekommt sie, der Vergleich zeigt „Weg“;
// 3. eine neue Season: Prüfung mit Problemen, Veröffentlichen blockiert (409), nach Pool, Liga 1, Staffel und Regelwerk frei.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const stamp = Date.now().toString(36);
const game = state?.game;
const anmeldung = state?.anmeldung;
// Erwartete Ablehnung dieser Spec: Veröffentlichen mit Problemen.
const expected = (response) => response.status() === 409 && /\/api\/admin\/leagues\/seasons\/[^/]+$/.test(response.url());

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

async function ok(page, method, url, data) {
  const answer = await apiJson(page, method, url, data);
  expect(answer.status, `${method} ${url}: ${JSON.stringify(answer.body)}`).toBe(200);
  return answer.body;
}

function viennaToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(new Date());
}

function poolBody(pool, add = {}) {
  return { expected_version: pool.version, modes: pool.modes.map((group) => ({
    mode: group.mode, map_ids: [...group.maps.map((item) => item.map_id), ...(add[group.mode] || [])] })) };
}

test.describe("Abnahme: Maps und Pools gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !(game && anmeldung), `Kein Liga-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  for (const [width, height] of WIDTHS) {
    test(`Map deaktivieren, in einem Schritt sperren, Season erst nach der Prüfung veröffentlichen (${width} px)`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, locale: "de-AT", timezoneId: "Europe/Vienna" });
      const page = await context.newPage();
      await signIn(page, "admin");
      // Die Konsole meldet die erwartete 409 beim blockierten Veröffentlichen als Ladefehler.
      const problems = watch(page, { allow: expected, allowConsole: (text) => /status of 409/.test(text) });
      const seasonId = anmeldung.season.id;
      const name = `Probekarte ${stamp} ${width}`;

      // 1. Eigene Map in den Pool der Season und auf die Staffel, dann in der Bibliothek deaktivieren - mit Rückfrage.
      const map = await ok(page, "POST", `/api/games/${game.id}/maps`, { name, modes: ["stellung", "suchen"] });
      const before = (await ok(page, "GET", `/api/admin/leagues/seasons/${seasonId}`)).map_pool;
      await ok(page, "PUT", `/api/admin/leagues/seasons/${seasonId}/map-pool`, poolBody(before, { stellung: [map.id], suchen: [map.id] }));
      await ok(page, "POST", `/api/admin/leagues/seasons/${seasonId}/sync`);
      expect(JSON.stringify(await ok(page, "GET", `/api/map-pools/tournaments/${anmeldung.tournament_id}`))).toContain(name);

      await page.goto(`/admin/games/${game.id}/maps`);
      await page.getByTestId(`game-map-status-${map.slug}`).click();
      const dialog = page.getByTestId("confirm-dialog");
      await expect(dialog).toContainText("Inaktiv heißt");
      await expect(dialog).toContainText("Liga-Anmeldung");
      await noSideScroll(page);
      await shot(page, `maps-deaktivieren-${width}.png`);
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByText("Map deaktiviert.").first()).toBeVisible();
      await expect(page.getByText("Map aus dem Pool nehmen", { exact: false }).first()).toBeVisible();
      await expect(page.getByTestId(`game-map-state-${map.slug}`)).toContainText("Inaktiv");
      const stored = (await ok(page, "GET", `/api/games/${game.id}/maps`)).maps.find((row) => row.id === map.id);
      expect(stored.status).toBe("inactive");

      // 2. Auf der Season-Seite in einem Schritt sperren: neue Version, auf die Staffel übertragen, mit Grund.
      await page.goto(`/admin/leagues/seasons/${seasonId}#modi`);
      const lock = page.getByTestId("season-pool-lock");
      await lock.locator("summary").click();
      await page.getByTestId("season-pool-lock-map").selectOption(map.id);
      await page.getByTestId("season-pool-lock-reason").fill("Abnahme: Map ist kaputt (erfunden)");
      await page.getByTestId("season-pool-lock-run").click();
      await expect(page.getByTestId("confirm-dialog")).toContainText(`„${name}“ sperren?`);
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByTestId("season-pool-lock-result")).toContainText("übertragen");
      await expect(page.getByTestId("season-pool-lock-result")).not.toContainText("nicht übertragen");
      const staffelPool = await ok(page, "GET", `/api/map-pools/tournaments/${anmeldung.tournament_id}`);
      expect(JSON.stringify(staffelPool)).not.toContain(name);
      const compare = page.getByTestId("season-pool-compare");
      await compare.locator("summary").click();
      await page.getByTestId("season-pool-compare-run").click();
      await expect(page.getByTestId("season-pool-compare-result")).toContainText(`Weg: ${name}`);
      await noSideScroll(page);
      await shot(page, `maps-sperren-${width}.png`);

      // 3. Neue Season: Prüfung mit Problemen, Veröffentlichen blockiert.
      const fresh = await ok(page, "POST", `/api/admin/leagues/${anmeldung.league.id}/seasons`, {
        name: `Prüfung ${stamp} ${width}`, slug: `pruefung-${stamp}-${width}`, start_date: `${new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10)}T00:00:00`,
        best_of: 3, team_size: 4, game_mode_order: ["stellung", "suchen", "kontrolle"] });
      await page.goto(`/admin/leagues/seasons/${fresh.id}`);
      await expect(page.getByTestId("season-readiness-state")).toContainText("Probleme vor der Veröffentlichung");
      const list = page.getByTestId("season-readiness-problems");
      await expect(list).toContainText("keinen Map-Pool");
      await expect(list).toContainText("kein veröffentlichtes Regelwerk");
      await expect(list).toContainText("noch keine Liga N");
      await noSideScroll(page);
      await shot(page, `maps-pruefung-probleme-${width}.png`);
      await page.getByTestId("season-form-visibility").selectOption("members");
      await page.getByTestId("season-save-ueberblick").click();
      await expect(page.getByText("Veröffentlichen geht noch nicht", { exact: false }).first()).toBeVisible();
      expect((await ok(page, "GET", `/api/admin/leagues/seasons/${fresh.id}`)).season.visibility).toBe("off");

      // … dann Pool, Liga 1, Staffel und Regelwerk: bereit, Veröffentlichen geht.
      const current = (await ok(page, "GET", `/api/admin/leagues/seasons/${seasonId}`)).map_pool;
      // Nur die drei Seed-Modi: Andere Specs legen dort eigene, später inaktive Modi ab, die in keinen neuen Pool dürfen.
      const seedModes = ["stellung", "suchen", "kontrolle"];
      await ok(page, "PUT", `/api/admin/leagues/seasons/${fresh.id}/map-pool`, {
        expected_version: 0, modes: poolBody(current).modes.filter((group) => seedModes.includes(group.mode)) });
      const division = await ok(page, "POST", `/api/admin/leagues/seasons/${fresh.id}/divisions`, {});
      await ok(page, "POST", `/api/admin/leagues/divisions/${division.id}/staffeln`, { staffel: "A" });
      const scope = `/api/admin/league-rules/league_season/${fresh.id}`;
      const draft = await ok(page, "PUT", `${scope}/draft`, { title: "Regelwerk Prüfung", body_md: "# Fairplay\n\nFair spielen. Erfunden.\n", annexes: [] });
      await ok(page, "POST", `${scope}/publish`, { revision: draft.revision, valid_from: viennaToday(), change_reason: "Fassung für die Abnahme", requires_consent: false });
      await page.getByTestId("season-readiness-reload").click();
      await expect(page.getByTestId("season-readiness-state")).toContainText("Bereit zur Veröffentlichung");
      await page.getByTestId("season-form-visibility").selectOption("members");
      await page.getByTestId("season-save-ueberblick").click();
      await expect(page.getByText("Überblick gespeichert.").first()).toBeVisible();
      expect((await ok(page, "GET", `/api/admin/leagues/seasons/${fresh.id}`)).season.visibility).toBe("members");
      await noSideScroll(page);
      await shot(page, `maps-pruefung-bereit-${width}.png`);

      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
