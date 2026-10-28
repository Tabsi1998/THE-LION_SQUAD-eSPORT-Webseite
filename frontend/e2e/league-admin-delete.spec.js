const { test, expect } = require("@playwright/test");

// Liga korrigieren, archivieren, löschen (#2106) im echten Browser, Server nachgestellt: Liga bearbeiten mit fester
// Adresse, Löschen mit Auflistung und Grund im Blatt (nie als Browser-Rückfrage), „Archivieren statt löschen“, wenn
// etwas dranhängt, und Staffel löschen auf der Season-Seite. Bei 390 und 1440 px ohne seitliches Scrollen. Nur
// erfundene Namen.

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 4, game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48,
  match_schedule_response_hours: 72, rules_text: "", registration_deadline: null, visibility: "off", status: "draft", blocked_periods: [],
};
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const WEEKS = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false }));
const CALENDAR = { weeks: WEEKS, blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 7 };
const STAFFEL_TITLE = "Probe-Liga Season 1 · Liga 1 · Staffel A";
const SEASON_PAGE = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-shooter" }, season: SEASON,
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [{
    id: "d1", level: 1, nickname: null, overrides: {}, label: "Liga 1", status: "active", calendar: CALENDAR,
    settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: RULES },
    staffeln: [
      { tournament_id: "t1", title: STAFFEL_TITLE, staffel: "A", status: "draft", participant_count: 2, max_participants: 8 },
      { tournament_id: "t2", title: "Probe-Liga Season 1 · Liga 1 · Staffel B", staffel: "B", status: "live", participant_count: 6, max_participants: 8 },
    ],
  }],
};
const LIST = {
  games: [{ id: "g1", name: "Probe Shooter", slug: "probe-shooter" }],
  season_defaults: { weeks_total: 10, matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, best_of: 3, team_size: 4, max_staffel_size: 8 },
  leagues: [{ id: "l1", name: "Probe-Liga mit einem recht langen Namen", slug: "probe-shooter", game_id: "g1", game_name: "Probe Shooter",
    status: "active", description: "Nur zum Testen", game_locked: true, slug_locked: true,
    seasons: [{ id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "active", visibility: "members", start_date: SEASON.start_date, weeks_total: 10 }] }],
};
const BLOCKED = {
  kind: "league", id: "l1", name: "Probe-Liga mit einem recht langen Namen", deletable: false, archived: false,
  blockers: ["Season 1 ist kein Entwurf mehr (läuft)", "Probe-Liga Season 1 · Liga 1 · Staffel B hat schon begonnen oder Spiele"],
  seasons: [], divisions: [], staffeln: [],
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
  for (const path of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/admin/leagues", json(LIST));
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
  await page.route("**/api/admin/leagues/l1/delete-plan", json(BLOCKED));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Liga (${width} px): bearbeiten mit fester Adresse, löschen geht nicht - archivieren`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    const patches = [];
    await page.route("**/api/admin/leagues/l1", (route) => {
      patches.push({ method: route.request().method(), body: route.request().postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ changed: ["status"] }) });
    });
    page.on("dialog", (dialog) => { throw new Error(`Browser-Rückfrage: ${dialog.message()}`); });
    await page.goto("/admin/leagues");

    await page.getByTestId("league-edit-probe-shooter").click();
    await expect(page.getByTestId("league-slug")).toBeDisabled();
    await expect(page.getByTestId("league-game")).toBeDisabled();
    await expect(page.getByTestId("league-edit-sheet")).toContainText("Bleibt /liga/probe-shooter");
    await noSideScroll(page);
    await page.getByTestId("league-edit-sheet-cancel").click();

    await page.getByTestId("league-delete-probe-shooter").click();
    const blocked = page.getByTestId("league-delete-blocked");
    await expect(blocked).toContainText("Archivieren statt löschen");
    await expect(blocked).toContainText("Staffel B hat schon begonnen oder Spiele");
    await expect(page.getByTestId("league-delete-confirm")).toHaveCount(0);
    await noSideScroll(page);
    await page.getByTestId("league-delete-archive").click();
    await expect.poll(() => patches).toEqual([{ method: "PATCH", body: { status: "archived" } }]);
  });

  test(`Season (${width} px): leere Staffel im Entwurf löschen, gestartete ohne Löschknopf`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    const deletes = [];
    await page.route("**/api/admin/leagues/staffeln/t1", (route) => {
      deletes.push({ method: route.request().method(), body: route.request().postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    page.on("dialog", (dialog) => { throw new Error(`Browser-Rückfrage: ${dialog.message()}`); });
    await page.goto("/admin/leagues/seasons/s1");
    await expect(page.getByTestId("staffel-1-A")).toBeVisible();
    await expect(page.getByTestId("staffel-delete-1-B")).toHaveCount(0);
    await expect(page.getByTestId("season-form-response")).toHaveValue("72");
    await noSideScroll(page);

    await page.getByTestId("staffel-delete-1-A").click();
    const list = page.getByTestId("league-delete-list");
    await expect(list).toContainText("Liga 1 · Staffel A");
    await expect(list).toContainText("Die 2 zugeteilten Co-Teams werden dabei aus der Staffel genommen.");
    await expect(page.getByTestId("league-delete-confirm")).toBeDisabled();
    await page.getByTestId("league-delete-reason").fill("Zu wenige Teams gemeldet");
    await noSideScroll(page);
    await page.getByTestId("league-delete-confirm").click();
    await expect.poll(() => deletes).toEqual([{ method: "DELETE", body: { reason: "Zu wenige Teams gemeldet" } }]);
  });
}
