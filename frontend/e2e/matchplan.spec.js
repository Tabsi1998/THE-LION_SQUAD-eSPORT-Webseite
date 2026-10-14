const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Matchplan-Seite (#1557) im echten Browser: Zeitleiste, Vorschau, Ziehen, live, Worst Case, online, Liga, Handy.
// Die API ist mit echten Planer-Antworten nachgestellt (e2e/fixtures/matchplanGenerated.json, erzeugt von
// scripts/make_matchplan_fixture.py). Mit MATCHPLAN_SHOTS=<Ordner> legt der Lauf Bilder für den PR ab.

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "matchplanGenerated.json"), "utf8"));
const SHOTS = process.env.MATCHPLAN_SHOTS || "";

async function shot(page, name, options = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true, ...options });
}

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

async function mockSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", json({
    id: "admin-1", email: "admin@example.test", display_name: "Turnierleitung", username: "admin", role: "superadmin",
    is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true,
  }));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
}

async function mockState(page, state, { plan = state.plan } = {}) {
  const tid = state.tournament.id;
  await page.route(`**/api/tournaments/${tid}?**`, json(state.tournament));
  await page.route(`**/api/tournaments/${tid}/registrations**`, json(state.registrations));
  await page.route(`**/api/tournaments/${tid}/stages**`, json(state.stages));
  await page.route(`**/api/tournaments/${tid}/matches-v2**`, json(state.matches));
  await page.route(`**/api/tournaments/${tid}/bracket**`, json({
    tournament: state.tournament, stages: state.stages, matches_v2: state.matches, registrations: state.registrations, duration_game: state.duration_game,
  }));
  await page.route("**/api/stations?**", json(state.stations));
  await page.route(`**/api/tournaments/${tid}/schedule/plan`, json(plan));
  await page.route(`**/api/tournaments/${tid}/schedule/apply`, json(fixture.local.apply_response));
  await page.route(`**/api/tournaments/${tid}/schedule/deadlines`, json(state.deadlines || { matches: [] }));
  await page.route(`**/api/tournaments/${tid}/matchdays**`, json(state.matchdays || { applies: false, matchdays: [] }));
  await page.route("**/api/tournaments?**", json([state.tournament]));
  return tid;
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Matchplan-Seite", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Größen stellt der Test selbst ein");
    await mockSession(page);
  });

  test("Vorschau: „Automatisch planen“ zeigt, was der Planer schreiben würde", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tid = await mockState(page, fixture.local.preview);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-settings")).toBeVisible();
    await page.getByRole("button", { name: "Automatisch planen" }).click();
    await expect(page.getByTestId("mp-preview")).toContainText("14 Spiele bekommen Zeit und Station");
    await expect(page.getByTestId("mp-bar-FINAL")).toBeVisible();
    await noOverflow(page);
    await page.waitForTimeout(400);
    await shot(page, "01-vorschau-desktop.png");
  });

  test("live: Verzug oben, laufendes Spiel rot, erledigte grau", async ({ page }) => {
    await page.clock.setFixedTime(new Date(fixture.live.now));
    await page.setViewportSize({ width: 1440, height: 900 });
    const tid = await mockState(page, fixture.live);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-delay")).toContainText("Verzug");
    await expect(page.getByTestId("mp-bar-C")).toHaveAttribute("data-state", "running");
    await expect(page.getByTestId("mp-now")).toBeVisible();
    await noOverflow(page);
    await shot(page, "02-live-desktop.png");
  });

  test("Konflikt: zu früh gesetzter fester Termin, in Worten", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tid = await mockState(page, fixture.local.conflict);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-warnings")).toContainText("ist fest um");
    await expect(page.getByTestId("mp-bar-E")).toHaveAttribute("data-conflict", "true");
    await page.getByTestId("mp-flow").getByRole("button", { name: /^E,/ }).click();
    await page.waitForTimeout(900);
    await shot(page, "03-konflikt-desktop.png");
  });

  test("Ziehen: Geist zeigt Ziel, belegtes Feld sofort orange", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tid = await mockState(page, fixture.local.applied);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    const b = page.getByTestId("mp-bar-B");
    const a = page.getByTestId("mp-bar-A");
    await b.scrollIntoViewIfNeeded();
    const from = await b.boundingBox();
    const to = await a.boundingBox();
    await page.mouse.move(from.x + 20, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 22, { steps: 4 });
    await page.mouse.move(to.x + 20, to.y + 20, { steps: 8 });
    await expect(page.getByTestId("mp-ghost")).toHaveAttribute("data-blocked", "true");
    await expect(page.getByTestId("mp-drag-status")).toContainText("im Weg: A");
    await shot(page, "04-ziehen-desktop.png", { fullPage: false, clip: { x: 0, y: Math.max(0, to.y - 260), width: 1440, height: 520 } });
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("Worst Case: 47 Spiele, 8 Stationen, eine defekt, lange Namen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tid = await mockState(page, fixture.big);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId(/^mp-lane-/)).toHaveCount(8);
    await page.getByRole("button", { name: "Automatisch planen" }).click();
    await expect(page.getByTestId("mp-preview")).toContainText("47 Spiele bekommen Zeit und Station");
    await expect(page.getByTestId("mp-lane-" + fixture.big.stations.find((s) => s.status === "broken").id)).toContainText("defekt");
    await noOverflow(page);
    await shot(page, "05-worst-case-desktop.png");
  });

  test("online: keine Stationen, Fristen je Spiel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tid = await mockState(page, fixture.online);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-online")).toContainText("nicht erschienen ab");
    await expect(page.getByTestId("mp-timeline")).toHaveCount(0);
    await shot(page, "06-online-desktop.png");
  });

  test("Liga: Spielwochen mit Frist", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tid = await mockState(page, fixture.league);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-league")).toContainText("Spielwoche 1");
    await noOverflow(page);
    await shot(page, "07-liga-desktop.png");
  });

  test("Handy 375: Liste je Station statt breiter Zeitleiste, nichts läuft über", async ({ page }) => {
    await page.clock.setFixedTime(new Date(fixture.live.now));
    await page.setViewportSize({ width: 375, height: 812 });
    const tid = await mockState(page, fixture.live);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await expect(page.getByTestId("mp-agenda")).toBeVisible();
    await expect(page.getByTestId("mp-timeline")).toBeHidden();
    await noOverflow(page);
    await shot(page, "08-live-handy.png");
  });

  test("Handy 375: Worst Case mit langen Namen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const tid = await mockState(page, fixture.big);
    await page.goto(`/admin/tournaments/${tid}?tab=matchplan`);
    await page.getByRole("button", { name: "Automatisch planen" }).click();
    await expect(page.getByTestId("mp-preview")).toBeVisible();
    await expect(page.getByTestId("mp-agenda")).toBeVisible();
    await noOverflow(page);
    await shot(page, "09-worst-case-handy.png");
  });

  test("Stationen-Seite: Belegung als Zeitleiste, alle Spieler, Weg in den Matchplan", async ({ page }) => {
    await page.clock.setFixedTime(new Date(fixture.live.now));
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockState(page, fixture.live);
    await page.goto("/admin/stations");
    await expect(page.getByTestId("stations-timeline")).toBeVisible();
    await expect(page.getByRole("link", { name: "Im Matchplan öffnen" })).toBeVisible();
    await noOverflow(page);
    await shot(page, "10-stationen-desktop.png");
  });
});
