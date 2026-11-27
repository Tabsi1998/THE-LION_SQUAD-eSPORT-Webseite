const { test, expect } = require("@playwright/test");
const path = require("node:path");

// Schalter „Einzelspieler erlaubt“ auf der Spielseite (#1629, Nr. 296) im echten Browser, Server nachgestellt: im Reiter Allgemein bei
// Name und Art, Vorgabe an (auch ein Altspiel ohne Feld), aus geht mit dem Speichern mit - und spielt schon eine Solo-Liga das Spiel,
// steht der Satz des Servers „Spiel hat Solo-Ligen: …“ da. Bei 390 und 1440 px ohne seitliches Scrollen, feste Uhr. Mit
// E2E_SCREENS_DIR legt der Test die Bilder ab. Nur erfundene Namen.

const NOW = new Date("2026-11-27T10:00:00+00:00");
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
// Altspiel: ohne Feld ``supports_solo`` - gilt als erlaubt.
const GAME = { id: "g1", name: "Probe Duell", slug: "probe-duell", kind: "standalone", short_name: "PD", match_modes: [], player_id_fields: [] };
const BLOCKED = "Spiel hat Solo-Ligen: Duell-Liga. Einzelspieler bleiben erlaubt, solange eine Solo-Liga dieses Spiel spielt – auch eine archivierte. Für Teams allein eine neue Team-Liga anlegen.";

async function mockServer(page, { refuse = false } = {}) {
  await page.clock.setFixedTime(NOW);
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
  await page.route("**/api/games", json([GAME]));
  await page.route("**/api/games/discord-servers", json([]));
  const patches = [];
  await page.route("**/api/games/g1", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      patches.push(body);
      if (refuse) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: BLOCKED }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...GAME, ...body }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(GAME) });
  });
  return patches;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", fullPage: true, style: ".tls-bottom-nav { display: none !important; }" });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Spielseite (${width} px): „Einzelspieler erlaubt“ an für ein Altspiel, aus geht mit`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const patches = await mockServer(page);
    await page.goto("/admin/games/g1");
    const toggle = page.getByTestId("game-edit-solo");
    await expect(toggle).toBeChecked();
    await expect(page.getByTestId("game-general-identity")).toContainText("Einzelspieler erlaubt");
    await toggle.scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await shot(page, `spiel-einzelspieler-${width}`);
    await toggle.uncheck();
    await page.getByTestId("game-save-allgemein").click();
    await expect.poll(() => patches.at(-1)?.supports_solo).toBe(false);
  });

  test(`Spielseite (${width} px): Spiel mit Solo-Liga - Ausschalten steht mit dem Satz des Servers da`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { refuse: true });
    await page.goto("/admin/games/g1");
    await page.getByTestId("game-edit-solo").uncheck();
    await page.getByTestId("game-save-allgemein").click();
    await expect(page.getByText("Spiel hat Solo-Ligen: Duell-Liga.", { exact: false })).toBeVisible();
    await noSideScroll(page);
    await shot(page, `spiel-einzelspieler-gesperrt-${width}`);
  });
}
