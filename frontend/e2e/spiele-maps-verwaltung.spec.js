const { test, expect } = require("@playwright/test");

// Spiele, Maps und Game-Server (#2129) im echten Browser, Server nachgestellt: Archiv statt Löschen, Rückfrage beim Entfernen
// eines Modus, Maps ohne Modus, Maps übernehmen, Standard-Pool, Game-Server mit echtem Fehler. Bei 390 und 1440 px ohne
// seitliches Scrollen. Nur erfundene Namen.

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "system"], mfa_enabled: true, auth_mfa_verified: true };
const MODES = [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }];
const GAMES = [
  { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", match_modes: MODES },
  { id: "g2", name: "Altspiel mit einem sehr langen Namen, der nicht aufhört", slug: "altspiel", kind: "standalone", status: "archived" },
];
const MAPS = [
  { id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: null, modes: ["stellung", "snd"], status: "active", in_pools: 1, order: 1 },
  { id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: null, modes: [], status: "active", in_pools: 0, order: 2 },
  { id: "glut", slug: "glutsenke", name: "Glutsenke", image_url: null, modes: [], status: "active", in_pools: 0, order: 3 },
];
const SERVER = {
  id: "s1", slug: "probe", name: "Probe Server mit einem langen Namen", status: "offline", visibility: "community", sync_provider: "steam_a2s", address: "probe.example:27015",
  last_sync_error: "[Errno 111] Connection refused von probe.example:27015 beim Abruf", last_sync_note: "Die Website konnte den Server nicht erreichen.",
};

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/games", json(GAMES));
  await page.route("**/api/games/discord-servers", json([]));
  const calls = { patch: [], delete: [], assign: [], imported: [], defaultPool: [], mapPatch: [] };
  await page.route("**/api/games/g1", (route) => {
    calls[route.request().method().toLowerCase()]?.push?.(route.request().postDataJSON?.() ?? null);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...GAMES[0], maps_cleaned: 3, maps_without_mode: 2 }) });
  });
  await page.route("**/api/games/g1/usage", json({
    total: 15, text: "2 Turniere, 12 Maps, 1 Liga", counts: {},
    // Seit #2206: „Stellung“ hängt nur an Maps (entfernbar), „Suchen & Zerstören“ steht in einem Pool (nur deaktivieren).
    modes: { stellung: { label: "Stellung", maps: 3, pools: 0, seasons: 0, in_use: false },
      snd: { label: "Suchen & Zerstören", maps: 2, pools: 1, seasons: 1, pool_versions: 2, in_use: true } },
  }));
  await page.route("**/api/games/g1/maps", json({ game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", modes: MODES }, maps: MAPS, limit: 200, default_pool: null }));
  await page.route("**/api/games/g1/maps/nebel", (route) => {
    calls.mapPatch.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...MAPS[1], ...route.request().postDataJSON(), affected_seasons: [], warning: null }) });
  });
  await page.route("**/api/games/g1/maps/assign-modes", (route) => {
    calls.assign.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: 2 }) });
  });
  await page.route("**/api/games/g1/maps/import-sources", json([{ id: "g2", name: "Altspiel mit einem sehr langen Namen, der nicht aufhört", maps: 2, related: true }]));
  await page.route("**/api/games/g1/maps/import-sources/g2", json({ source: { id: "g2", name: "Altspiel" }, maps: [
    { id: "x1", name: "Sturmdeck mit einem wirklich langen Kartennamen ohne Ende", image_url: null, modes: ["Stellung"], exists: false },
    { id: "x2", name: "Hafenkante", image_url: null, modes: [], exists: true },
  ] }));
  await page.route("**/api/games/g1/maps/import", (route) => {
    calls.imported.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ created: [{ id: "n1" }], skipped: [] }) });
  });
  await page.route("**/api/games/g1/default-pool", (route) => {
    calls.defaultPool.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "d1", version: 1 }) });
  });
  await page.route("**/api/game-servers/admin", json([SERVER]));
  await page.route("**/api/game-servers/admin/meta", json({ demo_tools: false }));
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Spieleliste (${width} px): archivierte ausgeblendet, verwendetes Spiel wird archiviert statt gelöscht`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games");
    const row = page.getByTestId("game-row-probe-shooter");
    await expect(row).toBeVisible();
    await expect(page.getByTestId("game-row-altspiel")).toHaveCount(0);
    await expect(page.getByTestId("game-archive-probe-shooter")).toBeVisible();
    // Spielseite (#2249): ein Zahnrad statt Stift und Karte.
    await expect(page.getByTestId("game-settings-probe-shooter")).toHaveAttribute("href", "/admin/games/g1");
    await expect(page.getByTestId("game-edit-probe-shooter")).toHaveCount(0);
    await expect(page.getByTestId("game-maps-probe-shooter")).toHaveCount(0);
    await noSideScroll(page);

    await page.getByTestId("games-show-archived").check();
    await expect(page.getByTestId("game-archived-altspiel")).toBeVisible();
    await noSideScroll(page);
    // Die Knöpfe liegen ganz in der Liste - auch neben einem langen Namen, die Liste schneidet sie nicht ab.
    const list = await page.getByTestId("game-row-probe-shooter").locator("xpath=ancestor::table/..").boundingBox();
    for (const testId of ["game-delete-probe-shooter", "game-delete-altspiel"]) {
      const button = page.getByTestId(testId);
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(list.x + list.width);
    }
    await page.screenshot({ path: test.info().outputPath("spieleliste.png"), fullPage: true });

    await page.getByTestId("game-delete-probe-shooter").click();
    const dialog = page.getByRole("dialog").filter({ hasText: "wird noch verwendet" });
    await expect(dialog).toContainText("2 Turniere, 12 Maps, 1 Liga");
    await dialog.getByRole("button", { name: "Archivieren" }).click();
    await expect.poll(() => calls.patch.length).toBe(1);
    expect(calls.patch[0]).toEqual({ status: "archived" });
    expect(calls.delete).toHaveLength(0);
  });

  test(`Modus entfernen (${width} px): Rückfrage mit Zahl der Maps vor dem Speichern`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games/g1#modi");
    await page.getByTestId("game-edit-mode-remove-0").click();
    await expect(page.getByTestId("game-edit-genre")).toHaveCount(0);
    await page.getByTestId("game-save-modi").click();
    const dialog = page.getByTestId("confirm-dialog-confirm").locator("xpath=ancestor::*[@role='dialog'][1]");
    await expect(dialog).toContainText("Modus „Stellung“ entfernen?");
    await expect(dialog).toContainText("3 Maps verlieren diesen Modus");
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect.poll(() => calls.patch.length).toBe(1);
    expect(calls.patch[0].match_modes.map((mode) => mode.mode)).toEqual(["snd"]);
    await expect(page.getByText("Modus aus 3 Maps entfernt.", { exact: false })).toBeVisible();
    await noSideScroll(page);
  });

  test(`Spielmodi (${width} px): verwendeter Modus mit Schloss, Zustand und Ergebnisregel geführt eintragen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games/g1#modi");
    await expect(page.getByTestId("game-edit-mode-locked-1")).toBeVisible();
    await expect(page.getByTestId("game-edit-mode-remove-1")).toHaveCount(0);
    await expect(page.getByTestId("game-edit-mode-used-1")).toContainText("nur deaktivieren oder archivieren");
    await expect(page.getByTestId("game-edit-mode-remove-0")).toBeEnabled();

    await page.getByTestId("game-edit-mode-more-1").click();
    await page.getByTestId("game-edit-mode-status-1").selectOption("inactive");
    await expect(page.getByTestId("game-edit-mode-chip-1")).toHaveText("Inaktiv");
    await expect(page.getByTestId("game-edit-mode-status-hint-1")).toContainText("nicht mehr zur Wahl");
    await page.getByTestId("game-edit-mode-players-1").fill("4");
    await page.getByTestId("game-edit-mode-format-1").fill("Standard-Regeln");
    await page.getByTestId("game-edit-mode-rule-kind-1").selectOption("rounds");
    await page.getByTestId("game-edit-mode-rule-target-1").fill("6");
    await page.getByTestId("game-edit-mode-rule-limit-1").fill("11");
    await page.getByTestId("game-edit-mode-rule-overtime-1").check();
    await expect(page.getByTestId("game-edit-mode-more-1")).toContainText("4 je Seite · Standard-Regeln · Runden gewinnen: 6 Siege, höchstens 11 Runden · Verlängerung");
    await noSideScroll(page);
    await page.getByTestId("game-edit-mode-more-1").scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("spiel-modus-details.png") });

    // Passt die Regel nicht, sagt es die Seite vor dem Speichern - nichts geht an den Server.
    await page.getByTestId("game-edit-mode-rule-limit-1").fill("5");
    await page.getByTestId("game-save-modi").click();
    await expect(page.getByText("Das Rundenlimit (5) ist kleiner als das Ziel (6).", { exact: false })).toBeVisible();
    expect(calls.patch).toHaveLength(0);
    await page.getByTestId("game-edit-mode-rule-limit-1").fill("11");
    await page.getByTestId("game-save-modi").click();
    await expect.poll(() => calls.patch.length).toBe(1);
    expect(calls.patch[0].match_modes[1]).toEqual({
      mode: "snd", label: "Suchen & Zerstören", minutes: null, per_game: false, status: "inactive", players_per_side: 4, format: "Standard-Regeln",
      result_rule: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: true },
    });
    expect(calls.patch[0].match_modes[0]).toEqual({ mode: "stellung", label: "Stellung", minutes: null, per_game: false });
  });

  test(`Map-Seite (${width} px): Maps ohne Modus zuordnen, aus einem Spiel übernehmen, Standard-Pool`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games/g1/maps");
    await expect(page).toHaveURL(/\/admin\/games\/g1#maps$/);
    const notice = page.getByTestId("game-maps-without-mode");
    await expect(notice).toContainText("Diese Maps haben noch keinen Modus");
    await expect(notice).toContainText("Nebelwerk, Glutsenke");
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath("maps.png"), fullPage: true });
    await notice.getByTestId("game-maps-assign-stellung").uncheck();
    await notice.getByTestId("game-maps-assign").click();
    await expect.poll(() => calls.assign.length).toBe(1);
    expect(calls.assign[0]).toEqual({ modes: ["snd"] });

    // Tabelle Map × Modus (#2249): ein Häkchen gibt frei und speichert sofort.
    await page.getByRole("checkbox", { name: "Nebelwerk in Stellung freigeben" }).check();
    await expect.poll(() => calls.mapPatch.length).toBe(1);
    expect(calls.mapPatch[0]).toEqual({ modes: ["stellung"] });
    await noSideScroll(page);

    await page.getByTestId("game-maps-import").click();
    const sheet = page.getByTestId("map-import-sheet");
    await expect(sheet.getByTestId("map-import-row-x2")).toContainText("schon da");
    await expect(sheet.getByTestId("map-import-save")).toContainText("1 Map übernehmen");
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath("import.png") });
    await sheet.getByTestId("map-import-save").click();
    await expect.poll(() => calls.imported.length).toBe(1);
    expect(calls.imported[0]).toEqual({ source_game_id: "g2", map_ids: ["x1"] });

    await page.getByTestId("game-default-pool-box").locator("summary").click();
    await page.getByTestId("game-default-pool-defaults").click();
    await page.getByTestId("game-default-pool-save").click();
    await expect.poll(() => calls.defaultPool.length).toBe(1);
    expect(calls.defaultPool[0].modes.map((group) => group.mode)).toEqual(["stellung", "snd"]);
    await noSideScroll(page);
  });

  test(`Game-Server (${width} px): echter Fehler, kein Demo-Knopf, Technik eingeklappt, Icon per Upload`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/game-servers");
    await expect(page.getByTestId("server-sync-error-probe")).toContainText("Connection refused von probe.example");
    await expect(page.getByTestId("server-demo-remove")).toHaveCount(0);
    await expect(page.getByTestId("server-sync-all")).toHaveText("Alle aktualisieren");
    await expect(page.getByText("Sync-Quelle")).toHaveCount(0);
    await noSideScroll(page);

    await page.getByRole("button", { name: "Server anlegen", exact: true }).click();
    await expect(page.getByTestId("server-technik").getByLabel("Abfrage-Adresse")).toBeHidden();
    await page.getByTestId("server-technik").locator("summary").click();
    await expect(page.getByTestId("server-technik").getByLabel("Abfrage-Adresse")).toBeVisible();
    await expect(page.getByTestId("server-icon-upload")).toContainText("Eigenes Server-Icon");
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath("server.png"), fullPage: true });
  });
}
