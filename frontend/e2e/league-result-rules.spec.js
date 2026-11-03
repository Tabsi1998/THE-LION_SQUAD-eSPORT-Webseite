const { test, expect } = require("@playwright/test");

// Ergebnisregeln im Liga-Meldeformular (docs/LIGA.md, C.3, #1617) bei 390 und 1440 px: die Regel je Map steht an der Map, die
// Punkte sind Pflicht, ein Endstand gegen die Regel kommt vor dem Absenden im Klartext - kein seitlicher Überlauf. Die API ist
// nachgestellt, Namen und Werte sind erfunden.

// Bilder fürs Handbuch: feste Leisten (Kopf, Sprunglink, Leiste unten) liegen sonst mitten im Ausschnitt.
const CLEAN_SHOT = "header, .fixed, .sticky, a[href^='#'] { visibility: hidden !important; }";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SIDES = [{ registration_id: "a", name: "Loewen Langername · Rudel Alpha" }, { registration_id: "b", name: "Falken mit sehr langem Namen · Horst" }];
const POOL = {
  modes: [
    { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafenkante" }, { map_id: "nebel", name: "Nebelwerk am Fluss" }] },
    { mode: "suchen", label: "Suchen & Zerstören", maps: [{ map_id: "turm", name: "Turm" }, { map_id: "nebel", name: "Nebelwerk am Fluss" }] },
  ],
};
const LEAGUE = {
  best_of: 3, needed: 2, team_size: 1, mode_order: ["stellung", "suchen"], pool: POOL, sides: SIDES, own_registration_id: "a",
  roster: [{ id: "u1", name: "Mila Mustermann" }], rosters: {}, games: [], lineups_missing: [], own_games: [], proposal_games: [],
  can_amend_lineup: false, not_played: [],
  result_rules: { stellung: { kind: "score", target: 250, time_limit_minutes: 10 }, suchen: { kind: "rounds", target: 6, round_limit: 11 } },
  scores_required: true,
};
const PAGE = {
  tournament: { id: "t1", slug: "cod-liga-a", title: "CoD-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0].name }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1].name }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
  match: { id: "m1", match_key: "L1", status: "in_progress", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  league: LEAGUE, report_state: { status: "open" },
};

async function setup(page, reports) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json({ id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" }));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/matches/m1/page") return route.fulfill(json(PAGE));
    if (path === "/api/matches/m1/report") {
      reports.push(route.request().postDataJSON());
      return route.fulfill(json({ awaiting_confirmation: true, report_status: "waiting" }));
    }
    if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Liga: Ergebnisregeln im Meldeformular", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Regel je Map und Prüfung vorab bei ${width} px`, async ({ page }, testInfo) => {
      const reports = [];
      await page.setViewportSize({ width, height: 900 });
      await setup(page, reports);
      await page.goto("/matches/m1");

      await expect(page.getByTestId("league-game-1-rule")).toHaveText("Gewertet: bis 250 Punkte · 10 Min.");
      await page.getByTestId("league-game-1-map-hafen").click();
      await page.getByTestId("league-game-1-winner-a").click();
      await page.getByTestId("league-game-1-lineup-u1").click();
      await page.getByTestId("league-game-1-score-a").fill("100");
      await page.getByTestId("league-game-1-score-b").fill("250");
      await expect(page.getByTestId("match-report-sentence")).toContainText("Map 1: Der Endstand 100:250 passt nicht zum Sieger");
      await page.getByTestId("league-game-1-score-a").fill("250");
      await page.getByTestId("league-game-1-score-b").fill("180");

      await expect(page.getByTestId("league-game-2-rule")).toHaveText("Gewertet: 6 Runden, höchstens 11");
      await page.getByTestId("league-game-2-map-turm").click();
      await page.getByTestId("league-game-2-winner-a").click();
      await page.getByTestId("league-game-2-score-a").fill("7");
      await page.getByTestId("league-game-2-score-b").fill("5");
      await page.getByTestId("match-report-submit").click();
      await expect(page.getByTestId("match-report-error")).toHaveText("Map 2: höchstens 11 Runden – 7:5 sind 12.");
      expect(reports).toHaveLength(0);
      await expectNoSideScroll(page);
      await testInfo.attach(`regel-${width}.png`, { body: await page.getByTestId("match-report-form").screenshot({ style: CLEAN_SHOT }), contentType: "image/png" });

      await page.getByTestId("league-game-2-score-a").fill("6");
      await page.getByTestId("match-report-submit").click();
      await expect.poll(() => reports.length).toBe(1);
      expect(reports[0].games.map((game) => game.scores)).toEqual([{ a: 250, b: 180 }, { a: 6, b: 5 }]);
    });
  }
});

// ---------------------------------------------------------------- Season-Seite

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 4, game_mode_order: [], scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff"] },
  result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "members", status: "active", blocked_periods: [],
};
const SEASON_PAGE = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-shooter" }, capabilities: ["manage", "season", "rules"], season: SEASON,
  game: { id: "g1", name: "Probe Shooter", modes: [] }, library: [], map_pool: null, divisions: [],
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8, rounds_needed: 7, end_date: "2027-01-18T22:59:59+00:00" },
};
const RULES = {
  scores_required: true, staffeln: 2,
  rules: [
    { mode: "stellung", label: "Stellung mit sehr langem Namen für schmale Bildschirme", status: "active", differs: true,
      season_rule: { kind: "score", target: 250, time_limit_minutes: 10, draw_allowed: false, overtime: false },
      game_rule: { kind: "score", target: 300, time_limit_minutes: 10, draw_allowed: false, overtime: false } },
    { mode: "suchen", label: "Suchen & Zerstören", status: "inactive", differs: false,
      season_rule: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: false },
      game_rule: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: false } },
  ],
};

test.describe("Liga: Ergebnisregeln der Season", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Season-Regeln bei ${width} px ohne seitlichen Überlauf`, async ({ page }, testInfo) => {
      const puts = [];
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
      });
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/changes")) return route.abort();
        if (path === "/api/auth/me") return route.fulfill(json(ADMIN));
        if (path === "/api/admin/leagues/seasons/s1") return route.fulfill(json(SEASON_PAGE));
        if (path === "/api/admin/leagues/seasons/s1/result-rules" && request.method() === "PUT") {
          puts.push(request.postDataJSON());
          return route.fulfill(json({ ...RULES, changed: true, staffeln_to_sync: 2 }));
        }
        if (path === "/api/admin/leagues/seasons/s1/result-rules") return route.fulfill(json(RULES));
        if (request.method() !== "GET") return route.fulfill(json({ ok: true }));
        return route.fulfill(json(["/api/settings/public", "/api/home/about", "/api/chats/unread", "/api/seasonal/active"].includes(path) ? {} : []));
      });
      await page.goto("/admin/leagues/seasons/s1");

      const panel = page.getByTestId("season-result-rules");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("result-rules-stellung-differs")).toHaveText("weicht vom Spiel ab");
      await page.getByTestId("result-rules-stellung-adopt").click();
      await expect(page.getByTestId("result-rules-stellung-target")).toHaveValue("300");
      await panel.scrollIntoViewIfNeeded();
      await expectNoSideScroll(page);
      await testInfo.attach(`season-regeln-${width}.png`, { body: await panel.screenshot({ style: CLEAN_SHOT }), contentType: "image/png" });
      await page.getByTestId("result-rules-save").click();
      await expect.poll(() => puts.length).toBe(1);
      expect(puts[0].rules.stellung.target).toBe(300);
      await expect(page.getByTestId("season-sync-hint")).toBeVisible();
    });
  }
});
