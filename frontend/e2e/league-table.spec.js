const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Tabelle der Liga-Staffel (E.1, #1625, docs/LIGA.md „E.1 Tabelle“) im echten Browser, Server nachgestellt: Hinweis, was
// den Gleichstand entschied, Entscheid der Leitung mit Grund, kampflos, Tabellenende; keine Spalte „U“ ohne Remis. In der
// Season-Verwaltung der geteilte Platz und „Reihenfolge festlegen“. Bei 390 und 1440 px ohne seitliches Scrollen. Mit
// E2E_SCREENS_DIR legt der Test die Bilder für das Handbuch ab (docs/assets/liga/). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const TEAMS = ["Nordlicht · Nordlicht A", "Sturmfalken · Falken Rot", "Eisbären · Eisbären B", "Wüstenfüchse · Füchse A", "Steinböcke · Steinböcke 2", "Nebelwölfe · Rudel"];
const row = (index, extra = {}) => ({ registration_id: `r${index}`, display_name: TEAMS[index - 1], rank: index, played: 5, won: 3, drawn: 0, lost: 2,
  score_for: 7, score_against: 5, score_diff: 2, points: 9, form: ["W", "L", "W", "W", "L"], previous_rank: null, forfeit_won: 0, forfeit_lost: 0,
  deducted_points: 0, exit: null, tiebreak: null, lead_decision: null, ...extra });
const STANDINGS = [
  row(1, { points: 12, won: 4, lost: 1, score_diff: 5 }),
  row(2, { tiebreak: "head_to_head" }),
  row(3, { tiebreak: "head_to_head", forfeit_won: 1 }),
  row(4, { rank: 4, points: 6, won: 2, lost: 3, score_diff: -1, tiebreak: "lead_decision", lead_decision: { reason: "Losentscheid vor beiden Captains am 20.11." } }),
  row(5, { rank: 5, points: 6, won: 2, lost: 3, score_diff: -1, tiebreak: "lead_decision", lead_decision: { reason: "Losentscheid vor beiden Captains am 20.11." } }),
  row(6, { rank: 6, points: 0, won: 0, lost: 5, score_diff: -10, score_for: 0, score_against: 10, form: ["L", "L", "L", "L", "L"], exit: { kind: "withdrawn", at: "2026-11-27T10:00:00+00:00" }, forfeit_lost: 5 }),
];
const LEAGUES = { leagues: [{ id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" },
  seasons: [{ id: "s1", slug: "season-1", name: "Season 1", status: "active", start_date: "2026-11-09T23:00:00+00:00" }] }] };
const SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 0, loss: 0 }, blocked_periods: [] },
  map_pool: null,
  divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A" }] }],
};
const STAFFEL = {
  staffel: { tournament_id: "t1", staffel: "A", division_label: "Liga 1",
    table_rules: { allow_draws: false, tiebreakers: ["head_to_head", "score_diff", "score_for", "lead_decision"] } },
  standings: STANDINGS, current: 1, teams: [],
  weeks: [{ week: 1, kind: "matchday", matchday: 1, label: "Spieltag 1", first_day: "2026-11-10", last_day: "2026-11-16", matches: [
    { id: "m1", matchday: 1, done: true, status: "forfeit", forfeit: true, double_forfeit: true, home: { registration_id: "r4", name: TEAMS[3], score: null },
      away: { registration_id: "r5", name: TEAMS[4], score: null }, winner_registration_id: null, games: [] }] }],
};

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const CALENDAR = { weeks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false })),
  blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 5, end_date: "2027-01-18T22:59:59+00:00" };
const RULES = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff", "score_for", "lead_decision"],
  head_to_head_criteria: ["points", "score_diff", "score_for"], allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON_PAGE = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" },
  season: { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4,
    game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "public", status: "active", blocked_periods: [] },
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [{ id: "d1", level: 1, overrides: {}, label: "Liga 1", calendar: CALENDAR, settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: RULES },
    staffeln: [{ tournament_id: "t1", staffel: "A", status: "live", participant_count: 6, max_participants: 8 }] }],
};
const TABLE = {
  can_decide: true, rules: { tiebreakers: RULES.table_tiebreakers }, standings: STANDINGS,
  ties: [{ rank: 4, registration_ids: ["r4", "r5"], names: [TEAMS[3], TEAMS[4]], points: 6 }],
  decisions: [{ id: "d0", registration_ids: ["r2", "r3"], names: [TEAMS[1], TEAMS[2]], reason: "Losentscheid nach Spieltag 3", decided_at: "2026-11-24T19:00:00+00:00", applies: false }],
};

async function mockServer(page, { admin = false } = {}) {
  // Ohne Hochzählen und Einblenden - die Bilder fürs Handbuch zeigen den Endstand.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (admin) await page.route("**/api/auth/me", json(ADMIN));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues", json(LEAGUES));
  await page.route("**/api/leagues/probe-liga/season-1", json(SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(STAFFEL));
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
  await page.route("**/api/admin/leagues/staffeln/t1/table", json(TABLE));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function screenshot(locator, name, width, only) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir || width !== only) return;
  await locator.screenshot({ path: path.join(dir, `${name}-${width === 390 ? "handy" : "pc"}.png`), animations: "disabled" });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Staffel-Tabelle (${width} px): was entschied, Entscheid der Leitung, kampflos, Tabellenende`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe-liga/season-1");
    const staffel = page.getByTestId("league-staffel-A");
    const table = staffel.getByRole("table", { name: "Tabelle Staffel A" });
    await expect(table.getByTestId("standing-row-r6")).toContainText("Nebelwölfe");
    await expect(staffel.getByTestId("standing-notes-r2")).toHaveText("Direkter Vergleich");
    await expect(staffel.getByTestId("standing-notes-r3")).toContainText("1× kampflos gewonnen");
    await expect(staffel.getByTestId("standing-notes-r4")).toContainText("Platz durch Entscheid der Leitung: Losentscheid vor beiden Captains am 20.11.");
    await expect(staffel.getByTestId("standing-notes-r6")).toHaveText("Ausgetreten");
    await expect(table.getByRole("columnheader", { name: "U", exact: true })).toHaveCount(0);
    await expect(staffel.getByTestId("league-tiebreak-order-A")).toHaveText("Reihenfolge: Punkte → Direkter Vergleich → Map-Differenz → Mehr gewonnene Maps → Entscheid der Leitung");
    await expect(staffel.getByTestId("league-match-m1")).toContainText("beide nicht erschienen");
    await noSideScroll(page);
    await screenshot(staffel.locator(".tls-league-table"), "liga-tabelle-gleichstand", width, 1440);
  });

  test(`Season-Verwaltung (${width} px): geteilter Platz, Reihenfolge festlegen mit Grund`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { admin: true });
    let sent = null;
    await page.route("**/api/admin/leagues/staffeln/t1/table-decision", (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "d1", ...sent }) });
    });
    // Reiter Tabelle (#2267): Punkte, Gleichstand und Ausscheiden über den Gleichständen der Staffeln.
    await page.goto("/admin/leagues/seasons/s1#tabelle");
    const panel = page.getByTestId("season-table-panel");
    await expect(panel.getByTestId("season-tie-t1-4")).toContainText("Platz 4: Wüstenfüchse · Füchse A, Steinböcke · Steinböcke 2");
    await expect(panel.getByTestId("season-decision-d0")).toContainText("Gilt nicht mehr");
    await expect(page.getByTestId("tiebreaker-head_to_head")).toBeChecked();
    await expect(page.getByTestId("season-form-exit-rule")).toHaveValue("all_for_opponents");
    await noSideScroll(page);
    await screenshot(panel, "liga-gleichstand-entscheid", width, 390);
    await panel.getByTestId("season-tie-decide-4").click();
    const sheet = page.getByTestId("table-decision-sheet");
    await sheet.getByTestId("table-decision-down-0").click();
    await sheet.getByTestId("table-decision-reason").fill("Losentscheid vor beiden Captains am 20.11.");
    await sheet.getByTestId("table-decision-save").click();
    await expect.poll(() => sent).toEqual({ registration_ids: ["r5", "r4"], reason: "Losentscheid vor beiden Captains am 20.11." });
    await noSideScroll(page);
  });
}
