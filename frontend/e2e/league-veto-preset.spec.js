const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

// Veto-Schrittart „Vorgabe der Woche“ (#2326, docs/LIGA.md D.3) bei 390 und 1440 px mit nachgestellter API: im Kasten „Veto“ der Season
// die Map je Spielwoche (fehlende Wochen, „Rotiert automatisch durch den Pool“, Speichern) und auf der Matchseite das Veto mit Vorgabe
// (fest im Brett, nicht antippbar, an ihrer Position in der Spielreihenfolge) sowie der Satz, solange die Vorgabe fehlt. Kein seitlicher
// Überlauf. Erfundene Namen. Mit SHOT_DIR landen die Bilder zusätzlich in diesem Ordner.

const SHOTS = process.env.SHOT_DIR || "";
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
const open = (row) => ({ ...row, status: "open", by_name: null, position: null });
const REMAINING = [
  { mode: "hp", label: "Stellung", maps: [MAP("hafen", "Hafenkante"), MAP("nebel", "Nebelwerk"), MAP("turm", "Funkturm"), MAP("glut", "Glutsenke")].map(open) },
  { mode: "snd", label: "Suchen & Zerstören", maps: [MAP("nebel", "Nebelwerk"), MAP("turm", "Funkturm"), MAP("kai", "Kaimauer"), MAP("werk", "Kieswerk")].map(open) },
  { mode: "ctl", label: "Kontrolle", maps: [open(MAP("hafen", "Hafenkante")), { ...MAP("kai", "Kaimauer"), status: "preset", by_name: null, position: 3 }, open(MAP("ruine", "Ruine"))] },
];
const PRESETS = [{ mode: "ctl", mode_label: "Kontrolle", position: 3, map_id: "kai", map_name: "Kaimauer", map_image_url: null }];
const CURRENT = { index: 8, number: 9, total: 10, kind: "ban", mode: "ctl", mode_label: "Kontrolle", registration_id: "a", name: SIDES[0], position: null, deadline_at: inSeconds(42), remaining_seconds: 42 };
const RUNNING = {
  status: "running", skipped_reason: null, version: 9, step_seconds: 60,
  team_a: { registration_id: "a", name: SIDES[0], via: "home" }, team_b: { registration_id: "b", name: SIDES[1] },
  current: CURRENT, own_turn: true, can_pick: true, pick_hint: null,
  options: [{ ...MAP("hafen", "Hafenkante"), allowed: true, hint: null },
    { ...MAP("kai", "Kaimauer"), allowed: false, hint: "Kaimauer ist die Vorgabe der Woche – weder sperrbar noch wählbar." }, { ...MAP("ruine", "Ruine"), allowed: true, hint: null }],
  remaining: REMAINING, history: [], planned_games: [], paused: null, lead: null, week: 2, presets: PRESETS, blocked: null,
};
const BLOCKED_TEXT = "Für Spielwoche 2 steht die Vorgabe der Woche noch nicht – Kontrolle: Die Vorgabe der Woche fehlt. Das Veto beginnt erst, wenn die Liga-Leitung sie eingetragen hat.";
const BLOCKED = {
  status: "waiting", skipped_reason: null, version: 0, step_seconds: null, team_a: null, team_b: null, current: null, own_turn: false, can_pick: false,
  pick_hint: BLOCKED_TEXT, options: [], remaining: [], history: [], planned_games: [], paused: null, lead: null, week: 2, presets: [], blocked: { week: 2, text: BLOCKED_TEXT },
};
const START_READY = "Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben. Vorher läuft keine Zeit.";
const OTHER_CAPTAIN = { id: "f1", username: "falke", display_name: "Falke Eins", role: "player" };
const PLANNED = [
  { position: 1, mode: "hp", mode_label: "Stellung", map_id: "nebel", map_name: "Nebelwerk", map_image_url: null, role: "picked", by_registration_id: "a" },
  { position: 2, mode: "snd", mode_label: "Suchen & Zerstören", map_id: "turm", map_name: "Funkturm", map_image_url: null, role: "picked", by_registration_id: "b" },
  { position: 3, mode: "ctl", mode_label: "Kontrolle", map_id: "kai", map_name: "Kaimauer", map_image_url: null, role: "preset", by_registration_id: null },
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

// Season-Seite (Reiter Spielbetrieb) - Minimum, damit der Kasten „Veto“ mit der Vorgabe der Woche lädt.
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
const WITH_PRESET = [
  step("ban", "hp", "A"), step("ban", "hp", "B"), step("pick", "hp", "A", 1), step("pick", "hp", "B", 4),
  step("ban", "snd", "B"), step("ban", "snd", "A"), step("pick", "snd", "B", 2), step("pick", "snd", "A", 5),
  step("ban", "ctl", "A"), step("preset", "ctl", null, 3),
];
const DEFAULTS = { enabled: false, team_a: "home", step_seconds: 60, steps: [] };
const VETO_RULES = { veto_rules: { enabled: true, team_a: "home", step_seconds: 60, steps: WITH_PRESET }, active: true, defaults: DEFAULTS,
  problems: [], modes: MODES, best_of: 5, game_mode_order: SEASON.game_mode_order, map_repeat: "other_mode", has_checkin: true, staffeln: 1 };
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const WEEKS = Array.from({ length: 7 }, (_, index) => ({ week: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6) }));
const CTL_MAPS = POOL.modes[2].maps.map(({ map_id, name }) => ({ map_id, name }));
const preset = (week, mapId) => ({ week, mode: "ctl", map_id: mapId });
const ROTATION = WEEKS.map(({ week }) => preset(week, CTL_MAPS[(week - 1) % CTL_MAPS.length].map_id));
const missing = (weeks) => weeks.map((week) => ({ week, problems: ["Kontrolle: Die Vorgabe der Woche fehlt."] }));
const VETO_PRESETS = {
  active: true, weeks: WEEKS, modes: [{ mode: "ctl", label: "Kontrolle", position: 3, maps: CTL_MAPS }], presets: [preset(1, "kai")],
  problems: missing([2, 3, 4, 5, 6, 7]), rotation: ROTATION,
  history: [{ at: "2026-11-10T18:30:00+00:00", by_name: "Liga Leitung", changes: [{ week: 1, mode: "ctl", from: null, to: "kai" }] }],
};

// `matchPage` darf eine Funktion sein (der Stand ändert sich im Test), `handle(url, method, body)` beantwortet eigene Aufrufe vorab.
async function setup(page, user, { matchPage = PAGE, posts = [], puts = [], handle = null } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    if (url.startsWith("/api/changes")) return route.abort();
    if (url === "/api/auth/me") return route.fulfill(json(user));
    if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (url === "/api/leagues") return route.fulfill(json({ leagues: [] }));
    const own = handle ? handle(url, request.method(), request.method() === "GET" ? null : request.postDataJSON()) : undefined;
    if (own !== undefined) return route.fulfill(json(own));
    if (url === "/api/matches/m1/page") return route.fulfill(json(typeof matchPage === "function" ? matchPage() : matchPage));
    if (url === "/api/matches/m1/chat") return route.fulfill(json([]));
    if (url === "/api/admin/leagues/seasons/s1") return route.fulfill(json(SEASON_PAGE));
    if (url === "/api/admin/leagues/seasons/s1/readiness") return route.fulfill(json({ ok: true, problems: [], warnings: [], requirements: [], max_maps: 5, superadmin: true }));
    if (url === "/api/admin/leagues/seasons/s1/result-rules") return route.fulfill(json({ scores_required: true, staffeln: 1, rules: [] }));
    if (url === "/api/admin/leagues/seasons/s1/veto-rules") return route.fulfill(json(VETO_RULES));
    if (url === "/api/admin/leagues/seasons/s1/veto-presets" && request.method() === "PUT") {
      const saved = request.postDataJSON().presets;
      puts.push(saved);
      return route.fulfill(json({ ...VETO_PRESETS, presets: saved, problems: [], changed: saved.length, matches_ready: 1 }));
    }
    if (url === "/api/admin/leagues/seasons/s1/veto-presets") return route.fulfill(json(VETO_PRESETS));
    if (url === "/api/admin/league-rules/league_season/s1") return route.fulfill(json({ current: null, inherited: null, versions: [], draft: null, data_changes: null }));
    if (url === "/api/friends") return route.fulfill(json({ incoming: [], friends: [], outgoing: [] }));
    if (request.method() !== "GET") {
      posts.push({ path: url, method: request.method(), body: request.postDataJSON() });
      return route.fulfill(json({ version: 10, step: 10, status: "done", idempotent_replay: false }));
    }
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

// Das Bild eines Blocks: Für die Aufnahme wird das Fenster so hoch wie die Seite - so liegen die mitlaufende Kopfzeile und die Leiste
// unten nicht quer über einem hohen Block. Danach hat das Fenster wieder seine Größe.
async function shot(page, testInfo, name, locator) {
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.min(Math.max(height, size.height), 8000) });
  await page.evaluate(() => window.scrollTo(0, 0));
  const clip = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: rect.width, height: rect.height };
  });
  const body = await page.screenshot({ clip });
  await page.setViewportSize(size);
  await testInfo.attach(`${name}.png`, { body, contentType: "image/png" });
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), body);
  }
}

test.describe("Liga: Veto mit Vorgabe der Woche", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Verwaltung: Map je Spielwoche, fehlende Wochen, Rotation und Speichern bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const puts = [];
      await setup(page, LEAD, { puts });
      await page.goto("/admin/leagues/seasons/s1#veto");
      await expect(page.getByTestId("season-tab-spielbetrieb")).toHaveAttribute("aria-selected", "true");
      // Die Schrittart steht in der Vorlage wie Sperren, Wählen und Decider - ohne Team, mit Position.
      await expect(page.getByTestId("veto-step-9-kind")).toHaveValue("preset");
      await expect(page.getByTestId("veto-step-9-sentence")).toHaveText("Die Liga-Leitung gibt Map 3 je Spielwoche vor (Kontrolle)");
      await expect(page.getByTestId("veto-step-9-team")).toHaveCount(0);
      await expect(page.getByTestId("veto-rules-ok")).toBeVisible();
      // Die Vorgaben stehen im selben Kasten - nicht unten an der Seite.
      const box = page.getByTestId("season-veto-rules").getByTestId("veto-presets-box");
      await expect(box).toBeVisible();
      await expect(page.getByTestId("veto-presets-weeks").locator("> li")).toHaveCount(7);
      await expect(page.getByTestId("veto-preset-week-1")).toContainText("10.11.–16.11.");
      await expect(page.getByTestId("veto-preset-1-ctl")).toHaveValue("kai");
      await expect(page.getByTestId("veto-presets-missing")).toHaveText("Es fehlen noch: Spielwoche 2, 3, 4, 5, 6 und 7.");
      await expect(page.getByTestId("veto-preset-week-2")).toHaveAttribute("data-missing", "true");
      await expect(page.getByTestId("veto-presets-save")).toBeDisabled();
      await expectNoSideScroll(page);
      await box.scrollIntoViewIfNeeded();
      await shot(page, testInfo, `vorgaben-verwaltung-fehlend-${width}`, box);

      await page.getByTestId("veto-presets-rotate").click();
      await expect(page.getByTestId("veto-presets-missing")).toHaveCount(0);
      await expect(page.getByTestId("veto-presets-complete")).toBeVisible();
      await expect(page.getByTestId("veto-preset-1-ctl")).toHaveValue("hafen");
      await expect(page.getByTestId("veto-preset-7-ctl")).toHaveValue("hafen");
      // Danach einzeln änderbar.
      await page.getByTestId("veto-preset-2-ctl").selectOption("ruine");
      await expect(page.getByTestId("veto-presets-dirty")).toBeVisible();
      await page.getByTestId("veto-presets-history").locator("summary").click();
      await expect(page.getByTestId("veto-presets-history-entry")).toContainText("Spielwoche 1 · Kontrolle: – → Kaimauer");
      await expectNoSideScroll(page);
      // Die Auswahl darf am Handy nicht über den Rand der Zeile ragen.
      const [row, select] = await Promise.all([page.getByTestId("veto-preset-week-2").boundingBox(), page.getByTestId("veto-preset-2-ctl").boundingBox()]);
      expect(select.x + select.width).toBeLessThanOrEqual(row.x + row.width + 1);
      // Die Meldung zum Vorschlag ist weg, bevor das Bild entsteht - sie läge sonst über dem Knopf.
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
      await shot(page, testInfo, `vorgaben-verwaltung-${width}`, box);
      await page.getByTestId("veto-presets-save").click();
      await expect.poll(() => puts.length).toBe(1);
      expect(puts[0]).toEqual(ROTATION.map((row) => (row.week === 2 ? preset(2, "ruine") : row)));
      await expect(page.getByTestId("veto-presets-dirty")).toHaveCount(0);
    });

    test(`Matchseite: Veto mit Vorgabe - fest im Brett, nicht antippbar, in der Spielreihenfolge bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      await setup(page, CAPTAIN, { posts });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("veto-headline")).toHaveText("Veto läuft");
      await expect(page.getByTestId("veto-presets")).toContainText("Vorgabe der Woche · Spielwoche 2");
      await expect(page.getByTestId("veto-preset-ctl")).toContainText("Kaimauer");
      await expect(page.getByTestId("veto-preset-ctl")).toContainText("Kontrolle · Map 3");
      await expect(page.getByTestId("veto-map-ctl-kai")).toHaveAttribute("data-status", "preset");
      await expect(page.getByTestId("veto-map-ctl-kai")).toContainText("Map 3 · Vorgabe der Woche");
      await expect(page.getByTestId("veto-option-kai")).toBeDisabled();
      await expect(page.getByTestId("veto-option-hafen")).toBeEnabled();
      await expectNoSideScroll(page);
      await shot(page, testInfo, `veto-mit-vorgabe-${width}`, page.getByTestId("checkin-panel"));
      await page.getByTestId("veto-option-ruine").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/veto/pick")?.body).toEqual({ map_id: "ruine", version: 9 });

      await page.unrouteAll({ behavior: "ignoreErrors" });
      const done = { ...RUNNING, status: "done", current: null, own_turn: false, can_pick: false, pick_hint: "Das Veto ist abgeschlossen.", options: [], planned_games: PLANNED,
        history: [{ index: 9, kind: "preset", mode_label: "Kontrolle", name: null, map_name: "Kaimauer", position: 3, via: "auto", at: inMinutes(-1) }] };
      await setup(page, CAPTAIN, { matchPage: { ...PAGE, checkin: { ...CHECKIN, state: "ready", can_start: true, start_hint: null, veto: done } } });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("veto-headline")).toHaveText("Spielreihenfolge steht");
      await expect(page.getByTestId("veto-planned-3")).toContainText("Map 3 · Vorgabe der Woche");
      await expect(page.getByTestId("veto-planned-3")).toContainText("Kaimauer");
      await page.getByTestId("veto-history").locator("summary").click();
      await expect(page.getByTestId("veto-history-9")).toHaveText("10. Vorgabe der Woche: Kaimauer → Map 3 (Kontrolle)");
      await expect(page.getByTestId("checkin-start-button")).toBeVisible();
      await expectNoSideScroll(page);
      await shot(page, testInfo, `veto-mit-vorgabe-fertig-${width}`, page.getByTestId("checkin-panel"));
    });

    test(`Matchseite: fehlt die Vorgabe, wartet das Veto mit klarem Satz bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await setup(page, CAPTAIN, { matchPage: { ...PAGE, checkin: { ...CHECKIN, start_hint: BLOCKED_TEXT, veto: BLOCKED } } });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-slim")).toContainText("Beide Seiten eingecheckt");
      await expect(page.getByTestId("veto-panel")).toHaveAttribute("data-blocked", "true");
      await expect(page.getByTestId("veto-headline")).toHaveText("Veto wartet auf die Vorgabe der Woche");
      await expect(page.getByTestId("veto-text")).toHaveText(BLOCKED_TEXT);
      await expect(page.getByTestId("veto-blocked")).toContainText("Gewertet wird nichts von selbst.");
      await expect(page.getByTestId("veto-own")).toHaveCount(0);
      await expect(page.getByTestId("checkin-start-button")).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, testInfo, `veto-vorgabe-fehlt-${width}`, page.getByTestId("checkin-panel"));
    });

    test(`Matchseite: nachgetragene Vorgabe - zwei Seiten tippen „Bereit zum Veto“, erst dann beginnt es bei ${width} px`, async ({ page, browser }, testInfo) => {
      // Ein Spiel, zwei Konten: der Captain der Heimseite und der Captain der Gegenseite, je in einem eigenen Fenster. Beide lesen
      // denselben nachgestellten Stand - wer „Bereit“ tippt, ändert ihn für beide.
      const state = { ready: { a: false, b: false }, posts: [] };
      const sideView = (own) => {
        const other = own === "a" ? "b" : "a";
        const started = state.ready.a && state.ready.b;
        const sides = [{ ...OWN, own: own === "a" }, { ...OTHER, own: own === "b" }];
        if (started) {
          const running = { ...RUNNING, own_turn: own === "a", can_pick: own === "a", pick_hint: own === "a" ? null : `Jetzt ist ${SIDES[0]} am Zug.`, start: null };
          return { ...PAGE, acting_registration_id: own, checkin: { ...CHECKIN, sides, own_registration_id: own, veto: running } };
        }
        const start = {
          sides: [{ registration_id: "a", name: SIDES[0], ready: state.ready.a, own: own === "a" }, { registration_id: "b", name: SIDES[1], ready: state.ready.b, own: own === "b" }],
          own_ready: state.ready[own], other_ready: state.ready[other], can_ready: !state.ready[own], can_withdraw: state.ready[own] && !state.ready[other],
          hint: START_READY, lead: null,
        };
        const waiting = { ...BLOCKED, step_seconds: 60, presets: PRESETS, blocked: null, pick_hint: START_READY, start };
        return { ...PAGE, acting_registration_id: own, checkin: { ...CHECKIN, sides, own_registration_id: own, start_hint: START_READY, veto: waiting } };
      };
      const serve = (own) => ({
        matchPage: () => sideView(own),
        handle: (url, method, body) => {
          if (url !== "/api/matches/m1/veto/ready" || method !== "POST") return undefined;
          state.posts.push({ side: own, body });
          state.ready[own] = Boolean(body.ready);
          const started = state.ready.a && state.ready.b;
          return { started, status: started ? "running" : null, version: started ? 1 : null, idempotent_replay: false, ready: state.ready[own] };
        },
      });
      await page.setViewportSize({ width, height: 1000 });
      await setup(page, CAPTAIN, serve("a"));
      const context = await browser.newContext({ viewport: { width, height: 1000 }, baseURL: testInfo.project.use.baseURL });
      const guest = await context.newPage();
      await setup(guest, OTHER_CAPTAIN, serve("b"));

      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-slim")).toContainText("Beide Seiten eingecheckt");
      await expect(page.getByTestId("veto-panel")).toHaveAttribute("data-start-ready", "true");
      await expect(page.getByTestId("veto-headline")).toHaveText("Vorgabe steht – bereit zum Veto?");
      await expect(page.getByTestId("veto-text")).toContainText("Das Veto beginnt, wenn beide Seiten bereit sind.");
      await expect(page.getByTestId("veto-preset-ctl")).toContainText("Kaimauer");
      await expect(page.getByTestId("veto-ready-note")).toContainText("bis dahin gibt es keine Frist");
      // Kein Countdown, kein Brett, kein „Spiel starten“ - erst das Veto.
      await expect(page.getByTestId("veto-countdown")).toHaveCount(0);
      await expect(page.getByTestId("veto-board")).toHaveCount(0);
      await expect(page.getByTestId("checkin-start-button")).toHaveCount(0);
      await expectNoSideScroll(page);

      // Die Heimseite ist bereit: Sie wartet, kann zurücknehmen - nichts beginnt.
      await page.getByTestId("veto-ready-button").click();
      await expect(page.getByTestId("veto-text")).toHaveText("Ihr seid bereit – wartet auf die Gegenseite.");
      await expect(page.getByTestId("veto-ready-side-a")).toHaveAttribute("data-ready", "true");
      await expect(page.getByTestId("veto-ready-side-b")).toHaveAttribute("data-ready", "false");
      await expect(page.getByTestId("veto-ready-withdraw")).toBeVisible();
      await expect(page.getByTestId("veto-headline")).toHaveText("Vorgabe steht – bereit zum Veto?");
      await expectNoSideScroll(page);
      await shot(page, testInfo, `veto-bereit-wartet-${width}`, page.getByTestId("checkin-panel"));

      // Die Gegenseite sieht es in ihrem Fenster und tippt selbst - jetzt beginnt das Veto, für beide.
      await guest.goto("/matches/m1");
      await expect(guest.getByTestId("veto-text")).toContainText(`${SIDES[0]} ist bereit – tippt auf „Bereit zum Veto“, dann beginnt es sofort.`);
      await expect(guest.getByTestId("veto-ready-side-a")).toHaveAttribute("data-ready", "true");
      await expect(guest.getByTestId("veto-ready-withdraw")).toHaveCount(0);
      await expectNoSideScroll(guest);
      await shot(guest, testInfo, `veto-bereit-gegenseite-${width}`, guest.getByTestId("checkin-panel"));
      await guest.getByTestId("veto-ready-button").click();
      await expect(guest.getByTestId("veto-headline")).toHaveText("Veto läuft");
      // Die Heimseite hat nichts getippt: Ihr Fenster fragt nach und zeigt das laufende Veto von selbst.
      await expect(page.getByTestId("veto-headline")).toHaveText("Veto läuft", { timeout: 10_000 });
      await expect(page.getByTestId("veto-ready")).toHaveCount(0);
      expect(state.posts).toEqual([{ side: "a", body: { ready: true } }, { side: "b", body: { ready: true } }]);
      await context.close();
    });

    test(`Matchseite: Leitung startet ein wartendes Veto im Notfall nur mit Grund bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      const start = {
        sides: [{ registration_id: "a", name: SIDES[0], ready: true, own: false }, { registration_id: "b", name: SIDES[1], ready: false, own: false }],
        own_ready: false, other_ready: false, can_ready: false, can_withdraw: false, hint: START_READY, lead: { can_start: true, conflict: null },
      };
      const waiting = { ...BLOCKED, step_seconds: 60, presets: PRESETS, blocked: null, pick_hint: START_READY, start };
      await setup(page, LEAD, { posts, matchPage: { ...PAGE, acting_registration_id: null, checkin: { ...CHECKIN, own_registration_id: null, start_hint: START_READY,
        sides: [{ ...OWN, own: false }, OTHER], veto: waiting, lead: { can_enter: false, conflict: null, rosters: {} } } } });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("veto-headline")).toHaveText("Vorgabe steht – bereit zum Veto?");
      await expect(page.getByTestId("veto-text")).toContainText(`${SIDES[0]} ist bereit.`);
      await expect(page.getByTestId("veto-ready-button")).toHaveCount(0);
      await page.getByTestId("veto-lead-start-button").click();
      await expect(page.getByTestId("veto-lead-start-problem")).toContainText("Grund");
      expect(posts.filter((row) => row.path.includes("/veto/"))).toEqual([]);
      await page.getByTestId("veto-lead-start-reason").fill("Captain der Falken ohne Netz, per Telefon bereit");
      await expectNoSideScroll(page);
      await shot(page, testInfo, `veto-bereit-leitung-${width}`, page.getByTestId("checkin-panel"));
      await page.getByTestId("veto-lead-start-button").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/veto/start")?.body).toEqual({ reason: "Captain der Falken ohne Netz, per Telefon bereit" });
    });
  }
});
