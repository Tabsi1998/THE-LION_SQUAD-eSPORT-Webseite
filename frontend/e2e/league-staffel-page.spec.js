const { test, expect } = require("@playwright/test");

// Staffel-Seite der Liga-Verwaltung (#2262, Paket A) im echten Browser, Server nachgestellt: Kopf mit Brotkrumen, Reiter Überblick
// und Teilnehmer, Co-Team zuteilen, Austritt, Rechte ohne Knöpfe. Bei 390 und 1440 px ohne seitliches Scrollen, Tippflächen ab 44 px.
// Nur erfundene Namen.

const LEAD = { id: "lead-1", username: "ligaleitung", display_name: "Ligaleitung", role: "user", areas: ["leagues"], mfa_enabled: true, auth_mfa_verified: true };
const ALL = ["applications", "manage", "matches", "results", "roster", "sanctions", "season"];
const STAFFEL = {
  id: "t1", slug: "probe-liga-season-1-liga-1-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
  format: "league", team_mode: "team", team_size: 4, min_participants: 2, max_participants: 8, best_of: 3, game_id: "g1",
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" },
  league_links: { league_name: "Probe-Liga", season_name: "Season 1", division_label: "Liga 1", staffel: "A",
    season_admin_path: "/admin/leagues/seasons/s1", public_path: "/liga/probe-liga/season-1", staffel_admin_path: "/admin/leagues/staffeln/t1" },
  league_capabilities: ALL, can_edit_staffel: true, can_manage_participants: true, can_manage_structure: true, can_use_staff_tools: true,
};
const REGS = [
  { id: "r1", status: "approved", display_name: "Nebelwölfe · Rudel", team_id: "tm1", squad_id: "sq1" },
  { id: "r2", status: "approved", display_name: "Sturmfalken · Horst", team_id: "tm2", squad_id: "sq2", late_entry: { state: "done", from_week: 3 } },
];
const CANDIDATES = {
  min_squad_size: 4, seats_taken: 2, max_participants: 8, id_label: "Spiel-ID",
  teams: [{ id: "tm3", name: "Bergdohlen", tag: "BD", in_staffel: false, squads: [
    { id: "sq3", display_name: "Bergdohlen · Schwarm", member_count: 5, problems: [], players: [], captain: null, vice_captain: null },
  ] }],
};

async function mockServer(page, { staffel = {}, registrations = REGS, matches = [] } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  const calls = [];
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games", "partners", "events**"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(LEAD));
  await page.route("**/api/admin/my-leagues**", json({ leagues: [{ id: "l1", capabilities: ALL }] }));
  await page.route("**/api/tournaments/t1/registrations", json(registrations));
  await page.route("**/api/tournaments/t1/matches-v2", json(matches));
  await page.route("**/api/team-day/t1/lineups", json({}));
  await page.route("**/api/tournaments/t1/squad-candidates", json(CANDIDATES));
  await page.route("**/api/admin/leagues/seasons/s1/sanctions", json({ items: [
    { id: "x1", status: "active", kind_label: "Spielsperre", target_type: "squad", registration_id: "r1", squad_id: "sq1", tournament_id: "t1" },
  ] }));
  await page.route("**/api/admin/leagues/seasons/s1/roster", json({ squads: [] }));
  await page.route("**/api/tournaments/t1/squad-registrations", (route) => {
    calls.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ids_missing: [] }) });
  });
  await page.route("**/api/tournaments/t1/registrations/r1/removal", (route) => {
    const body = route.request().postDataJSON();
    calls.push({ url: route.request().url(), body });
    const plan = { id: "plan-1", ops: [{ kind: "forfeit", text: "Woche 3: Sturmfalken gewinnen kampflos." }], summary: "1 Spiel betroffen." };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body.plan_id ? { ok: true } : { ok: true, plan }) });
  });
  await page.route(/\/api\/tournaments\/t1(\?.*)?$/, json({ ...STAFFEL, ...staffel }));
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Alle sichtbaren Knöpfe und Links im Inhalt der Staffel sind mindestens 44 px hoch (Tippflächen). */
async function touchTargets(page, testId) {
  const small = await page.getByTestId(testId).evaluate((root) => [...root.querySelectorAll("button, a, select")]
    .filter((node) => node.offsetParent !== null)
    .map((node) => ({ text: (node.textContent || node.getAttribute("aria-label") || "").trim().slice(0, 40), height: Math.round(node.getBoundingClientRect().height) }))
    .filter((row) => row.height < 44));
  expect(small).toEqual([]);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Staffel-Seite (${width} px): Kopf, Überblick und Teilnehmer`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/leagues/staffeln/t1");
    await expect(page.getByTestId("staffel-title")).toHaveText("Liga 1 · Staffel A");
    await expect(page.getByTestId("staffel-crumb-season")).toHaveAttribute("href", "/admin/leagues/seasons/s1");
    await expect(page.getByTestId("staffel-tabs").getByRole("tab")).toHaveText(["Überblick", "Teilnehmer"]);
    await expect(page.getByTestId("tournament-flow-stepper")).toContainText("Co-Teams zuteilen");
    await expect(page.getByTestId("staffel-primary-action")).toContainText("Liga starten");
    await expect(page.getByTestId("staffel-numbers-teams")).toContainText("2 von 8");
    await expect(page.getByTestId("staffel-desk-link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#leitstand");
    await noSideScroll(page);
    await touchTargets(page, "staffel-panel-ueberblick");

    await page.getByTestId("staffel-tab-teilnehmer").click();
    await expect(page).toHaveURL(/#teilnehmer$/);
    const list = page.getByTestId("staffel-reg-list");
    await expect(list.locator(width < 768 ? '[data-testid="staffel-reg-card-r1"]' : '[data-testid="staffel-reg-row-r1"]')).toBeVisible();
    await expect(list.locator('[data-testid="staffel-reg-late-r2"]:visible')).toHaveText("Nachgemeldet ab Woche 3");
    await expect(list.locator('[data-testid="staffel-reg-sanction-x1"]:visible')).toHaveAttribute("href", "/admin/leagues/seasons/s1#strafen");
    await expect(page.getByTestId("staffel-entry-link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#anmeldungen");
    await noSideScroll(page);
    await touchTargets(page, "staffel-panel-teilnehmer");
  });

  test(`Staffel-Seite (${width} px): Co-Team zuteilen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/leagues/staffeln/t1#zuteilen");
    await page.getByTestId("squad-assign-open").click();
    const dialog = page.getByTestId("squad-assign-dialog");
    await expect(dialog).toContainText("Co-Team zuteilen");
    await dialog.getByTestId("squad-assign-team-tm3").click();
    await dialog.getByTestId("squad-assign-squad-sq3").check();
    await noSideScroll(page);
    await dialog.getByTestId("squad-assign-confirm").click();
    await expect.poll(() => calls.find((row) => row.url.endsWith("/squad-registrations"))?.body).toEqual({ team_id: "tm3", squad_id: "sq3" });
  });

  test(`Staffel-Seite (${width} px): Austritt im laufenden Betrieb`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page, { staffel: { status: "live" }, matches: [{ id: "m1", status: "scheduled", slots: [{ registration_id: "r1" }, { registration_id: "r2" }] }] });
    await page.goto("/admin/leagues/staffeln/t1#austritt");
    await expect(page.locator('[data-testid="staffel-reg-remove-r1"]')).toHaveCount(0);
    await page.locator('[data-testid="admin-reg-withdraw-r1"]:visible').click();
    const dialog = page.getByTestId("admin-reg-removal-dialog");
    await expect(dialog).toContainText("Austritt von Nebelwölfe · Rudel eintragen?");
    await expect(dialog).toContainText("Sturmfalken gewinnen kampflos");
    await dialog.getByTestId("admin-reg-removal-confirm").click();
    await expect.poll(() => calls.filter((row) => row.url.endsWith("/removal")).map((row) => row.body.plan_id || null)).toEqual([null, "plan-1"]);
  });

  test(`Staffel-Seite (${width} px): ohne Rechte keine Knöpfe`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { staffel: { status: "live", league_capabilities: ["season"], can_edit_staffel: false, can_manage_participants: false } });
    await page.goto("/admin/leagues/staffeln/t1");
    await expect(page.getByTestId("staffel-status-readonly")).toContainText("Live");
    await expect(page.getByTestId("staffel-primary-action")).toHaveCount(0);
    await expect(page.getByTestId("staffel-status-select")).toHaveCount(0);
    await page.getByTestId("staffel-tab-teilnehmer").click();
    await expect(page.getByTestId("staffel-teams-count")).toBeVisible();
    await expect(page.getByTestId("squad-assign-open")).toHaveCount(0);
    await expect(page.locator('[data-testid^="admin-reg-withdraw-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="admin-reg-disqualify-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="staffel-reg-remove-"]')).toHaveCount(0);
    await noSideScroll(page);
  });
}
