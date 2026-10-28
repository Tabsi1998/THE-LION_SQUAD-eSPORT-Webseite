const { test, expect } = require("@playwright/test");

// Spiel-ID je Liga-Season (#2108) bei 390 und 1440 px, Server nachgestellt, nur erfundene Namen und IDs:
// - Co-Team zuteilen: je Spieler die ID bzw. „keine ID“ mit Warnung - zuteilen geht trotzdem.
// - Matchseite: Spieler ohne ID grau mit Grund, Activision-ID beider Seiten für die Lobby.
// - Profil: die ID ändern zeigt sofort „In der laufenden Liga gilt weiter …“.
// - Season-Seite: Kader und Spiel-IDs mit Freigabe.
// Kein seitliches Scrollen.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const FIELDS = [{ key: "activision_id", label: "Activision-ID" }];

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
  { id: "u1", name: "Mila Mustermann", game_id_text: "TestloeweMila#1234567", lineup_blocked: null },
  { id: "u2", name: "Tom Beispiel", game_id_text: null, lineup_blocked: "Activision-ID fehlt im Profil." },
  { id: "u3", name: "Ida Langername-Doppelname", game_id_text: null, lineup_blocked: "Nach dem Stichtag ins Co-Team gekommen – die Liga-Leitung muss die Spiel-ID erst freigeben." },
  { id: "u4", name: "Ben", game_id_text: "TestloeweBen#7654321", lineup_blocked: null },
];
const MATCH_PAGE = {
  tournament: { id: "t1", slug: "cod-liga-a", title: "CoD-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0].name }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1].name }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
  match: { id: "m1", match_key: "L1", status: "in_progress", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  report_state: { status: "open" },
  league: {
    best_of: 1, needed: 1, team_size: 2, mode_order: [], pool: POOL, sides: SIDES, own_registration_id: "a", roster: ROSTER, rosters: {},
    games: [], lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false, id_label: "Activision-ID",
    lobby_ids: [
      { registration_id: "a", name: SIDES[0].name, players: ROSTER.map((row) => ({ id: row.id, name: row.name, text: row.game_id_text, ok: !row.lineup_blocked, reason: row.lineup_blocked })) },
      { registration_id: "b", name: SIDES[1].name, players: [{ id: "f1", name: "Falke Eins", text: "FalkeMitLangemNamen#9999999", ok: true }] },
    ],
  },
};

// ---------------------------------------------------------------- Zuteilen

const CANDIDATES = {
  min_squad_size: 4, max_participants: 8, seats_taken: 2, id_label: "Activision-ID",
  teams: [{
    id: "t-loewen", name: "Loewen", tag: "LOE", in_staffel: false,
    squads: [{
      id: "s-a", name: "Rudel A", display_name: "Loewen · Rudel A", member_count: 4, captain: { id: "u1", display_name: "Mila" }, vice_captain: null, problems: [],
      players: [
        { id: "u1", name: "Mila Mustermann", state: "locked", ok: true, text: "TestloeweMila#1234567" },
        { id: "u2", name: "Tom Beispiel", state: "missing", ok: false, text: null, reason: "Activision-ID fehlt im Profil." },
        { id: "u3", name: "Ida Langername-Doppelname", state: "pending", ok: true, text: "IdaMitSehrLangerKennung#1234567" },
        { id: "u4", name: "Ben", state: "missing", ok: false, text: null },
      ],
    }],
  }],
};
const TOURNAMENT = {
  id: "t1", slug: "cod-liga-a", title: "CoD-Liga Season 1 · Liga 1 · Staffel A", format: "league", team_mode: "team", team_size: 4,
  status: "draft", game_id: "g1", league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" },
  can_use_staff_tools: true, can_manage_structure: true, can_manage: true, is_tournament_lead: true,
};

// ---------------------------------------------------------------- Season-Seite

const ROSTER_PAGE = {
  season: { id: "s1", name: "Season 1", roster_deadline: "2026-12-01" },
  fields: FIELDS,
  counts: { missing: 1, late: 1, changed: 1 },
  squads: [{
    registration_id: "r1", staffel_label: "Liga 1 · Staffel A", display_name: "Loewen Langername · Rudel Alpha",
    players: [
      { id: "u1", name: "Mila Mustermann", state: "locked", ok: true, text: "TestloeweMila#1234567", profile_text: "MilaNeuMitLangerKennung#7654321", changed: true, locked_at: "2026-10-28T10:00:00+00:00", approvals: [] },
      { id: "u2", name: "Tom Beispiel", state: "missing", ok: false, text: null, profile_text: null, changed: false, reason: "Activision-ID fehlt im Profil.", approvals: [] },
      { id: "u3", name: "Ida Langername-Doppelname", state: "late", ok: false, text: null, profile_text: "Ida#1234567", changed: false, reason: "Nach dem Stichtag ins Co-Team gekommen – die Liga-Leitung muss die Spiel-ID erst freigeben.", approvals: [] },
    ],
  }],
};
const RULES = { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 4, game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48,
  rules_text: "", visibility: "members", status: "active", blocked_periods: [],
};
const CALENDAR = { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8, rounds_needed: 7, end_date: "2027-01-18T22:59:59+00:00" };
const SEASON_PAGE = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-shooter" }, season: SEASON, game: { id: "g1", name: "Probe Shooter", modes: [] },
  calendar: CALENDAR, library: [], map_pool: null, divisions: [],
};

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`Spiel-ID je Season (${width} px)`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

    test("Matchseite: ohne ID grau mit Grund, IDs für die Lobby", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page, (path) => (path === "/matches/m1/page" ? MATCH_PAGE : undefined), { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("league-game-1")).toBeVisible();
      await expect(page.getByTestId("league-game-1-lineup-u2")).toBeDisabled();
      await expect(page.getByTestId("league-game-1-lineup-blocked")).toContainText("Nicht aufstellbar: Tom Beispiel – Activision-ID fehlt im Profil.");
      await page.getByTestId("league-game-1-lineup-u1").click();
      await page.getByTestId("league-game-1-lineup-u4").click();
      await expect(page.getByTestId("league-game-1-lineup-u1")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("league-lobby-ids").locator("summary").click();
      await expect(page.getByTestId("league-lobby-ids-b")).toContainText("FalkeMitLangemNamen#9999999");
      await expect(page.getByTestId("league-lobby-ids-a")).toContainText("Activision-ID fehlt im Profil.");
      await noSideScroll(page);
    });

    test("Co-Team zuteilen: ID je Spieler mit Warnung", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page, (path) => {
        if (path === "/tournaments/t1/squad-candidates") return CANDIDATES;
        if (path === "/tournaments/t1" || path === "/admin/tournaments/t1") return TOURNAMENT;
        return undefined;
      }, ADMIN);
      // Der Dialog steht für sich - geprüft wird er über die Turnierverwaltung der Staffel.
      await page.goto("/admin/tournaments/t1");
      await page.getByTestId("squad-assign-open").click();
      await page.getByTestId("squad-assign-dialog").locator('label[aria-label="Loewen"]').click();
      await expect(page.getByTestId("squad-assign-ids-s-a")).toContainText("TestloeweMila#1234567");
      await expect(page.getByTestId("squad-assign-ids-warning-s-a")).toContainText("Ohne gültige Activision-ID: Tom Beispiel, Ben.");
      await expect(page.getByTestId("squad-assign-squad-s-a")).toBeEnabled();
      await noSideScroll(page);
    });

    test("Profil: neue ID zeigt, dass in der Liga die gemeldete weiter gilt", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const user = {
        id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player", email: "mila@example.test", updated_at: "2026-10-01T10:00:00+00:00",
        game_ids: { "probe-hauptspiel": { activision_id: "TestloeweMila#1234567" } },
      };
      await mock(page, (path, request) => {
        if (path === "/games") return [{ id: "g1", slug: "probe-shooter", name: "Probe Shooter", identity_game_slug: "probe-hauptspiel", identity_game_name: "Probe Hauptspiel", effective_player_id_fields: [{ ...FIELDS[0], required: true }] }];
        if (path === "/me/league-ids") return { items: [{ season_id: "s1", title: "Probe-Liga · Season 1", state: "locked", ok: true, text: "TestloeweMila#1234567", changed: false, locked: { activision_id: "TestloeweMila#1234567" }, fields: FIELDS, identity_slug: "probe-hauptspiel", game_slug: "probe-shooter" }] };
        if (path === "/users/me" && request.method() === "PATCH") return { ...user, ...(request.postDataJSON() || {}) };
        if (path === "/me/platform-links") return { links: [], available: {}, platforms: {} };
        return undefined;
      }, user);
      await page.goto("/profile?tab=gaming");
      const notice = page.getByTestId("profile-league-id-s1");
      await expect(notice).toHaveAttribute("data-tone", "info");
      await page.getByTestId("profile-game-id-probe-hauptspiel-activision_id").fill("MilaNeu#7654321");
      await expect(notice).toHaveAttribute("data-tone", "warn");
      await expect(notice).toContainText("In der laufenden Liga (Probe-Liga · Season 1) gilt weiter TestloeweMila#1234567");
      await noSideScroll(page);
    });

    test("Season-Seite: Kader und Spiel-IDs mit Freigabe", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page, (path) => {
        if (path === "/admin/leagues/seasons/s1/roster") return ROSTER_PAGE;
        if (path === "/admin/leagues/seasons/s1") return SEASON_PAGE;
        return undefined;
      }, ADMIN);
      await page.goto("/admin/leagues/seasons/s1");
      await expect(page.getByTestId("season-roster-counts")).toContainText("1 ohne ID · 1 warten auf Freigabe · 1 mit neuer ID im Profil");
      await expect(page.getByTestId("roster-changed-u1")).toContainText("MilaNeuMitLangerKennung#7654321");
      await page.getByTestId("roster-approve-u1").click();
      await expect(page.getByTestId("roster-approve-form-u1")).toBeVisible();
      await expect(page.getByTestId("roster-approve-u3")).toHaveText("ID freigeben");
      await noSideScroll(page);
    });
  });
}
