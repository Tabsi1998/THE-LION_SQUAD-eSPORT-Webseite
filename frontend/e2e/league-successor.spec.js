const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Neue Season aus der Vorgänger-Season (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“) im echten Browser, Server
// nachgestellt: die Vorschau „Neue Season aus …“ mit Teams je Liga und Anlegen, die Zonen in der Tabelle der Ligaseite und „Abmelden“
// unter Teams. Bei 390 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab (f2-neue-season-…,
// f2-zonen-tabelle-…, f2-abmelden-…). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const CAPTAIN = { id: "cap-1", username: "kapitaenin", display_name: "Kapitänin", role: "user", areas: [] };
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const CALENDAR = { weeks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false })),
  blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 5, end_date: "2027-01-18T22:59:59+00:00" };
const SCORING = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff", "lead_decision"], head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON = { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
  default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4,
  game_mode_order: [], scoring_rules: SCORING, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "public", status: "completed", blocked_periods: [] };
const division = (level, top, bottom) => ({ id: `d${level}`, level, overrides: {}, label: `Liga ${level}`, calendar: CALENDAR,
  settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: SCORING },
  zones: { promote: 1, relegate: 1, playoff_promote: 0, playoff_relegate: 0 },
  zones_effective: { promote: top ? 0 : 1, relegate: bottom ? 0 : 1, playoff_promote: 0, playoff_relegate: 0, top, bottom },
  staffeln: [{ tournament_id: `t${level}`, staffel: "A", status: "completed", participant_count: 4, max_participants: 8 }] });
const SEASON_PAGE = {
  capabilities: ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules"],
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON,
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [division(1, true, false), division(2, false, true)],
};
const NEXT_PAGE = { ...SEASON_PAGE, season: { ...SEASON, id: "s2", number: 2, name: "Season 2", slug: "season-2", status: "draft", visibility: "off",
  start_date: "2027-02-01T23:00:00+00:00" }, divisions: [{ ...division(1, true, false), staffeln: [] }, { ...division(2, false, true), staffeln: [] }] };

const team = (squad, name, extra) => ({ squad_id: squad, display_name: name, from_staffel: "A", ...extra });
const PREVIEW = {
  season: { id: "s1", name: "Season 1", number: 1, status: "completed" }, can_create: true, problems: [], successor: null, suggested: { number: 2, name: "Season 2" },
  copied: ["Spielbetrieb: Best of, Teamgröße, Modi je Map, Ergebnisregeln, Veto, Vorfälle und Pausen", "Tabelle: Punkte, Gleichstand, Ausscheiden",
    "Anmeldung und Kader: Spielberechtigung, Plattform, Plätze, Warteliste, Zulassung", "Termin-, Check-in- und Erinnerungsregeln, Fristen für Proteste und Einsprüche",
    "Gestaltung und Gewinne"],
  dates_to_set: ["Beginn der ersten Spielwoche", "Sperrzeiten", "Anmeldefenster und Meldeschluss", "Transferfenster", "Stichtag des Kaders"],
  map_pool: { version: 4 }, loadout_bans: { version: 2 }, rules: { kind: "draft", label: "Version 3", version_id: "v3" }, carried: 7,
  relegation_note: "Relegationsplätze sind vorbereitet: Sie stehen farbig in der Tabelle, die Teams bleiben vorerst in ihrer Liga.",
  divisions: [
    { level: 1, label: "Liga 1", zones_label: "oberste Liga: kein Aufstieg · 1 Absteiger", teams: [
      team("q1", "Nordlicht · Nordlicht A", { from_label: "Liga 1", rank: 1, movement: "stay" }),
      team("q2", "Sturmfalken · Falken Rot", { from_label: "Liga 1", rank: 2, movement: "stay" }),
      team("q3", "Eisbären · Eisbären B", { from_label: "Liga 1", rank: 3, movement: "stay" }),
      team("q5", "Wüstenfüchse · Füchse A", { from_label: "Liga 2", rank: 1, movement: "up" })] },
    { level: 2, label: "Liga 2", zones_label: "1 Aufsteiger · unterste Liga: kein Abstieg", teams: [
      team("q4", "Bergdohlen · Dohlen Grün", { from_label: "Liga 1", rank: 4, movement: "down" }),
      team("q6", "Flusskrebse · Krebse Eins", { from_label: "Liga 2", rank: 2, movement: "stay" }),
      team("q7", "Nebelkrähen · Krähen B", { from_label: "Liga 2", rank: 3, movement: "stay" })] },
  ],
  dropped: [{ registration_id: "r8", display_name: "Steinadler · Adler A", reason: "Disqualifiziert", from_label: "Liga 2", from_staffel: "A", rank: 4 }],
};

const ROWS = [["r1", "Wüstenfüchse · Füchse A", 9, "promotion"], ["r2", "Flusskrebse · Krebse Eins", 6, null], ["r3", "Nebelkrähen · Krähen B", 3, null],
  ["r4", "Hafenmöwen · Möwen Blau", 0, "relegation"]].map(([id, name, points, zone], index) => ({
  registration_id: id, display_name: name, rank: index + 1, played: 3, won: points / 3, drawn: 0, lost: 3 - points / 3, score_for: 6 - index, score_against: index + 1,
  score_diff: 5 - 2 * index, points, form: [], previous_rank: null, forfeit_won: 0, forfeit_lost: 0, deducted_points: 0, exit: null, tiebreak: null, lead_decision: null, contested: 0, zone }));
const PUBLIC_SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { name: "Season 1", slug: "season-1", status: "active", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 0, loss: 0 }, blocked_periods: [] },
  map_pool: null,
  divisions: [{ id: "d2", level: 2, label: "Liga 2", staffeln: [{ tournament_id: "t2", slug: "probe-2a", staffel: "A", status: "live" }] }],
};
const PUBLIC_STAFFEL = { staffel: { tournament_id: "t2", staffel: "A", division_label: "Liga 2", division_level: 2, status: "live",
  table_rules: { allow_draws: false, tiebreakers: SCORING.table_tiebreakers } }, standings: ROWS, current: 3, teams: [], weeks: [] };

const MY_TEAM = { id: "team-1", name: "Wüstenfüchse", tag: "WFX", my_role: "member", can_manage: false, members: [], member_ids: ["cap-1"], squad_count: 1 };
const MY_SQUADS = [{ id: "q5", team_id: "team-1", name: "Füchse A", status: "active", captain_id: "cap-1", members: [{ id: "cap-1", display_name: "Kapitänin" }] }];
const CARRIED = { id: "a5", squad_id: "q5", season_id: "s2", status: "accepted", title: "Probe-Liga Season 2", url: null, can_withdraw: true, staffel: null,
  carry_over: { from_season_name: "Season 1", from_label: "Liga 2", rank: 1, movement: "up", division_label: "Liga 1", withdraw_until: "2027-02-01T23:00:00+00:00" } };

async function mockServer(page, user = null) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "teams/invites/my", "teams/dissolved/mine", "teams?**", "teams/levels"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (user) await page.route("**/api/auth/me", json(user));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues/probe-liga/season-1", json(PUBLIC_SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(PUBLIC_STAFFEL));
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
  await page.route("**/api/admin/leagues/seasons/s2", json(NEXT_PAGE));
  await page.route("**/api/admin/leagues/seasons/s1/successor", (route) => (route.request().method() === "GET" ? json(PREVIEW)(route) : route.fallback()));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(target, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", style: ".tls-bottom-nav { display: none !important; }" });
}

test.describe("Liga: neue Season aus dem Vorgänger", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Vorschau und Anlegen bei ${width} px: Teams je Liga, wer nicht dabei ist, danach die neue Season`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, ADMIN);
      let sent = null;
      await page.route("**/api/admin/leagues/seasons/s1/successor", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        sent = route.request().postDataJSON();
        return json({ ok: true, replay: false, carried: 7, notified: 14, season: { id: "s2", name: "Season 2", number: 2, slug: "season-2" } })(route);
      });
      await page.goto("/admin/leagues/seasons/s1#ligen");
      await expect(page.getByTestId("division-zones-1")).toHaveText("Auf- und Abstieg: oberste Liga: kein Aufstieg · 1 Absteiger");
      await page.getByTestId("season-successor").click();
      const sheet = page.getByTestId("successor-sheet");
      await expect(sheet.getByTestId("successor-team-q5")).toContainText("Aufstieg · Liga 2 · Staffel A, Platz 1");
      await expect(sheet.getByTestId("successor-team-q4")).toContainText("Abstieg · Liga 1 · Staffel A, Platz 4");
      await expect(sheet.getByTestId("successor-dropped")).toContainText("Steinadler · Adler A – Disqualifiziert");
      await expect(sheet.getByTestId("successor-rules")).toContainText("Version 3 als Entwurf");
      await expect(sheet.getByTestId("successor-create")).toBeDisabled();
      await sheet.getByTestId("successor-start").fill("2027-02-02");
      await sheet.getByTestId("successor-start").blur();
      await noSideScroll(page);
      if (width === 1440) await shot(page, "f2-neue-season-1440");
      await sheet.getByTestId("successor-create").click();
      await expect.poll(() => sent && sent.confirm).toBe(true);
      expect(sent.start_date).toMatch(/^2027-02-0[12]T/);
      await expect(page).toHaveURL(/\/admin\/leagues\/seasons\/s2/);
      await expect(page.getByRole("heading", { name: /Season 2/ })).toBeVisible();
    });

    test(`Zonen in der Tabelle der Ligaseite bei ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/liga/probe-liga/season-1");
      const staffel = page.getByTestId("league-staffel-A");
      await expect(staffel.getByTestId("standing-row-r1")).toHaveAttribute("data-zone", "promotion");
      await expect(staffel.getByTestId("standing-row-r4")).toHaveAttribute("data-zone", "relegation");
      await expect(staffel.getByTestId("standing-row-r2")).not.toHaveAttribute("data-zone", /.+/);
      await expect(staffel.getByTestId("league-zones-A")).toContainText("Aufstieg");
      await expect(staffel.getByTestId("league-zones-A")).toContainText("Abstieg");
      await noSideScroll(page);
      if (width === 390) await shot(staffel.locator(".tls-league-table"), "f2-zonen-tabelle-390");
    });

    test(`Abmelden unter Teams bei ${width} px: Herkunft, Frist, Rückfrage`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, CAPTAIN);
      let withdrawn = false;
      await page.route("**/api/teams/my", json([MY_TEAM]));
      await page.route("**/api/teams/team-1/squads", json(MY_SQUADS));
      await page.route("**/api/me/league-applications", json({ items: [CARRIED] }));
      await page.route("**/api/me/league-applications/a5/withdraw", (route) => {
        withdrawn = true;
        return json({ ...CARRIED, status: "withdrawn", can_withdraw: false })(route);
      });
      await page.goto("/teams");
      const row = page.getByTestId("squad-application-a5");
      await expect(row.getByTestId("squad-application-carry-a5")).toHaveText(
        "Übernommen aus Season 1: Liga 1 (Aufstieg aus Liga 2). Abmelden bis zum Start am 02.02.2027, 00:00 Uhr.");
      await expect(row.getByRole("link")).toHaveCount(0);
      await noSideScroll(page);
      if (width === 390) await shot(row.locator("xpath=ancestor::div[contains(@class,'rounded-sm')][1]"), "f2-abmelden-390");
      await row.getByTestId("squad-application-withdraw-a5").click();
      await page.getByRole("button", { name: "Abmelden" }).last().click();
      await expect.poll(() => withdrawn).toBe(true);
    });
  }
});
