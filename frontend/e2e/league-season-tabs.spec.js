const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Season-Seite mit Reitern (#2267, docs/LIGA.md „Season-Seite“) im echten Browser, Server nachgestellt: alle sieben Reiter bei 390 und
// 1440 px ohne seitliches Scrollen, die Modi an einer Stelle, Speichern je Reiter mit Punkt und Rückfrage beim Reiterwechsel, Sprung aus
// „Was fehlt noch?“, Hinweis beim Beinamen „Liga 1“. Mit E2E_SCREENS_DIR legt der Test die Bilder fürs Handbuch ab (docs/assets/liga/).
// Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff", "score_for", "lead_decision"],
  head_to_head_criteria: ["points", "score_diff", "score_for"], allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4,
  min_squad_size: 3, max_squad_size: 50, game_mode_order: ["snd", "stellung", "kontrolle"], map_repeat: "other_mode", scoring_rules: RULES,
  result_confirm_hours: 48, lineup_amend_hours: 48, match_schedule_response_hours: 72, rules_text: "", visibility: "admins", status: "draft",
  lineup_mode: "series", lineup_min_players: 3, one_team_per_season: true, unique_game_ids: true, min_age: 18, new_player_wait_days: 7,
  application_opens_at: "2026-10-31T23:00:00+00:00", application_closes_at: "2026-11-07T22:59:00+00:00", application_slots: 16, entry_policy: "all",
  application_waitlist: true, updated_at: "2026-11-02T10:00:00Z",
  blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
};
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const WEEKS = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: index === 6 || index === 7 }));
const CALENDAR = { weeks: WEEKS, blocked_weeks: [7, 8], active_weeks: 8, max_teams_per_staffel: 8, rounds_needed: 7, end_date: "2027-01-18T22:59:59+00:00" };
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter",
  modes: [{ mode: "snd", label: "Suchen & Zerstören" }, { mode: "stellung", label: "Stellung" }, { mode: "kontrolle", label: "Kontrolle" }] };
const MAPS = ["Hafenkante", "Nebelwerk", "Salzgrube", "Funkturm", "Kieswerk"];
const LIBRARY = MAPS.map((name, index) => ({ id: `m${index}`, slug: name.toLowerCase(), name, image_url: null, modes: ["snd", "stellung", "kontrolle"], order: index, aliases: [] }));
const POOL = { id: "p1", version: 2, origin: "league_season", saved_at: "2026-11-02T10:00:00Z", stale: false, outdated_map_ids: [],
  modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "m0", name: "Hafenkante" }, { map_id: "m1", name: "Nebelwerk" }] },
    { mode: "stellung", label: "Stellung", maps: [{ map_id: "m2", name: "Salzgrube" }] }] };
const SEASON_PAGE = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga", accent_color: null }, season: SEASON, game: GAME, calendar: CALENDAR,
  library: LIBRARY, map_pool: POOL, default_pool: null, look: { emblem_url: null },
  divisions: [{ id: "d1", level: 1, nickname: "Liga 1", overrides: {}, label: "Liga 1 · Liga 1", status: "active", calendar: CALENDAR,
    settings: { best_of: 3, team_size: 4, min_squad_size: 3, max_staffel_size: 8, scoring_rules: RULES }, staffeln: [] }],
};
const READINESS = {
  ok: false, superadmin: true, max_maps: 3, total: null,
  problems: [
    { code: "mode_order_missing", text: "Der Modus „Kontrolle“ aus „Modus je Map“ fehlt im Map-Pool." },
    { code: "rules_missing", text: "Es gibt kein veröffentlichtes Regelwerk für die Season oder die Liga." },
    { code: "staffel_missing", text: "Liga 1 hat noch keine Staffel." },
  ],
  warnings: [],
  requirements: [
    { mode: "snd", label: "Suchen & Zerstören", derived: 2, override: null, needed: 2, have: 2 },
    { mode: "stellung", label: "Stellung", derived: 1, override: null, needed: 1, have: 1 },
    { mode: "kontrolle", label: "Kontrolle", derived: 1, override: null, needed: 1, have: 0 },
  ],
};
const RESULT_RULES = { scores_required: true, staffeln: 0, rules: GAME.modes.map((mode) => ({ ...mode, status: "active", differs: false,
  season_rule: { kind: mode.mode === "snd" ? "rounds" : "score", target: mode.mode === "snd" ? 6 : 250, draw_allowed: false, overtime: false },
  game_rule: { kind: mode.mode === "snd" ? "rounds" : "score", target: mode.mode === "snd" ? 6 : 250, draw_allowed: false, overtime: false } })) };
const SCHEDULE = { active: true, defaults: { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 24, reschedule_max: 2, reschedule_same_week: true,
  result_reminder_hours: 24, result_overdue_hours: 48 } };
SCHEDULE.schedule_rules = SCHEDULE.defaults;
const RULES_VIEW = { current: null, inherited: null, versions: [], draft: { revision: 1, title: "Regelwerk Season 1" }, data_changes: null };

const PROTEST_VALUES = {
  protest_hours: 48, statement_hours: 48, protest_target_hours: 72, appeal_hours: 48, moss_upload_hours: 24, evidence_keep_days: 30, contested_result_mode: "counts",
  protest_reasons: [["wrong_result", "Falsches Ergebnis"], ["rule_violation", "Regelverstoß"], ["equipment", "Ausrüstung", true], ["lobby", "Lobby und Einstellungen", true],
    ["player", "Spielberechtigung eines Spielers", true], ["cheating", "Cheat-Verdacht"], ["technical", "Technik"], ["other", "Sonstiges"]]
    .map(([key, label, ask]) => ({ key, label, ask_notified: Boolean(ask) })),
};
const PROTESTS = { settings: PROTEST_VALUES, active: true, defaults: PROTEST_VALUES, limits: {}, reasons_max: 20,
  fixed_reasons: ["wrong_result", "rule_violation", "technical", "other"], staffeln: 2 };
const PROCEDURES = { open: 2, items: [
  { id: "p1", match_id: "m1", staffel: "Probe-Liga Season 1 · Liga 1 · Staffel A", sides: ["Rudel Alpha mit langem Namen", "Horst der Falken"], side_name: "Horst der Falken",
    kind_label: "Protest", reason_label: "Falsches Ergebnis", state: "open", conflict: false, assignee: { name: "Leitung" }, target_at: new Date(Date.now() + 30 * 3600 * 1000).toISOString() },
  { id: "p2", match_id: "m2", staffel: "Probe-Liga Season 1 · Liga 1 · Staffel A", sides: ["Rudel Beta", "Horst der Falken"], kind_label: "Beanstandung", state: "open", conflict: true },
  { id: "p3", match_id: "m3", staffel: "Probe-Liga Season 1 · Liga 1 · Staffel A", sides: ["Rudel Alpha mit langem Namen", "Nordlichter"], side_name: "Nordlichter",
    kind_label: "Einspruch", state: "decided", conflict: false, resolved_at: "2026-11-09T18:30:00Z" },
] };

async function mockServer(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const calls = { patch: [] };
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const where = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (where.startsWith("/changes")) return route.abort();
    if (where === "/auth/me") return json(ADMIN)(route);
    if (where === "/admin/leagues/seasons/s1" && request.method() === "PATCH") {
      calls.patch.push(request.postDataJSON());
      return json({ ...SEASON, changed: Object.keys(request.postDataJSON()), staffeln_to_sync: 0, warnings: [] })(route);
    }
    const bodies = {
      "/admin/leagues/seasons/s1": SEASON_PAGE,
      "/admin/leagues/seasons/s1/readiness": READINESS,
      "/admin/leagues/seasons/s1/result-rules": RESULT_RULES,
      "/admin/leagues/seasons/s1/schedule-rules": SCHEDULE,
      "/admin/leagues/seasons/s1/roster": { fields: [], rules: {}, squads: [], season: {} },
      "/admin/leagues/seasons/s1/applications": { configured: true, items: [], stats: { taken: 3, slots: 16, open: 2, waiting: 0, unassigned: 0 }, divisions: [] },
      "/admin/leagues/seasons/s1/loadout-bans": { game: { id: "g1", name: "Probe Shooter", modes: GAME.modes }, categories: [], library: [], list: null, versions: [] },
      "/admin/leagues/seasons/s1/map-pool/versions": { versions: [] },
      "/admin/league-rules/league_season/s1": RULES_VIEW,
      // Reiter „Proteste“ (E.2, #1619): Einstellungen und Eingang der Verfahren.
      "/admin/leagues/seasons/s1/protest-settings": PROTESTS,
      "/admin/leagues/seasons/s1/procedures": PROCEDURES,
    };
    if (where in bodies) return json(bodies[where])(route);
    if (["/sponsors", "/notifications/me", "/games"].some((prefix) => where.startsWith(prefix))) return json([])(route);
    if (where === "/friends") return json({ incoming: [], friends: [], outgoing: [] })(route);
    return json({})(route);
  });
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, name, width) {
  const file = `${name}-${width === 390 ? "handy" : "pc"}.png`;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath(file), fullPage: true, animations: "disabled" });
  const dir = process.env.E2E_SCREENS_DIR;
  if (dir) await page.screenshot({ path: path.join(dir, file), fullPage: false, animations: "disabled" });
}

const TABS = [
  ["ueberblick", "season-phases"], ["spielbetrieb", "season-pool-modes"], ["termine", "season-calendar"], ["anmeldung", "season-application-settings"],
  ["tabelle", "season-table-rules"], ["proteste", "season-protest-settings"], ["regelwerk", "season-rules"], ["ligen", "season-divisions"],
];

test.describe("Liga: Season-Seite mit Reitern", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`alle Reiter bei ${width} px: übersichtlich, ohne seitliches Scrollen`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/admin/leagues/seasons/s1");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Probe-Liga · Season 1");
      if (width === 390) await expect(page.getByTestId("season-tabs-hint")).toContainText("Seitlich wischen");
      for (const [key, marker] of TABS) {
        await page.getByTestId(`season-tab-${key}`).click();
        await expect(page.getByTestId(`season-tab-${key}`)).toHaveAttribute("aria-selected", "true");
        await expect(page.getByTestId(`season-panel-${key}`).getByTestId(marker).first()).toBeVisible();
        await expect(page).toHaveURL(key === "ueberblick" ? /seasons\/s1$/ : new RegExp(`#${key}$`));
        await noSideScroll(page);
        await shot(page, `liga-season-${key}`, width);
      }
    });
  }

  test("Überblick: Ablauf, Was fehlt noch? mit Sprung, Regelwerk-Hinweis, Wirkung von Sichtbarkeit und Stand", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/admin/leagues/seasons/s1");
    await expect(page.getByTestId("season-phases").locator("[aria-current=step]")).toHaveCount(1);
    await expect(page.getByTestId("season-rules-notice")).toContainText("Entwurf, der noch nicht freigegeben ist");
    await expect(page.getByTestId("season-visibility-effect")).toContainText("Vorschau");
    await page.getByTestId("season-readiness-problems-go-mode_order_missing").click();
    await expect(page).toHaveURL(/#serie$/);
    await expect(page.getByTestId("season-series")).toBeInViewport();
    await expect(page.getByTestId("season-mode-order-hints")).toContainText("„Kontrolle“ steht in „Modus je Map“, hat aber keine Maps im Pool.");
  });

  test("Spielbetrieb: Modus anhaken, Maps wählen, Hinweis verschwindet; Punkt und Rückfrage beim Reiterwechsel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const calls = await mockServer(page);
    await page.goto("/admin/leagues/seasons/s1#spielbetrieb");
    await expect(page.getByTestId("season-pool-pick-kontrolle")).not.toBeChecked();
    await expect(page.getByTestId("result-rules-kontrolle")).toHaveCount(0);
    await page.getByTestId("season-pool-pick-kontrolle").check();
    await expect(page.getByTestId("result-rules-kontrolle")).toBeVisible();
    await page.getByTestId("season-pool-mode-kontrolle").getByLabel("Funkturm in Kontrolle").check();
    await expect(page.getByTestId("season-mode-order-hints")).toHaveCount(0);
    await expect(page.getByTestId("season-tab-dirty-spielbetrieb")).toBeVisible();
    await noSideScroll(page);

    // Ein Formularfeld des Reiters: Wechsel fragt nach, „Später speichern“ behält die Eingabe.
    await page.getByTestId("season-form-team-size").fill("5");
    await page.getByTestId("season-tab-termine").click();
    await expect(page.getByTestId("confirm-dialog")).toContainText("„Spielbetrieb“ ist nicht gespeichert");
    await page.getByTestId("confirm-dialog-cancel").click();
    await expect(page.getByTestId("season-tab-termine")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("season-tab-spielbetrieb").click();
    await expect(page.getByTestId("season-form-team-size")).toHaveValue("5");
    await expect(page.getByTestId("season-pool-mode-kontrolle")).toBeVisible();
    await page.getByTestId("season-save-spielbetrieb").click();
    await expect.poll(() => calls.patch.length).toBe(1);
    // Vorfälle (D.5, #1619): die fünf Felder der Gruppe „Vorfälle und Pausen“ gehören zum Reiter Spielbetrieb.
    expect(Object.keys(calls.patch[0]).sort()).toEqual(["best_of", "clarification_mode", "game_mode_order", "incident_answer_minutes", "incident_quota_per_map",
      "lineup_amend_hours", "map_break_after", "map_break_minutes", "map_repeat", "result_confirm_hours", "team_size"]);
    expect(calls.patch[0].team_size).toBe(5);
  });

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Spielbetrieb: Vorfälle und Pausen mit Vorgaben, gespeichert wird, was eingestellt ist, bei ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const calls = await mockServer(page);
      await page.goto("/admin/leagues/seasons/s1#vorfaelle");
      const box = page.getByTestId("season-incidents");
      await expect(box).toBeInViewport();
      // Eine Season ohne die Felder zeigt die Vorgaben des Servers.
      await expect(page.getByTestId("season-form-incident-answer")).toHaveValue("10");
      await expect(page.getByTestId("season-form-incident-quota")).toHaveValue("1");
      await expect(page.getByTestId("season-form-break-after")).toHaveValue("2");
      await expect(page.getByTestId("season-form-break-minutes")).toHaveValue("5");
      await expect(page.getByTestId("season-form-clarification-mode")).toHaveValue("continue");
      await page.getByTestId("season-form-incident-answer").fill("15");
      await page.getByTestId("season-form-clarification-mode").selectOption("pause_series");
      await expect(box).toContainText("Spätere Maps lassen sich erst nach der Entscheidung melden.");
      await noSideScroll(page);
      // Nur der Kasten: das Bild der ganzen Seite zeigt ihn sonst unter dem Map-Pool.
      const file = `liga-season-vorfaelle-${width === 390 ? "handy" : "pc"}.png`;
      await box.screenshot({ path: test.info().outputPath(file), animations: "disabled" });
      if (process.env.E2E_SCREENS_DIR) await box.screenshot({ path: path.join(process.env.E2E_SCREENS_DIR, file), animations: "disabled" });
      await page.getByTestId("season-save-spielbetrieb").click();
      await expect.poll(() => calls.patch.length).toBe(1);
      expect(calls.patch[0]).toMatchObject({ incident_answer_minutes: 15, incident_quota_per_map: 1, clarification_mode: "pause_series", map_break_after: 2, map_break_minutes: 5 });
    });
  }

  test("Ligen und Staffeln: Beiname „Liga 1“ bekommt einen freundlichen Hinweis", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockServer(page);
    await page.goto("/admin/leagues/seasons/s1#ligen");
    await expect(page.getByTestId("division-nickname-repeat-1")).toBeVisible();
    await page.getByTestId("division-edit-1").click();
    const sheet = page.getByTestId("division-sheet");
    await expect(sheet.getByTestId("division-nickname-repeat")).toContainText("„Liga 1 · Liga 1“");
    await noSideScroll(page);
    const dir = process.env.E2E_SCREENS_DIR;
    if (dir) await sheet.screenshot({ path: path.join(dir, "liga-season-beiname-handy.png"), animations: "disabled" });
    await sheet.getByTestId("division-nickname").fill("Elite");
    await expect(sheet.getByTestId("division-nickname-repeat")).toHaveCount(0);
  });
});
