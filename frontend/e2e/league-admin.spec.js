const { test, expect } = require("@playwright/test");

// Liga verwalten (docs/LIGA.md, #1622) im echten Browser, Server nachgestellt: Einstieg mit Ligen und Seasons, die Season
// mit Kalender, Sperrzeiten, Map-Pool, Liga N und Staffel. Bei 390 und 1440 px ohne seitliches Scrollen. Nur erfundene
// Namen.

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 4, game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48,
  rules_text: "## Regeln", registration_deadline: "2026-11-06", visibility: "members", status: "draft",
  blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
};
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const WEEKS = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: index === 6 || index === 7 }));
const CALENDAR = { weeks: WEEKS, blocked_weeks: [7, 8], active_weeks: 8, max_teams_per_staffel: 8, rounds_needed: 7, end_date: "2027-01-18T22:59:59+00:00" };
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }] };
const SEASON_PAGE = {
  league: { id: "l1", name: "Probe-Liga mit einem recht langen Namen", slug: "probe-shooter" }, season: SEASON, game: GAME, calendar: CALENDAR,
  library: [{ id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: null, modes: ["stellung", "snd"], order: 1, aliases: [] }],
  map_pool: null,
  divisions: [{
    id: "d1", level: 1, nickname: "Elite", overrides: { best_of: 5 }, label: "Liga 1 · Elite", calendar: CALENDAR,
    settings: { best_of: 5, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: RULES },
    staffeln: [
      { tournament_id: "t1", staffel: "A", status: "draft", participant_count: 8, max_participants: 8 },
      { tournament_id: "t2", staffel: "B", status: "registration_closed", participant_count: 5, max_participants: 8 },
    ],
  }],
};
const LIST = {
  games: [{ id: "g1", name: "Probe Shooter", slug: "probe-shooter" }],
  season_defaults: { weeks_total: 10, matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, best_of: 3, team_size: 4, max_staffel_size: 8 },
  leagues: [{ id: "l1", name: "Probe-Liga", slug: "probe-shooter", game_name: "Probe Shooter", status: "active",
    seasons: [{ id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "draft", visibility: "members", start_date: SEASON.start_date, weeks_total: 10 }] }],
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
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Liga (${width} px): Schritte, Liga mit Season`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/leagues");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Liga");
    await expect(page.getByTestId("season-link-season-1")).toContainText("Nur Mitglieder");
    await noSideScroll(page);
  });

  test(`Season (${width} px): Kalender, Sperrzeiten, Liga N und Staffeln`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/leagues/seasons/s1");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Season 1");
    await expect(page.getByTestId("season-calendar")).toContainText("8 Spielwochen");
    await expect(page.getByTestId("blocked-label-0")).toHaveValue("Weihnachtspause");
    await expect(page.getByTestId("staffel-manage-1-B")).toHaveAttribute("href", "/admin/tournaments/t2");
    await noSideScroll(page);
  });
}
