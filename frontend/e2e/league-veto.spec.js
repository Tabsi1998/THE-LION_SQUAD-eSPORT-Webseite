const { test, expect } = require("@playwright/test");

// Liga-Veto (#1618, docs/LIGA.md D.3) bei 390 und 1440 px mit nachgestellter API: der Kasten „Veto“ im Reiter Spielbetrieb (Vorschlag,
// Prüfung live, Speichern) und die Matchseite im Veto (am Zug mit Countdown und Wahl, Gegenseite wartet, Leitung pausiert, fertig mit
// Spielreihenfolge). Kein seitlicher Überlauf. Erfundene Namen.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" };
const LEAD = { id: "lead", username: "leitung", display_name: "Liga Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 3, remind_minutes_before_close: 5 };
const SIDES = ["Loewen mit sehr langem Namen · Rudel Alpha", "Falken mit sehr langem Namen · Horst"];
const inSeconds = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const inMinutes = (minutes) => inSeconds(minutes * 60);
const MAP = (id, name) => ({ map_id: id, name, image_url: null });
const OWN = { registration_id: "a", name: SIDES[0], own: true, checked_in: true, at: inMinutes(-2), present: [{ id: "u1", name: "Mila" }, { id: "u2", name: "Tom" }, { id: "u3", name: "Ida" }], present_count: 3, consent_open: false };
const OTHER = { registration_id: "b", name: SIDES[1], own: false, checked_in: true, at: inMinutes(-3), present: [{ id: "f1", name: "Falke Eins" }, { id: "f2", name: "Falke Zwei" }, { id: "f3", name: "Falke Drei" }], present_count: 3, consent_open: false };
const REMAINING = [
  { mode: "hp", label: "Stellung", maps: [{ ...MAP("hafen", "Hafenkante"), status: "banned", by_name: SIDES[1] }, { ...MAP("nebel", "Nebelwerk"), status: "open" }, { ...MAP("turm", "Funkturm"), status: "open" }, { ...MAP("glut", "Glutsenke"), status: "open" }] },
  { mode: "snd", label: "Suchen & Zerstören", maps: [MAP("nebel", "Nebelwerk"), MAP("turm", "Funkturm"), MAP("kai", "Kaimauer"), MAP("werk", "Kieswerk")].map((row) => ({ ...row, status: "open" })) },
  { mode: "ctl", label: "Kontrolle", maps: [MAP("hafen", "Hafenkante"), MAP("kai", "Kaimauer"), MAP("ruine", "Ruine")].map((row) => ({ ...row, status: "open" })) },
];
const HISTORY = [{ index: 0, kind: "ban", mode_label: "Stellung", name: SIDES[1], map_name: "Hafenkante", position: null, via: "side", at: inMinutes(-1) }];
const CURRENT = { index: 1, number: 2, total: 11, kind: "ban", mode: "hp", mode_label: "Stellung", registration_id: "a", name: SIDES[0], position: null, deadline_at: inSeconds(42), remaining_seconds: 42 };
const RUNNING = {
  status: "running", skipped_reason: null, version: 2, step_seconds: 60,
  team_a: { registration_id: "b", name: SIDES[1], via: "draw" }, team_b: { registration_id: "a", name: SIDES[0] },
  current: CURRENT, own_turn: true, can_pick: true, pick_hint: null,
  options: [{ ...MAP("hafen", "Hafenkante"), allowed: false, hint: "Hafenkante ist in diesem Modus schon gesperrt oder gewählt." }, { ...MAP("nebel", "Nebelwerk"), allowed: true, hint: null },
    { ...MAP("turm", "Funkturm"), allowed: true, hint: null }, { ...MAP("glut", "Glutsenke"), allowed: true, hint: null }],
  remaining: REMAINING, history: HISTORY, planned_games: [], paused: null, lead: null,
};
const PLANNED = [
  { position: 1, mode: "hp", mode_label: "Stellung", map_id: "nebel", map_name: "Nebelwerk", map_image_url: null, role: "picked", by_registration_id: "a" },
  { position: 2, mode: "snd", mode_label: "Suchen & Zerstören", map_id: "kai", map_name: "Kaimauer", map_image_url: null, role: "picked", by_registration_id: "b" },
  { position: 3, mode: "ctl", mode_label: "Kontrolle", map_id: "ruine", map_name: "Ruine", map_image_url: null, role: "decider", by_registration_id: null },
  { position: 4, mode: "hp", mode_label: "Stellung", map_id: "turm", map_name: "Funkturm", map_image_url: null, role: "picked", by_registration_id: "b" },
  { position: 5, mode: "snd", mode_label: "Suchen & Zerstören", map_id: "werk", map_name: "Kieswerk", map_image_url: null, role: "picked", by_registration_id: "a" },
];
const CHECKIN = {
  rules: RULES, state: "veto", scheduled_at: inMinutes(5), window: { opens_at: inMinutes(-10), closes_at: inMinutes(20) }, ready_at: inMinutes(-1), started_at: null,
  sides: [OWN, OTHER], own_registration_id: "a", can_checkin: true, checkin_hint: null, roster: [], min_present: 3, can_start: false,
  start_hint: "Erst das Veto abschließen, dann starten.", proposal: null, lead: null, veto: RUNNING,
};
const PAGE = {
  tournament: { id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0] }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1] }],
  matchday_label: "Spieltag 2", collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false,
  can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  acting_registration_id: "a", report_state: null, schedule_proposals: [], schedule_block: null,
  match: { id: "m1", match_key: "L2", status: "scheduled", schedule_status: "accepted", schedule_source: "accepted", scheduled_at: inMinutes(5),
    slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  checkin: CHECKIN,
};

// Season-Seite (Reiter Spielbetrieb) - Minimum, damit der Kasten „Veto“ lädt.
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [{ mode: "hp", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }, { mode: "ctl", label: "Kontrolle" }] };
const POOL = { id: "p1", version: 2, origin: "league_season", saved_at: "2026-11-02T10:00:00Z", stale: false, outdated_map_ids: [], outdated_modes: [],
  modes: [{ mode: "hp", label: "Stellung", maps: [MAP("hafen", "Hafenkante"), MAP("nebel", "Nebelwerk"), MAP("turm", "Funkturm"), MAP("glut", "Glutsenke")] },
    { mode: "snd", label: "Suchen & Zerstören", maps: [MAP("nebel", "Nebelwerk"), MAP("turm", "Funkturm"), MAP("kai", "Kaimauer"), MAP("werk", "Kieswerk")] },
    { mode: "ctl", label: "Kontrolle", maps: [MAP("hafen", "Hafenkante"), MAP("kai", "Kaimauer"), MAP("ruine", "Ruine")] }] };
const SEASON = { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
  default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 5, team_size: 4, min_squad_size: 4, max_squad_size: 50,
  game_mode_order: ["hp", "snd", "ctl", "hp", "snd"], map_repeat: "other_mode", scoring_rules: { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head"] },
  result_confirm_hours: 48, lineup_amend_hours: 48, match_schedule_response_hours: 72, rules_text: "", visibility: "admins", status: "draft", blocked_periods: [], updated_at: "2026-11-02T10:00:00Z" };
const SEASON_PAGE = { league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON, game: GAME, calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8 },
  library: [], map_pool: POOL, default_pool: null, look: { emblem_url: null }, divisions: [] };
const MODES = GAME.modes.map((row) => ({ ...row, maps: POOL.modes.find((group) => group.mode === row.mode).maps.length }));
const step = (kind, mode, team, position = null) => ({ kind, mode, team, position });
const ANLAGE_B = [
  step("ban", "hp", "A"), step("ban", "hp", "B"), step("pick", "hp", "A", 1), step("pick", "hp", "B", 4),
  step("ban", "snd", "B"), step("ban", "snd", "A"), step("pick", "snd", "B", 2), step("pick", "snd", "A", 5),
  step("ban", "ctl", "A"), step("ban", "ctl", "B"), step("decider", "ctl", null, 3),
];
const VETO_RULES = { veto_rules: { enabled: false, team_a: "home", step_seconds: 60, steps: [] }, active: false, defaults: { enabled: false, team_a: "home", step_seconds: 60, steps: [] },
  problems: [], modes: MODES, best_of: 5, game_mode_order: SEASON.game_mode_order, map_repeat: "other_mode", has_checkin: true, staffeln: 1 };

async function setup(page, user, { matchPage = PAGE, posts = [], puts = [] } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/changes")) return route.abort();
    if (path === "/api/auth/me") return route.fulfill(json(user));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/leagues") return route.fulfill(json({ leagues: [] }));
    if (path === "/api/matches/m1/page") return route.fulfill(json(matchPage));
    if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
    if (path === "/api/admin/leagues/seasons/s1") return route.fulfill(json(SEASON_PAGE));
    if (path === "/api/admin/leagues/seasons/s1/readiness") return route.fulfill(json({ ok: true, problems: [], warnings: [], requirements: [], max_maps: 5, superadmin: true }));
    if (path === "/api/admin/leagues/seasons/s1/result-rules") return route.fulfill(json({ scores_required: true, staffeln: 1, rules: [] }));
    if (path === "/api/admin/leagues/seasons/s1/veto-rules/proposal") return route.fulfill(json({ steps: ANLAGE_B, problems: [] }));
    if (path === "/api/admin/leagues/seasons/s1/veto-rules" && request.method() === "PUT") {
      puts.push(request.postDataJSON());
      return route.fulfill(json({ ...VETO_RULES, veto_rules: request.postDataJSON(), active: true, staffeln_updated: 1 }));
    }
    if (path === "/api/admin/leagues/seasons/s1/veto-rules") return route.fulfill(json(VETO_RULES));
    if (path === "/api/admin/league-rules/league_season/s1") return route.fulfill(json({ current: null, inherited: null, versions: [], draft: null, data_changes: null }));
    if (path === "/api/friends") return route.fulfill(json({ incoming: [], friends: [], outgoing: [] }));
    if (request.method() !== "GET") {
      posts.push({ path, method: request.method(), body: request.postDataJSON() });
      return route.fulfill(json({ version: 3, step: 2, status: "running", idempotent_replay: false }));
    }
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Liga: Veto", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Verwaltung: Vorschlag, Prüfung live, Speichern bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const puts = [];
      await setup(page, LEAD, { puts });
      await page.goto("/admin/leagues/seasons/s1#veto");
      await expect(page.getByTestId("season-tab-spielbetrieb")).toHaveAttribute("aria-selected", "true");
      const panel = page.getByTestId("season-veto-rules");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("veto-rules-empty")).toBeVisible();
      await page.getByTestId("veto-rules-propose").click();
      await expect(page.getByTestId("veto-rules-steps").locator("li")).toHaveCount(11);
      await expect(page.getByTestId("veto-step-10-sentence")).toHaveText("Die übrige Map wird Map 3 (Kontrolle)");
      await expect(page.getByTestId("veto-rules-ok")).toBeVisible();
      await page.getByTestId("veto-step-3-position").fill("1");
      await expect(page.getByTestId("veto-rules-problems")).toContainText("Position 1 ist mehrfach belegt (Schritt 3 und 4).");
      await expect(page.getByTestId("veto-rules-save")).toBeDisabled();
      await page.getByTestId("veto-step-3-position").fill("4");
      await expect(page.getByTestId("veto-rules-problems")).toHaveCount(0);
      await expectNoSideScroll(page);
      await panel.scrollIntoViewIfNeeded();
      await testInfo.attach(`veto-verwaltung-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByTestId("veto-rules-save").click();
      await expect.poll(() => puts.length).toBe(1);
      expect(puts[0]).toEqual({ enabled: true, team_a: "home", step_seconds: 60, steps: ANLAGE_B });
    });

    test(`Matchseite: am Zug mit Countdown, Wahl geht an den Server; Gegenseite wartet bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      await setup(page, CAPTAIN, { posts });
      await page.goto("/matches/m1");
      // Nur eine Überschrift „Veto läuft“: der Check-in-Kopf wird schlank (Fabian: übersichtlich).
      await expect(page.getByTestId("checkin-headline")).toHaveCount(0);
      await expect(page.getByTestId("checkin-slim")).toContainText("Beide Seiten eingecheckt");
      await expect(page.getByText("Veto läuft", { exact: true })).toHaveCount(1);
      await expect(page.getByTestId("checkin-start")).toHaveCount(0);
      await expect(page.getByTestId("veto-headline")).toHaveText("Veto läuft");
      await expect(page.getByTestId("veto-text")).toContainText("Ihr seid am Zug: sperrt eine Map (Stellung)");
      await expect(page.getByTestId("veto-step")).toContainText("Schritt 2 von 11");
      await expect(page.getByTestId("veto-countdown-text")).toHaveText(/^\d+:\d\d$/);
      await expect(page.getByTestId("veto-map-hp-hafen")).toHaveAttribute("data-status", "banned");
      await expect(page.getByTestId("veto-option-hafen")).toBeDisabled();
      await expect(page.getByTestId("veto-history-0")).toContainText("sperrt Hafenkante (Stellung)");
      await expectNoSideScroll(page);
      await testInfo.attach(`veto-am-zug-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByTestId("veto-option-glut").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/veto/pick")?.body).toEqual({ map_id: "glut", version: 2 });

      await page.unrouteAll({ behavior: "ignoreErrors" });
      const waiting = { ...RUNNING, current: { ...CURRENT, registration_id: "b", name: SIDES[1] }, own_turn: false, can_pick: false, pick_hint: `Jetzt ist ${SIDES[1]} am Zug.` };
      await setup(page, CAPTAIN, { matchPage: { ...PAGE, checkin: { ...CHECKIN, veto: waiting } } });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("veto-panel")).toHaveAttribute("data-own-turn", "false");
      await expect(page.getByTestId("veto-wait")).toContainText("am Zug");
      await expect(page.getByTestId("veto-own")).toHaveCount(0);
      await expectNoSideScroll(page);
      await testInfo.attach(`veto-wartet-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    test(`Leitung pausiert mit Grund; fertig mit Spielreihenfolge und Start bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      const asLead = { ...RUNNING, own_turn: false, can_pick: false, pick_hint: `Jetzt ist ${SIDES[0]} am Zug.`, lead: { can_act: true, conflict: null } };
      await setup(page, LEAD, { posts, matchPage: { ...PAGE, acting_registration_id: null, checkin: { ...CHECKIN, own_registration_id: null, sides: [{ ...OWN, own: false }, OTHER], veto: asLead, lead: { can_enter: false, conflict: null, rosters: {} } } } });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("veto-lead")).toBeVisible();
      await page.getByTestId("veto-lead-pause").click();
      await expect(page.getByTestId("veto-lead-problem")).toContainText("Grund");
      await page.getByTestId("veto-lead-reason").fill("Technische Störung bei einem Team");
      await page.getByTestId("veto-lead-pause").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/veto/lead")?.body).toEqual({ action: "pause", reason: "Technische Störung bei einem Team", version: 2 });
      await expectNoSideScroll(page);
      await testInfo.attach(`veto-leitung-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

      await page.unrouteAll({ behavior: "ignoreErrors" });
      const done = { ...RUNNING, status: "done", current: null, own_turn: false, can_pick: false, pick_hint: "Das Veto ist abgeschlossen.", options: [], planned_games: PLANNED,
        history: [...HISTORY, { index: 10, kind: "decider", mode_label: "Kontrolle", name: null, map_name: "Ruine", position: 3, via: "auto", at: inMinutes(-1) }] };
      await setup(page, CAPTAIN, { matchPage: { ...PAGE, checkin: { ...CHECKIN, state: "ready", can_start: true, start_hint: null, veto: done } } });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-headline")).toHaveText("Spielbereit");
      await expect(page.getByTestId("veto-headline")).toHaveText("Spielreihenfolge steht");
      await expect(page.getByTestId("veto-planned").locator("li")).toHaveCount(5);
      await expect(page.getByTestId("veto-planned-3")).toContainText("Decider");
      await expect(page.getByTestId("veto-planned-3")).toContainText("Ruine");
      await expect(page.getByTestId("checkin-start-button")).toBeVisible();
      await expectNoSideScroll(page);
      await testInfo.attach(`veto-fertig-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
});
