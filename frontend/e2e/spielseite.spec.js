const { test, expect } = require("@playwright/test");

// Spielseite der Verwaltung (#2249) im echten Browser, Server nachgestellt: Spieleliste mit Zahnrad, die Reiter Allgemein,
// Spiel-IDs, Modi und Maps per Klick und per Adresse, Entwürfe über den Reiterwechsel, Rückfrage beim Verlassen, Weiterleitung
// der alten Map-Adresse und schnelles Anlegen. Bei 390 und 1440 px ohne seitliches Scrollen. Nur erfundene Namen und Bilder.
// SHOTS=<Ordner> legt die Bilder fürs Handbuch (turniere.md 3.12 und 3.14) dort ab.

const fs = require("node:fs");
const path = require("node:path");

const SHOTS = process.env.SHOTS || "";
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const MODES = [
  { mode: "stellung", label: "Stellung", minutes: 25, players_per_side: 4, result_rule: { kind: "score", target: 200, time_limit_minutes: 10, draw_allowed: false, overtime: false } },
  { mode: "snd", label: "Suchen & Zerstören", players_per_side: 4, format: "Standard-Regeln", result_rule: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: true } },
  { mode: "kontrolle", label: "Kontrolle", status: "inactive", result_rule: { kind: "highest", draw_allowed: true, overtime: false } },
];
const GAME = {
  id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", short_name: "PS", match_modes: MODES,
  player_id_fields: [
    { key: "probe_id", label: "Probe-ID", help_text: "Steht im Spielprofil", required: true, pattern: "[^#]+#\\d+", format_hint: "Name#1234" },
    // Altbestand (Codex-Nachprüfung #2249): ein Feld mit leerem Schlüssel bleibt, wie es ist.
    { key: "", label: "Altfeld", required: false },
  ],
  default_best_of: 3, setup_minutes: 3,
};
const image = (name) => `/api/static/uploads/probe-${name}.webp`;
const MAPS = [
  { id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: image("hafen"), modes: ["stellung", "snd"], status: "active", in_pools: 2, order: 1 },
  { id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: image("nebel"), modes: ["snd"], status: "active", in_pools: 1, order: 2 },
  { id: "glut", slug: "glutsenke", name: "Glutsenke mit einem sehr langen Kartennamen", image_url: image("glut"), modes: ["stellung"], status: "inactive", in_pools: 1, order: 3 },
  { id: "kupfer", slug: "kupfermine", name: "Kupfermine", image_url: null, modes: [], status: "active", in_pools: 0, order: 4 },
];
const COLORS = { hafen: ["#0E3B52", "#29B6E8"], nebel: ["#2A2F3A", "#8EA1FF"], glut: ["#3A1A10", "#FF8A3D"] };

function svg(name) {
  const [from, to] = COLORS[name] || ["#1A1A1A", "#555555"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><path d="M0 140 L80 90 L150 130 L230 70 L320 120 L320 180 L0 180 Z" fill="rgba(0,0,0,0.35)"/></svg>`;
}

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
    const name = /probe-(\w+)\.webp/.exec(route.request().url())?.[1] || "";
    return route.fulfill({ contentType: "image/svg+xml", body: svg(name) });
  });
  const calls = { patch: [], created: [], mapPatch: [] };
  await page.route("**/api/games", (route) => {
    if (route.request().method() === "POST") {
      calls.created.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "g9", slug: "neues-probe-spiel", name: "Neues Probe-Spiel" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify([GAME]) });
  });
  await page.route("**/api/games/discord-servers", json([]));
  await page.route("**/api/games/g1", (route) => {
    if (route.request().method() === "PATCH") calls.patch.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(GAME) });
  });
  await page.route("**/api/games/g9", json({ id: "g9", name: "Neues Probe-Spiel", slug: "neues-probe-spiel", kind: "standalone", match_modes: [], player_id_fields: [] }));
  await page.route("**/api/games/g1/usage", json({ total: 4, text: "1 Liga, 3 Maps", counts: {},
    modes: { stellung: { in_use: true }, snd: { in_use: true }, kontrolle: { in_use: false } }, id_fields: { probe_id: 2 } }));
  await page.route("**/api/games/g1/maps", json({ game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", modes: MODES }, maps: MAPS, limit: 200, default_pool: null }));
  await page.route("**/api/games/g1/maps/kupfer", (route) => {
    calls.mapPatch.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...MAPS[3], ...route.request().postDataJSON(), affected_seasons: [], warning: null }) });
  });
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, name, options = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), ...options });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Spielseite (${width} px): Liste → Zahnrad → alle Reiter, Entwurf bleibt beim Wechsel, Speichern je Reiter`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games");
    await page.getByTestId("game-settings-probe-shooter").click();
    await expect(page).toHaveURL(/\/admin\/games\/g1$/);
    await expect(page.getByTestId("game-page-title")).toHaveText("Probe Shooter");
    await expect(page.getByRole("tab", { selected: true })).toHaveText("Allgemein");
    await expect(page.getByTestId("game-edit-name")).toHaveValue("Probe Shooter");
    // Fünf Reiter seit C.4 (Ausrüstung, #2218): Passen sie nicht in die Leiste, wird gewischt - dann steht der Hinweis da; am PC passen alle.
    const tabs = await page.getByTestId("game-tabs").evaluate((node) => node.scrollWidth - node.clientWidth);
    if (width >= 768) expect(tabs).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("game-tabs-hint")).toHaveCount(tabs > 1 ? 1 : 0);
    await noSideScroll(page);
    await shot(page, `spielseite-allgemein-${width}.png`);

    await page.getByTestId("game-tab-ids").click();
    await expect(page).toHaveURL(/#ids$/);
    await expect(page.getByTestId("game-id-field-label-0")).toHaveValue("Probe-ID");
    await expect(page.getByTestId("game-id-field-pattern-0")).toHaveValue("[^#]+#\\d+");
    await noSideScroll(page);
    await shot(page, `spielseite-ids-${width}.png`);

    await page.getByTestId("game-tab-modi").click();
    await expect(page).toHaveURL(/#modi$/);
    await expect(page.getByTestId("game-edit-mode-chip-2")).toHaveText("Inaktiv");
    await expect(page.getByTestId("game-edit-mode-locked-0")).toBeVisible();
    await expect(page.getByTestId("game-edit-mode-remove-2")).toBeEnabled();
    await expect(page.getByTestId("game-edit-mode-more-1")).toContainText("Runden gewinnen: 6 Siege, höchstens 11 Runden");
    await page.getByTestId("game-edit-mode-more-1").click();
    await expect(page.getByTestId("game-edit-mode-rule-target-1")).toHaveValue("6");
    await noSideScroll(page);
    await page.getByTestId("game-edit-modes").scrollIntoViewIfNeeded();
    await shot(page, `spielseite-modi-${width}.png`);

    await page.getByTestId("game-tab-maps").click();
    await expect(page).toHaveURL(/#maps$/);
    await expect(page.getByRole("checkbox", { name: "Hafenkante in Suchen & Zerstören freigeben" })).toBeChecked();
    await expect(page.getByTestId("game-map-state-glutsenke")).toContainText("Inaktiv");
    // Die Tabelle wischt am Handy seitlich, die Seite nicht.
    await noSideScroll(page);
    await shot(page, `spielseite-maps-${width}.png`);

    // Ein Entwurf in Allgemein überlebt den Wechsel - der Reiter trägt einen Punkt.
    await page.getByTestId("game-tab-allgemein").click();
    await page.getByTestId("game-edit-short").fill("PSX");
    await expect(page.getByTestId("game-tab-dirty-allgemein")).toBeVisible();
    await expect(page.getByTestId("game-unsaved")).toBeVisible();
    await page.getByTestId("game-tab-modi").click();
    await expect(page.getByTestId("game-tab-dirty-allgemein")).toBeVisible();
    await page.getByTestId("game-tab-allgemein").click();
    await expect(page.getByTestId("game-edit-short")).toHaveValue("PSX");
    await page.getByTestId("game-save-allgemein").click();
    await expect.poll(() => calls.patch.length).toBe(1);
    expect(calls.patch[0]).toMatchObject({ name: "Probe Shooter", short_name: "PSX" });
    expect(calls.patch[0]).not.toHaveProperty("match_modes");
    expect(calls.patch[0]).not.toHaveProperty("player_id_fields");
  });

  test(`Adresse (${width} px): #modi direkt, alte Map-Adresse leitet weiter, Verlassen mit Ungespeichertem fragt`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games/g1#modi");
    await expect(page.getByTestId("game-tab-modi")).toHaveAttribute("aria-selected", "true");

    await page.goto("/admin/games/g1/maps");
    await expect(page).toHaveURL(/\/admin\/games\/g1#maps$/);
    await expect(page.getByTestId("game-tab-maps")).toHaveAttribute("aria-selected", "true");
    await page.getByRole("checkbox", { name: "Kupfermine in Stellung freigeben" }).check();
    await page.getByRole("checkbox", { name: "Kupfermine in Suchen & Zerstören freigeben" }).check();
    await expect.poll(() => calls.mapPatch.length).toBe(2);
    expect(calls.mapPatch[1]).toEqual({ modes: ["stellung", "snd"] });

    await page.getByTestId("game-tab-allgemein").click();
    await page.getByTestId("game-edit-name").fill("Probe Shooter Neu");
    await page.getByTestId("game-page-back").click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Nicht gespeicherte Änderungen" });
    await expect(dialog).toContainText("Allgemein");
    await noSideScroll(page);
    await dialog.getByRole("button", { name: "Zurück zur Seite" }).click();
    await expect(page).toHaveURL(/\/admin\/games\/g1$/);
    await expect(page.getByTestId("game-edit-name")).toHaveValue("Probe Shooter Neu");
    await page.getByTestId("admin-form-cancel").click();
    await page.getByTestId("game-page-back").click();
    await expect(page).toHaveURL(/\/admin\/games$/);
  });

  // Codex-Nachprüfung #2249: Altbestand mit leerem Schlüssel bleibt leer; ein Feld mit gespeicherten IDs entfernen fragt mit
  // der Zahl der Personen, und die Bestätigung geht beim Speichern mit.
  test(`Spiel-IDs (${width} px): leerer Altschlüssel bleibt, Entfernen mit gespeicherten IDs fragt nach`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games/g1#ids");
    await expect(page.getByTestId("game-id-field-key-1")).toHaveValue("");
    await expect(page.getByTestId("game-id-field-key-1")).toBeDisabled();
    await page.getByTestId("game-id-field-remove-0").click();
    const dialog = page.getByRole("dialog").filter({ hasText: "„Probe-ID“ entfernen?" });
    await expect(dialog).toContainText("IDs von 2 Personen");
    await noSideScroll(page);
    await dialog.getByRole("button", { name: "Entfernen" }).click();
    await expect(page.getByTestId("game-ids-removed")).toContainText("„Probe-ID“ (IDs von 2 Personen)");
    await page.getByTestId("game-save-ids").click();
    await expect.poll(() => calls.patch.length).toBe(1);
    expect(calls.patch[0]).toEqual({ player_id_fields: [{ key: "", label: "Altfeld", help_text: "", required: false }], confirm_removed_keys: ["probe_id"] });
  });

  test(`Neues Spiel (${width} px): Name und Art im kurzen Blatt, danach öffnet die Spielseite`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/games");
    await page.getByTestId("game-new").click();
    const sheet = page.getByRole("dialog", { name: "Neues Spiel" });
    await sheet.getByTestId("game-name").fill("Neues Probe-Spiel");
    await noSideScroll(page);
    await shot(page, `spielseite-neu-${width}.png`);
    await sheet.getByTestId("game-submit").click();
    await expect.poll(() => calls.created.length).toBe(1);
    expect(calls.created[0]).toEqual({ name: "Neues Probe-Spiel", slug: "neues-probe-spiel", kind: "standalone", parent_game_id: null });
    await expect(page).toHaveURL(/\/admin\/games\/g9$/);
    await expect(page.getByTestId("game-page-title")).toHaveText("Neues Probe-Spiel");
  });
}
