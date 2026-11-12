const { test, expect } = require("@playwright/test");

// Spielberechtigung in der Liga (#2204) bei 390 und 1440 px, Server nachgestellt, nur erfundene Namen:
// - Matchseite: Maps je Map, die Teilnehmerliste einmal am Schluss, Bestätigen, Nachtragen, nach der Frist.
// - Team-Seite: Regeln, Stand je Spieler, Transfer beantragen.
// - Profil: eigener Stand und Format der ID.
// - Season-Seite: Einstellungen, Wartezeit aufheben, Transfers entscheiden.
// Kein seitliches Scrollen.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player", consent_required: false };

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function mock(page, handler, user) {
  await page.addInitScript(CONSENT);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(user);
    const answer = await handler(path, request);
    if (answer !== undefined) return json(answer);
    if (request.method() !== "GET") return json({ ok: true });
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active", "/friends"];
    return json(objects.includes(path) ? {} : []);
  });
}

// ---------------------------------------------------------------- Matchseite

const SIDES = [{ registration_id: "a", name: "Loewen Langername · Rudel Alpha" }, { registration_id: "b", name: "Falken mit sehr langem Namen · Horst" }];
const POOL = { modes: [{ mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafenkante" }, { map_id: "turm", name: "Turm" }] }] };
const ROSTER = [
  { id: "u1", name: "Mila Mustermann" }, { id: "u2", name: "Tom Beispiel" }, { id: "u3", name: "Ida Langername-Doppelname" }, { id: "u4", name: "Ben" }, { id: "u5", name: "Pia" }, { id: "u6", name: "Rio" },
  { id: "u7", name: "Lea", lineup_blocked: "Neu im Kader: darf ab 09.11.2026, 12:00 spielen." },
  { id: "u8", name: "Noa", lineup_blocked: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein." },
];
const LEAGUE = {
  lineup_mode: "series", lineup_min_players: 3, participants: {}, own_lineup: [], lineup_overdue: false,
  best_of: 1, needed: 1, team_size: 4, mode_order: [], pool: POOL, sides: SIDES, own_registration_id: "a", roster: ROSTER, rosters: {},
  games: [], lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false, id_label: null, lobby_ids: [], map_repeat: "always",
};
const MATCH_PAGE = {
  tournament: { id: "t1", slug: "cod-liga-a", title: "CoD-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0].name }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1].name }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
  match: { id: "m1", match_key: "L1", status: "in_progress", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  report_state: { status: "open" },
  league: LEAGUE,
};
const PLAYED = [{ position: 1, mode: "stellung", mode_label: "Stellung", map_id: "hafen", map_name: "Hafenkante", winner_registration_id: "a", scores: {}, lineups: {} }];
const DONE_PAGE = {
  ...MATCH_PAGE,
  can_report_score: false, can_player_report_result: false, report_state: null,
  match: { ...MATCH_PAGE.match, status: "completed", results: [{ registration_id: "a", rank: 1, score: 1 }, { registration_id: "b", rank: 2, score: 0 }], completed_at: "2026-11-02T12:00:00+00:00" },
};

// ---------------------------------------------------------------- Team-Seite

const TEAM = {
  id: "team", name: "Loewen", tag: "LOE", my_role: "leader", can_manage: true, can_edit_team: true, member_ids: ["u1", "u2", "u3"], leader_id: "u1",
  members: [{ id: "u1", display_name: "Mila Mustermann" }, { id: "u2", display_name: "Tom Beispiel" }, { id: "u3", display_name: "Ida Langername-Doppelname" }],
};
const SQUADS = [{
  id: "sq", team_id: "team", name: "Rudel Alpha", status: "active", member_ids: ["u1", "u2"], can_edit: true,
  members: [{ id: "u1", display_name: "Mila Mustermann" }, { id: "u2", display_name: "Tom Beispiel" }],
  league_requirement: { min_size: 3, title: "CoD-Liga", max_size: 50, min_age: 18, transfers_open: true },
}];
const ELIGIBILITY = {
  seasons: [{
    season_id: "s1", title: "Season 1", can_edit: true, transfers: [],
    rules: { min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, new_player_wait_days: 7, min_age: 18, transfer_windows: [{ start_date: "2026-11-01", end_date: "2026-11-30", label: "Herbst" }], transfer_open: true },
    players: [
      { id: "u1", name: "Mila Mustermann", state: "locked", ok: true, reason: null, age: "met", until: null },
      { id: "u2", name: "Tom Beispiel", state: "age_missing", ok: false, reason: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein.", age: "missing", until: null },
    ],
    candidates: [{ id: "u3", name: "Ida Langername-Doppelname", can_add: false, needs_transfer: true, reason: "Steht oder stand in dieser Season in einem anderen Co-Team. Ein Wechsel geht nur als Transfer." }],
  }],
};

// ---------------------------------------------------------------- Season-Seite

const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, new_player_wait_days: 7, min_age: 18, unique_game_ids: true, lineup_mode: "series", lineup_min_players: 3, transfer_windows: [],
  game_mode_order: [], scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] }, result_confirm_hours: 48, lineup_amend_hours: 48,
  rules_text: "", visibility: "members", status: "active", blocked_periods: [],
};
const SEASON_PAGE = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-shooter", capabilities: ["manage", "season", "roster", "rules", "applications", "matches", "results", "disputes", "sanctions"] }, season: SEASON, game: { id: "g1", name: "Probe Shooter", modes: [] },
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8, rounds_needed: 7, end_date: "2027-01-18T22:59:59+00:00" }, library: [], map_pool: null, divisions: [],
};
const ROSTER_PAGE = {
  season: { id: "s1", name: "Season 1", roster_deadline: null },
  rules: { min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, new_player_wait_days: 7, min_age: 18, transfer_windows: [], transfer_open: false },
  fields: [{ key: "id", label: "Spiel-ID" }],
  counts: { waiting: 1, age: 1 },
  squads: [{
    registration_id: "r1", squad_id: "sq", staffel_label: "Liga 1 · Staffel A", display_name: "Loewen Langername · Rudel Alpha",
    players: [
      { id: "u1", name: "Mila Mustermann", state: "locked", ok: true, text: "Mila#1234567", profile_text: "Mila#1234567", changed: false, approvals: [], eligibility: { state: "waiting", ok: false, reason: "Neu im Kader: darf ab 09.11.2026, 12:00 spielen.", until: "2026-11-09T11:00:00+00:00", age: "met" } },
      { id: "u2", name: "Tom Beispiel", state: "locked", ok: true, text: "Tom#1234567", profile_text: "Tom#1234567", changed: false, approvals: [], eligibility: { state: "age_missing", ok: false, reason: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein.", until: null, age: "missing" } },
    ],
  }],
};
const TRANSFERS = { items: [{ id: "t1", status: "pending", user_name: "Ida Langername-Doppelname", from_squad_name: "Rudel Beta", to_squad_name: "Rudel Alpha" }] };

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`Spielberechtigung (${width} px)`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

    test("Melden: Maps je Map, die Liste einmal am Schluss, auch sechs Personen", async ({ page }) => {
      await page.setViewportSize({ width, height });
      let sent = null;
      await mock(page, (path, request) => {
        if (path === "/matches/m1/page") return MATCH_PAGE;
        if (path === "/matches/m1/report" && request.method() === "POST") {
          sent = request.postDataJSON();
          return { ...MATCH_PAGE.match, awaiting_confirmation: true };
        }
        return undefined;
      }, CAPTAIN);
      await page.goto("/matches/m1");

      await page.getByTestId("league-game-1-map-hafen").click();
      await page.getByTestId("league-game-1-winner-a").click();
      await expect(page.getByTestId("league-game-1-lineup")).toHaveCount(0);
      await expect(page.getByTestId("match-report-sentence")).toContainText("mindestens 3");
      await expect(page.getByTestId("league-participants-u7")).toBeDisabled();
      await expect(page.getByTestId("league-participants-blocked")).toContainText("darf ab");
      await noSideScroll(page);

      for (const id of ["u1", "u2", "u3", "u4", "u5", "u6"]) await page.getByTestId(`league-participants-${id}`).click();
      await expect(page.getByTestId("league-participants-count")).toHaveText("6 · mindestens 3");
      await page.getByTestId("match-report-submit").click();

      await expect.poll(() => sent?.lineup?.length).toBe(6);
      expect(sent.games[0]).toEqual(expect.objectContaining({ map_id: "hafen", winner_registration_id: "a" }));
      expect(sent.games[0].lineup).toBeUndefined();
    });

    test("Bestätigen: die Gegenseite kreuzt einmal an", async ({ page }) => {
      await page.setViewportSize({ width, height });
      let sent = null;
      const payload = { ...MATCH_PAGE, report_state: { status: "confirm", proposal_by: "Falken" }, league: { ...LEAGUE, proposal_games: PLAYED } };
      await mock(page, (path, request) => {
        if (path === "/matches/m1/page") return payload;
        if (path === "/matches/m1/report" && request.method() === "POST") {
          sent = request.postDataJSON();
          return { ...MATCH_PAGE.match, awaiting_confirmation: false };
        }
        return undefined;
      }, CAPTAIN);
      await page.goto("/matches/m1");

      await page.getByTestId("match-report-confirm").click();
      await expect(page.getByTestId("league-confirm-error")).toContainText("mindestens 3");
      for (const id of ["u1", "u2", "u3"]) await page.getByTestId(`league-confirm-participants-${id}`).click();
      await noSideScroll(page);
      await page.getByTestId("match-report-confirm").click();
      await expect.poll(() => sent?.lineup).toEqual(["u1", "u2", "u3"]);
    });

    test("Nachtragen: Das Ergebnis gilt, Captain trägt die eigene Seite ein", async ({ page }) => {
      await page.setViewportSize({ width, height });
      let sent = null;
      const payload = {
        ...DONE_PAGE,
        league: { ...LEAGUE, games: PLAYED, can_amend_lineup: true, lineups_missing: ["a"], amend_until: "2030-01-01T12:00:00+00:00",
          participants: { b: [{ id: "x1", name: "Falke Eins" }, { id: "x2", name: "Falke Zwei" }, { id: "x3", name: "Falke Drei" }] } },
      };
      await mock(page, (path, request) => {
        if (path === "/matches/m1/page") return payload;
        if (path === "/matches/m1/lineups" && request.method() === "PUT") {
          sent = request.postDataJSON();
          return { ...DONE_PAGE.match, idempotent_replay: false };
        }
        return undefined;
      }, CAPTAIN);
      await page.goto("/matches/m1");

      await expect(page.getByTestId("league-participants-a")).toContainText("Teilnehmerliste fehlt noch");
      await expect(page.getByTestId("league-participants-b")).toContainText("Falke Eins");
      await expect(page.getByTestId("league-lineup-amend")).toContainText("Das Ergebnis gilt");
      for (const id of ["u1", "u2", "u3"]) await page.getByTestId(`league-amend-participants-${id}`).click();
      await noSideScroll(page);
      await page.getByTestId("league-amend-save").click();
      await expect.poll(() => sent).toEqual({ lineup: ["u1", "u2", "u3"] });
    });

    test("Nach der Frist: Das Ergebnis bleibt, der Fall liegt bei der Leitung", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const payload = { ...DONE_PAGE, league: { ...LEAGUE, games: PLAYED, can_amend_lineup: false, lineups_missing: ["a"], amend_until: "2020-01-01T12:00:00+00:00" } };
      await mock(page, (path) => (path === "/matches/m1/page" ? payload : undefined), CAPTAIN);
      await page.goto("/matches/m1");

      const closed = page.getByTestId("league-lineup-closed");
      await expect(closed).toContainText("Das Ergebnis bleibt gültig");
      await expect(closed).toContainText("Liga-Leitung");
      await noSideScroll(page);
    });

    test("Team-Seite: Regeln, Stand und Transfer beantragen", async ({ page }) => {
      await page.setViewportSize({ width, height });
      let asked = null;
      await mock(page, (path, request) => {
        if (path === "/teams/my") return [TEAM];
        if (path === "/teams/team/squads") return SQUADS;
        if (path === "/teams/team/squads/sq/eligibility") return ELIGIBILITY;
        if (path === "/teams/team/squads/sq/transfers" && request.method() === "POST") {
          asked = request.postDataJSON();
          return { id: "t1", status: "pending" };
        }
        return undefined;
      }, CAPTAIN);
      await page.goto("/profile?tab=teams");

      const panel = page.getByTestId("squad-eligibility-sq");
      await expect(panel).toContainText("1 Person darf nicht spielen");
      await expect(panel).toContainText("Mindestalter: 18 Jahre");
      await expect(page.getByTestId("squad-eligibility-player-u2")).toContainText("Geburtsdatum fehlt");
      await expect(panel).not.toContainText("19");
      await noSideScroll(page);
      await page.getByTestId("squad-transfer-ask-u3").click();
      await expect.poll(() => asked).toEqual({ user_id: "u3" });
    });

    test("Profil: eigener Stand, Auswahl und Format der ID", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page, (path) => {
        if (path === "/me/league-eligibility") {
          return { items: [{ season_id: "s1", squad_id: "sq", title: "CoD-Liga · Season 1", state: "age_missing", ok: false, reason: "Geburtsdatum fehlt.", age: "missing", min_age: 18 }] };
        }
        if (path === "/games") {
          return [{ id: "g1", slug: "probe", name: "Probe Shooter", kind: "game", effective_player_id_fields: [
            { key: "id", label: "Spiel-ID", required: true, format_hint: "Name#1234567" },
            { key: "plattform", label: "Plattform", required: true, options: ["Plattform A", "Plattform B"] },
          ] }];
        }
        return undefined;
      }, CAPTAIN);
      await page.goto("/profile?tab=gaming");

      await expect(page.getByTestId("profile-league-eligibility-s1")).toContainText("Geburtsdatum");
      await expect(page.getByTestId("profile-game-id-hint-probe-id")).toContainText("Name#1234567");
      await expect(page.getByTestId("profile-game-id-probe-plattform").locator("option")).toHaveCount(3);
      await noSideScroll(page);
    });

    test("Season-Seite: Einstellungen, Wartezeit aufheben, Transfer genehmigen", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const posts = [];
      await mock(page, (path, request) => {
        if (path === "/admin/leagues/seasons/s1") return SEASON_PAGE;
        if (path === "/admin/leagues/seasons/s1/roster") return ROSTER_PAGE;
        if (path === "/admin/leagues/seasons/s1/transfers") return TRANSFERS;
        if (request.method() === "POST") posts.push([path, request.postDataJSON()]);
        return undefined;
      }, ADMIN);
      // Reiter „Anmeldung und Kader“ (#2267); der Link aus „Transfer beantragt“ zeigt auf #kader.
      await page.goto("/admin/leagues/seasons/s1#kader");
      await expect(page.getByTestId("season-tab-anmeldung")).toHaveAttribute("aria-selected", "true");

      await expect(page.getByTestId("season-form-max-squad")).toHaveValue("50");
      await expect(page.getByTestId("season-form-min-age")).toHaveValue("18");
      await expect(page.getByTestId("season-form-lineup-mode")).toHaveValue("series");
      await page.getByTestId("season-form-transfer-add").click();
      await expect(page.getByTestId("season-form-transfer-start-0")).toBeVisible();
      await noSideScroll(page);

      await expect(page.getByTestId("season-roster-rules")).toContainText("Mindestalter");
      await page.getByTestId("roster-waive-u1").click();
      await page.getByTestId("roster-waive-reason-u1").fill("Team wäre sonst nicht spielfähig");
      await page.getByTestId("roster-waive-save-u1").click();
      await expect.poll(() => posts.map((row) => row[0])).toContain("/admin/leagues/seasons/s1/roster/u1/waive-wait");

      await page.getByTestId("season-transfer-approve-t1").click();
      await expect.poll(() => posts.map((row) => row[0])).toContain("/admin/leagues/seasons/s1/transfers/t1/approve");
      await noSideScroll(page);
    });
  });
}
