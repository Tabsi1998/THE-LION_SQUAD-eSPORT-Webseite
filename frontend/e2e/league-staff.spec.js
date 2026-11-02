const { test, expect } = require("@playwright/test");

// Bereich Ligen und Zuständige (docs/LIGA.md Abschnitt 12, #2203) im echten Browser, Server nachgestellt: Vergabe auf der Liga-Seite,
// was Zuständige und die Turnierleitung sehen, Befangenheit auf der Matchseite. Bei 390 und 1440 px ohne seitliches Scrollen.
// Nur erfundene Namen.

const MFA = { mfa_enabled: true, auth_mfa_verified: true };
const AREA = { id: "a1", username: "ligaleitung", display_name: "Ligaleitung", role: "player", areas: ["leagues"], ...MFA };
const STAFF = { id: "z1", username: "zustaendig", display_name: "Zuständig", role: "player", areas: [], has_league_staff: true, ...MFA };
const LEAD = { id: "t1", username: "turnierleitung", display_name: "Turnierleitung", role: "tournament_admin", areas: ["tournaments", "moderation"], ...MFA };
const SEASON_ROW = { id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "draft", visibility: "members", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10 };
const LEAGUE = { id: "l1", name: "Probe-Liga mit einem recht langen Namen", slug: "probe", game_name: "Probe Shooter", status: "active", seasons: [SEASON_ROW] };
const ROW = { user_id: "u1", display_name: "Erika Beispiel mit recht langem Namen", capabilities: ["results", "disputes", "matches"], second_factor: true };
const NO_MFA_ROW = { user_id: "u2", display_name: "Max Muster", capabilities: ["roster"], second_factor: false };

const MATCH_PAGE = {
  tournament: { id: "t1", slug: "liga-a", title: "Probe-Liga · Staffel A" },
  match: { id: "m1", match_key: "L1", status: "scheduled", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  participants: [{ slot: 1, registration_id: "a", display_name: "Löwen · Rudel A" }, { slot: 2, registration_id: "b", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_dispute: false, event_mode: "online",
  result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", conflict: { kind: "involved", override: false },
};

const SEASON_BODY = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe" },
  season: { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 2, game_mode_order: [],
    scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: [] }, rules_text: "", visibility: "members", status: "draft", blocked_periods: [] },
  game: { id: "g1", name: "Probe Shooter", modes: [] },
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8, rounds_needed: 7 },
  library: [], map_pool: null, divisions: [],
};
const ROSTER = {
  season: { id: "s1", name: "Season 1" }, game: { name: "Probe Shooter" }, fields: [], counts: {},
  squads: [{ registration_id: "r9", team_id: "t9", squad_id: "s9", display_name: "Löwen · Rudel mit einem recht langen Namen", staffel_label: "Liga 1 · Staffel A", member_count: 2, min_squad_size: 2,
    squad_status: "active", captain_id: "p1", vice_captain_id: null, member_ids: ["p1", "p2"], players: [], short: false,
    team_members: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Bert" }, { id: "p3", name: "Clara mit einem recht langen Namen" }] }],
};

async function mockServer(page, user, routes = {}) {
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
  await page.route("**/api/auth/me", json(user));
  for (const [path, body] of Object.entries(routes)) await page.route(`**/api/${path}`, json(body));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [name, viewport] of [["390", { width: 390, height: 844 }], ["1440", { width: 1440, height: 900 }]]) {
  test.describe(`bei ${name} px`, () => {
    test.use({ viewport });

    test("der Bereich Ligen vergibt Zuständigkeiten", async ({ page }) => {
      await mockServer(page, AREA, {
        "admin/leagues": { games: [{ id: "g1", name: "Probe Shooter" }], season_defaults: {}, can_create: true, leagues: [{ ...LEAGUE, capabilities: ["manage", "season"] }] },
        "admin/leagues/l1/staff": { staff: [ROW, NO_MFA_ROW], can_grant: true },
        "admin/people/search**": [{ id: "p9", name: "Neue Person", context: "Mitglied" }],
      });
      const saved = [];
      await page.route("**/api/admin/leagues/l1/staff/p9", async (route) => {
        saved.push(route.request().postDataJSON());
        await route.fulfill({ contentType: "application/json", body: "{}" });
      });
      await page.goto("/admin/leagues");
      await page.getByTestId("league-staff-probe").click();
      const sheet = page.getByTestId("league-staff-sheet");
      await expect(sheet.getByTestId("league-staff-row-u1")).toContainText("Ergebnisse korrigieren · Proteste · Spiele betreuen");
      await expect(sheet.getByTestId("league-staff-no-mfa-u2")).toContainText("Zwei-Faktor");
      await noSideScroll(page);

      await expect(sheet.getByTestId("league-staff-grant")).toBeDisabled();
      await sheet.getByTestId("league-staff-person-search").fill("Neue");
      await sheet.getByTestId("league-staff-person-option-p9").click();
      await sheet.getByTestId("league-staff-new-results").check();
      await sheet.getByTestId("league-staff-new-roster").check();
      await sheet.getByTestId("league-staff-grant").click();
      await expect.poll(() => saved).toEqual([{ capabilities: ["results", "roster"] }]);
      await noSideScroll(page);
    });

    test("Zuständige sehen nur die Knöpfe ihrer Zuständigkeit", async ({ page }) => {
      await mockServer(page, STAFF, {
        "admin/leagues": { games: [], season_defaults: {}, can_create: false, leagues: [{ ...LEAGUE, capabilities: ["roster"] }] },
      });
      await page.goto("/admin/leagues");
      await expect(page.getByTestId("season-link-season-1")).toBeVisible();
      await expect(page.getByTestId("league-add")).toHaveCount(0);
      await expect(page.getByTestId("league-staff-probe")).toHaveCount(0);
      await expect(page.getByTestId("league-delete-probe")).toHaveCount(0);
      await noSideScroll(page);
    });

    test("befangen: die Matchseite sagt warum, ohne Knopf zum Eintragen", async ({ page }) => {
      await mockServer(page, STAFF, { "matches/m1/page": MATCH_PAGE, "matches/m1/chat": [] });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("match-conflict")).toContainText("zweite berechtigte Person");
      await expect(page.getByTestId("match-staff-result-open")).toHaveCount(0);
      await noSideScroll(page);
    });

    test("Kader prüfen: aus der Kaderübersicht den Kader bearbeiten", async ({ page }) => {
      await mockServer(page, STAFF, {
        "admin/leagues/seasons/s1": { ...SEASON_BODY, capabilities: ["roster"] },
        "admin/leagues/seasons/s1/roster": ROSTER,
      });
      const saved = [];
      await page.route("**/api/teams/t9/squads/s9", async (route) => {
        saved.push(route.request().postDataJSON());
        await route.fulfill({ contentType: "application/json", body: "{}" });
      });
      await page.goto("/admin/leagues/seasons/s1");
      await page.getByTestId("roster-edit-r9").click();
      const sheet = page.getByTestId("kader-sheet");
      await expect(sheet.getByTestId("kader-member-p1")).toBeDisabled();
      await sheet.getByTestId("kader-member-p3").check();
      await noSideScroll(page);
      await sheet.getByTestId("kader-vice_captain_id").selectOption("p2");
      await sheet.getByTestId("kader-save").click();
      await expect.poll(() => saved).toEqual([{ member_ids: ["p1", "p2", "p3"], vice_captain_id: "p2" }]);
      await noSideScroll(page);
    });

    for (const [who, user] of [
      ["Turnierleitung", { ...LEAD, has_league_staff: true }],
      ["ein Helfer", { ...STAFF, is_tournament_staff: true, has_staff_assignment: true }],
    ]) {
      test(`${who} mit Zuständigkeit kommt auf die Liga-Seite (#2230)`, async ({ page }) => {
        await mockServer(page, user, {
          "admin/leagues": { games: [], season_defaults: {}, can_create: false, leagues: [{ ...LEAGUE, capabilities: ["roster"] }] },
        });
        await page.goto("/admin/leagues");
        await expect(page.getByTestId("season-link-season-1")).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/leagues$/);
        await noSideScroll(page);
      });
    }

    test("Liga verwalten: Das Banner wählt aus den eigenen Bildern, nicht aus den Admin-Medien (#2230)", async ({ page }) => {
      await mockServer(page, STAFF, {
        "admin/leagues": { games: [{ id: "g1", name: "Probe Shooter" }], season_defaults: {}, can_create: false, leagues: [{ ...LEAGUE, game_id: "g1", capabilities: ["manage"] }] },
        "media**": { items: [], total: 0 },
      });
      const libraries = [];
      page.on("request", (request) => {
        if (/\/api\/(admin\/)?media/.test(request.url())) libraries.push(new URL(request.url()).pathname);
      });
      await page.route("**/api/admin/media**", (route) => route.fulfill({ status: 403, contentType: "application/json", body: "{}" }));
      await page.goto("/admin/leagues");
      await page.getByTestId("league-edit-probe").click();
      await page.getByTestId("league-banner-library").click();
      await expect.poll(() => libraries).toEqual(["/api/media"]);
      await noSideScroll(page);
    });

    test("die Turnierleitung allein kommt nicht auf die Liga-Seite", async ({ page }) => {
      await mockServer(page, LEAD);
      await page.goto("/admin/leagues");
      await expect(page).toHaveURL(/\/403/);
      await noSideScroll(page);
    });
  });
}
