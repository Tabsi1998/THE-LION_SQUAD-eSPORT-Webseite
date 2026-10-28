const { test, expect } = require("@playwright/test");

// Staffel in der Turnierverwaltung (#2109) im echten Browser, Server nachgestellt: Kopf mit Season-Link, Liga-Ablauf,
// Status ohne Anmeldung/Check-in, Reiter „Tabelle“ und das Formular mit den Season-Werten nur lesend. Bei 390 und
// 1440 px ohne seitliches Scrollen. Nur erfundene Namen.

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const STAFFEL = {
  id: "t1", slug: "probe-liga-season-1-liga-1-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
  format: "league", team_mode: "team", team_size: 4, min_participants: 2, max_participants: 8, best_of: 3, game_id: "g1",
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter" },
  start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7, default_match_weekday: 6,
  default_match_time: "20:00", match_schedule_response_hours: 72, result_confirm_hours_league: 48, visibility: "internal",
  is_public: false, rules: "## Regeln\nFair spielen.", registration_enabled: false, discord_registration: false, discord_skip: true,
  season_weight: 0, result_entry_mode: "player_confirmed", event_mode: "online", participant_count: 2,
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" }, league_label: "Liga · Staffel A",
  league_links: { league_name: "Probe-Liga", season_name: "Season 1", division_label: "Liga 1", staffel: "A",
    season_admin_path: "/admin/leagues/seasons/s1", public_path: "/liga/probe-shooter/season-1" },
  can_manage_structure: true, can_manage_results: true, can_manage_all_results: true, can_plan_matches: true, staff_scopes: [],
  can_check_in: true, can_manage_participants: true, can_assign_stations: false, can_use_staff_tools: true,
};
const REGS = [
  { id: "r1", status: "approved", display_name: "Nebelwölfe · Rudel", team_id: "tm1", squad_id: "sq1" },
  { id: "r2", status: "approved", display_name: "Sturmfalken · Horst", team_id: "tm2", squad_id: "sq2" },
];

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games", "partners", "events**", "stations**", "admin/choices/teams**",
    "tournaments/t1/staff", "tournaments/t1/stages", "tournaments/t1/matches-v2", "access-links**", "tournaments/t1/access-links**"]) {
    await page.route(`**/api/${path}`, json([]));
  }
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/tournaments/t1/registrations", json(REGS));
  await page.route("**/api/tournaments/t1/bracket", json({ rounds: [], matches_v2: [], stages: [], registrations: REGS }));
  await page.route(/\/api\/tournaments\/t1(\?.*)?$/, json(STAFFEL));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Staffel-Verwaltung (${width} px): Kopf, Liga-Ablauf, Status, Teilnehmer`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/tournaments/t1");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Staffel A");
    await expect(page.getByTestId("staffel-header")).toContainText("Liga 1 · Staffel A");
    await expect(page.getByTestId("staffel-season-link")).toHaveAttribute("href", "/admin/leagues/seasons/s1");
    await expect(page.getByTestId("staffel-public-link")).toHaveAttribute("href", "/liga/probe-shooter/season-1");
    await expect(page.getByTestId("tournament-flow-stepper")).toContainText("Co-Teams zuteilen");
    await expect(page.getByTestId("tournament-flow-stepper")).not.toContainText("Check-in");
    await expect(page.getByTestId("admin-tr-primary-action")).toContainText("Liga starten");
    const statuses = await page.getByTestId("admin-tr-status-select").locator("option").evaluateAll((options) => options.map((option) => option.value));
    expect(statuses).not.toContain("check_in");
    expect(statuses).not.toContain("registration_open");
    await expect(page.getByTestId("admin-tr-tab-bracket")).toHaveText("Tabelle");
    await expect(page.locator('[data-testid="status-assigned"]:visible').first()).toHaveText("Zugeteilt");
    await expect(page.getByRole("button", { name: "Check-in" })).toHaveCount(0);
    await expect(page.getByTestId("participant-add-submit")).toHaveCount(0);
    await noSideScroll(page);
  });

  test(`Staffel bearbeiten (${width} px): Season-Werte nur lesend, Antwortfrist änderbar`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/tournaments/t1?tab=edit");
    const values = page.getByTestId("tr-edit-season-values");
    await expect(values).toContainText("Aus der Season");
    await expect(page.getByTestId("tr-edit-season-bo")).toHaveText("Best of 3");
    await expect(values.getByRole("link", { name: "Season öffnen" })).toHaveAttribute("href", "/admin/leagues/seasons/s1");
    await expect(page.getByTestId("tr-edit-response-hours")).toHaveValue("72");
    await expect(page.getByTestId("tr-edit-start")).toHaveCount(0);
    await expect(page.getByTestId("tr-edit-discord-registration")).toHaveCount(0);
    await expect(page.getByTestId("tr-edit-staffel-remix")).toBeVisible();
    await noSideScroll(page);
  });
}
