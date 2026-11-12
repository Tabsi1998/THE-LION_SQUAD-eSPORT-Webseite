const { test, expect } = require("@playwright/test");

// Symbol je Modus (#2266) und Einstellungen je Modus (#2271) im Reiter Modi der Spielseite, Server nachgestellt: Zeile mit Symbol oder
// Platzhalter, aufgeklappt Symbol aus der Bibliothek wählen und entfernen, Zeitlimit als 1:30, Zeit je Runde, drei freie Einstellungen
// mit Reihenfolge und Regeltext - und was davon an den Server geht. Bei 390 und 1440 px ohne seitliches Scrollen. Nur erfundene Namen
// und Bilder. SHOTS=<Ordner> legt die Bilder fürs Handbuch (turniere.md 3.12) dort ab.

const fs = require("node:fs");
const path = require("node:path");

const SHOTS = process.env.SHOTS || "";
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const ICON = "/api/static/uploads/probe-symbol-zone.png";
const MODES = [
  { mode: "zone", label: "Zone halten", players_per_side: 4, icon_url: ICON,
    result_rule: { kind: "score", target: 200, time_limit_minutes: 10, draw_allowed: false, overtime: false } },
  { mode: "ladung", label: "Ladung legen", players_per_side: 4, result_rule: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: false } },
];
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", match_modes: MODES, player_id_fields: [] };
const LIBRARY = { items: [{ filename: "probe-symbol-neu.png", url: "/api/static/uploads/probe-symbol-neu.png", media_type: "image" }], total: 1, has_more: false };

const ICON_SVG = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="18" fill="${color}"/><circle cx="64" cy="64" r="34" fill="none" stroke="#fff" stroke-width="10"/><circle cx="64" cy="64" r="8" fill="#fff"/></svg>`;

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const name of ["sponsors**", "notifications/me"]) await page.route(`**/api/${name}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/static/uploads/**", (route) => {
    const color = route.request().url().includes("neu") ? "#8A3DFF" : "#29B6E8";
    return route.fulfill({ contentType: "image/svg+xml", body: ICON_SVG(color) });
  });
  await page.route("**/api/admin/media**", json(LIBRARY));
  const calls = { patch: [] };
  await page.route("**/api/games", json([GAME]));
  await page.route("**/api/games/discord-servers", json([]));
  await page.route("**/api/games/g1", (route) => {
    if (route.request().method() === "PATCH") {
      calls.patch.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...GAME, ...route.request().postDataJSON() }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(GAME) });
  });
  await page.route("**/api/games/g1/usage", json({ total: 0, text: "", counts: {}, modes: { zone: { in_use: false }, ladung: { in_use: false } } }));
  await page.route("**/api/games/g1/maps", json({ game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", modes: MODES }, maps: [], limit: 200, default_pool: null }));
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(locator, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await locator.screenshot({ path: path.join(SHOTS, name) });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Reiter Modi (${width} px): Symbol, Zeiten mit Sekunden, Einstellungen und Regeltext`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games/g1#modi");

    await expect(page.getByTestId("game-edit-mode-icon-thumb-0")).toHaveAttribute("data-icon", "image");
    await expect(page.getByTestId("game-edit-mode-icon-thumb-1")).toHaveAttribute("data-icon", "placeholder");
    // Altbestand in Minuten liest sich als „10 Min.“.
    await expect(page.getByTestId("game-edit-mode-more-0")).toContainText("10 Min.");
    await noSideScroll(page);

    // Modus 2: Symbol aus der Bibliothek, Zeitlimit 1:30, Zeit je Runde 1:45, drei Einstellungen, Regeltext.
    await page.getByTestId("game-edit-mode-more-1").click();
    await page.getByTestId("game-edit-mode-icon-1-library").click();
    await page.locator('button[title="probe-symbol-neu.png"]').click();
    await expect(page.getByTestId("game-edit-mode-icon-thumb-1")).toHaveAttribute("data-icon", "image");
    await page.getByTestId("game-edit-mode-rule-time-1").fill("1:30");
    await page.getByTestId("game-edit-mode-rule-round-time-1").fill("1:45");
    await expect(page.getByTestId("game-edit-mode-more-1")).toContainText("1:30 Min.");
    const prefix = "game-edit-mode-settings-1";
    const rows = [["Lobby", "Ladungsuhr", "seconds", "0:45"], ["Spieler", "Rückblende", "toggle", null], ["", "Kartengröße", "", "klein"]];
    for (const [index, [group, label, unit, value]] of rows.entries()) {
      await page.getByTestId(`${prefix}-add`).click();
      await page.getByTestId(`${prefix}-group-${index}`).fill(group);
      await page.getByTestId(`${prefix}-label-${index}`).fill(label);
      await page.getByTestId(`${prefix}-unit-${index}`).selectOption(unit);
      if (value === null) await page.getByTestId(`${prefix}-value-${index}`).check();
      else await page.getByTestId(`${prefix}-value-${index}`).fill(value);
    }
    await page.getByTestId(`${prefix}-up-2`).click();
    await page.getByTestId(`${prefix}-rules`).fill("Die Uhr läuft nur, solange die Ladung liegt.");
    await noSideScroll(page);
    await shot(page.getByTestId("game-edit-mode-row-1"), `spiel-modus-einstellungen-${width}.png`);

    // Modus 1: Symbol entfernen - danach der Platzhalter.
    await page.getByTestId("game-edit-mode-more-0").click();
    await page.getByTestId("game-edit-mode-icon-0-remove").click();
    await expect(page.getByTestId("game-edit-mode-icon-thumb-0")).toHaveAttribute("data-icon", "placeholder");

    await page.getByTestId("game-save-modi").click();
    await expect.poll(() => calls.patch.length).toBe(1);
    const [zone, ladung] = calls.patch[0].match_modes;
    expect(zone).not.toHaveProperty("icon_url");
    expect(zone.result_rule.time_limit_seconds).toBe(600);
    expect(ladung.icon_url).toBe("/api/static/uploads/probe-symbol-neu.png");
    expect(ladung.result_rule).toMatchObject({ time_limit_seconds: 90, round_time_seconds: 105 });
    expect(ladung.settings).toEqual([
      { label: "Ladungsuhr", unit: "seconds", value: 45, group: "Lobby" },
      { label: "Kartengröße", value: "klein" },
      { label: "Rückblende", unit: "toggle", value: true, group: "Spieler" },
    ]);
    expect(ladung.rules_text).toBe("Die Uhr läuft nur, solange die Ladung liegt.");
  });
}
