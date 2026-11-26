const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“) im echten Browser, Server
// nachgestellt: die Übersicht der Verwaltung mit Frist, „Zusage eintragen“ und „Nachrücken lassen“; das Blatt „Neue Season aus …“ mit
// der Wahl „mit Zusage“; unter Teams das Startrecht mit „Startrecht annehmen“ und die Prognose. Bei 390 und 1440 px ohne seitliches
// Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab (startrechte-…). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const CAPTAIN = { id: "cap-1", username: "kapitaenin", display_name: "Kapitänin", role: "user", areas: [] };
const day = (offset) => new Date(Date.UTC(2027, 1, 2 + offset)).toISOString().slice(0, 10);
const CALENDAR = { weeks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false })),
  blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 5, end_date: "2027-04-12T21:59:59+00:00" };
const SCORING = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff", "lead_decision"], head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON = { id: "s2", league_id: "l1", number: 2, name: "Season 2", slug: "season-2", start_date: "2027-02-01T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
  default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4,
  game_mode_order: [], scoring_rules: SCORING, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "off", status: "draft", blocked_periods: [],
  predecessor_id: "s1", predecessor: { id: "s1", name: "Season 1", number: 1, slug: "season-1" } };
const division = (level, top, bottom, staffeln = []) => ({ id: `d${level}`, level, overrides: {}, label: `Liga ${level}`, calendar: CALENDAR,
  settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: SCORING },
  zones: { promote: 1, relegate: 1, playoff_promote: 0, playoff_relegate: 0 },
  zones_effective: { promote: top ? 0 : 1, relegate: bottom ? 0 : 1, playoff_promote: 0, playoff_relegate: 0, top, bottom }, staffeln });
const PAGE = {
  capabilities: ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules"],
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON,
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [division(1, true, false), division(2, false, true)],
};
const done = [{ tournament_id: "o1", staffel: "A", status: "completed", participant_count: 4, max_participants: 8 }];
const OLD_PAGE = { ...PAGE, season: { ...SEASON, id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "completed", visibility: "public",
  start_date: "2026-11-09T23:00:00+00:00", predecessor_id: null, predecessor: null }, divisions: [division(1, true, false, done), division(2, false, true, done)] };

const DEFAULTS = { mode: "accept", accept_days: 14, successor: "next", remind_hours: 48, announce: true };
const UNTIL = "2027-01-15T17:00:00+00:00";
const right = (id, name, extra = {}) => ({ application_id: id, squad_id: `q${id.slice(1)}`, display_name: name, division_level: 1, division_label: "Liga 1",
  movement: "stay", from_label: "Liga 1", from_staffel: "A", rank: 1, via: null, state: "offered", accept_until: UNTIL, accepted_at: null, accepted_via: null,
  accept_reason: null, accepted_by_name: null, staffel: null, fills: null, filled_by: null, own_team: false, ...extra });
const RIGHTS = {
  active: true, settings: { ...DEFAULTS, accept_days: 10, successor: "lead" }, defaults: DEFAULTS, predecessor: { id: "s1", name: "Season 1" }, paused: false,
  started: false, superadmin: true, counts: { offered: 3, accepted: 2, participating: 1, expired: 1 }, open_rights: 3,
  rows: [
    right("a1", "Nordlicht · Nordlicht A", { state: "accepted", accept_until: null, accepted_at: "2027-01-06T18:00:00+00:00", accepted_via: "team" }),
    right("a2", "Sturmfalken · Falken Rot", { rank: 2 }),
    right("a3", "Eisbären · Eisbären B", { rank: 3, state: "participating", accept_until: null, staffel: "Liga 1 · Staffel A" }),
    right("a5", "Wüstenfüchse · Füchse A", { movement: "up", from_label: "Liga 2", rank: 1, state: "expired", accept_until: null }),
    right("a4", "Bergdohlen · Dohlen Grün", { division_level: 2, division_label: "Liga 2", movement: "down", rank: 4 }),
    right("a6", "Flusskrebse · Krebse Eins", { division_level: 2, division_label: "Liga 2", from_label: "Liga 2", rank: 2, state: "accepted", accept_until: null,
      accepted_at: "2027-01-07T09:00:00+00:00", accepted_via: "lead", accept_reason: "Zusage per Nachricht am 07.01.", accepted_by_name: "Leitung" }),
    right("a7", "Nebelkrähen · Krähen B mit einem sehr langen Namen", { division_level: 2, division_label: "Liga 2", from_label: "Liga 2", rank: 3 }),
  ],
  open_places: [{ application_id: "a5", display_name: "Wüstenfüchse · Füchse A", division_label: "Liga 1", division_level: 1, why: "expired", group: "non_promoted",
    pick: "a6", tied: [], candidates: [{ application_id: "a6", display_name: "Flusskrebse · Krebse Eins", from_label: "Liga 2", from_staffel: "A", rank: 2, own_team: false }] }],
};

const team = (squad, name, extra) => ({ squad_id: squad, display_name: name, from_staffel: "A", ...extra });
const PREVIEW = {
  season: { id: "s1", name: "Season 1", number: 1, status: "completed" }, can_create: true, problems: [], successor: null, suggested: { number: 2, name: "Season 2" },
  copied: ["Spielbetrieb: Best of, Teamgröße, Modi je Map, Ergebnisregeln, Veto, Vorfälle und Pausen", "Tabelle: Punkte, Gleichstand, Ausscheiden"],
  dates_to_set: ["Beginn der ersten Spielwoche", "Sperrzeiten", "Anmeldefenster und Meldeschluss"],
  map_pool: { version: 4 }, loadout_bans: { version: 2 }, rules: { kind: "league", label: "Version 3", version_id: "v3" }, carried: 4,
  relegation_note: "Relegationsplätze sind vorbereitet: Sie stehen farbig in der Tabelle, die Teams bleiben vorerst in ihrer Liga.", capacity_hints: [],
  start_rights: { settings: { ...DEFAULTS, accept_days: 10 }, defaults: DEFAULTS },
  divisions: [
    { level: 1, label: "Liga 1", zones_label: "oberste Liga: kein Aufstieg · 1 Absteiger", teams: [
      team("q1", "Nordlicht · Nordlicht A", { from_label: "Liga 1", rank: 1, movement: "stay" }),
      team("q5", "Wüstenfüchse · Füchse A", { from_label: "Liga 2", rank: 1, movement: "up" })] },
    { level: 2, label: "Liga 2", zones_label: "1 Aufsteiger · unterste Liga: kein Abstieg", teams: [
      team("q4", "Bergdohlen · Dohlen Grün", { from_label: "Liga 1", rank: 4, movement: "down" }),
      team("q6", "Flusskrebse · Krebse Eins", { from_label: "Liga 2", rank: 2, movement: "stay" })] },
  ],
  dropped: [],
};

const MY_TEAM = { id: "team-1", name: "Wüstenfüchse", tag: "WFX", my_role: "member", can_manage: false, members: [], member_ids: ["cap-1"], squad_count: 2 };
const MY_SQUADS = [
  { id: "q5", team_id: "team-1", name: "Füchse A", status: "active", captain_id: "cap-1", members: [{ id: "cap-1", display_name: "Kapitänin" }] },
  { id: "q9", team_id: "team-1", name: "Füchse B", status: "active", captain_id: "cap-1", members: [{ id: "cap-1", display_name: "Kapitänin" }] },
];
const OFFER = { id: "a5", squad_id: "q5", season_id: "s2", status: "accepted", title: "Probe-Liga Season 2", url: null, can_withdraw: true, staffel: null,
  carry_over: { from_season_name: "Season 1", from_label: "Liga 2", rank: 1, movement: "up", division_label: "Liga 1", withdraw_until: "2027-02-01T23:00:00+00:00",
    start_right: { state: "offered", accept_until: UNTIL, accepted_at: null, fills: null, can_accept: true, can_decline: false } } };
const ACCEPTED = { ...OFFER, carry_over: { ...OFFER.carry_over, start_right: { ...OFFER.carry_over.start_right, state: "accepted", accept_until: null, can_accept: false } } };
const FORECAST = { squad_id: "q9", season_id: "s7", title: "Abend-Liga Season 3", url: "/liga/abend-liga/season-3", state: "forecast", movement: "up", rank: 1,
  zone_label: "Aufstieg", division_label: null };

async function mockServer(page, user) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "teams/invites/my", "teams/dissolved/mine", "teams?**", "teams/levels"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(user));
  await page.route("**/api/admin/leagues/seasons/s1", json(OLD_PAGE));
  await page.route("**/api/admin/leagues/seasons/s2", json(PAGE));
  await page.route("**/api/admin/leagues/seasons/s2/start-rights", (route) => (route.request().method() === "GET" ? json(RIGHTS)(route) : route.fallback()));
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

test.describe("Liga: Startrechte für die nächste Season", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Verwaltung bei ${width} px: Stand je Co-Team mit Frist, Zusage eintragen, Nachrücken mit Grund`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, ADMIN);
      const sent = {};
      await page.route("**/api/admin/leagues/seasons/s2/start-rights/a2/accept", (route) => {
        sent.accept = route.request().postDataJSON();
        return json(right("a2", "Sturmfalken · Falken Rot", { state: "accepted", accepted_via: "lead" }))(route);
      });
      await page.route("**/api/admin/leagues/seasons/s2/start-rights/a5/fill", (route) => {
        sent.fill = route.request().postDataJSON();
        return json(right("a6", "Flusskrebse · Krebse Eins"))(route);
      });
      await page.goto("/admin/leagues/seasons/s2#startrechte");
      const section = page.getByTestId("season-start-rights");
      await expect(section.getByTestId("start-rights-active")).toBeChecked();
      await expect(section.getByTestId("start-rights-days")).toHaveValue("10");
      await expect(section.getByTestId("start-rights-counts")).toHaveText("3 Zusage offen · 2 zugesagt · 1 spielen mit · 1 verfallen");
      // Getrennte Zustände: offen mit Frist, zugesagt, Teilnahme (zugeteilt), verfallen.
      await expect(section.getByTestId("start-right-a2")).toContainText("Zusage offen");
      await expect(section.getByTestId("start-right-a2")).toContainText("Zusage bis 15.01.2027, 18:00 Uhr");
      await expect(section.getByTestId("start-right-a1")).toContainText("Zugesagt");
      await expect(section.getByTestId("start-right-a3")).toContainText("Spielt mit");
      await expect(section.getByTestId("start-right-a5")).toContainText("Verfallen");
      await expect(section.getByTestId("start-right-a6")).toContainText("Von der Leitung eingetragen (Leitung): Zusage per Nachricht am 07.01.");
      await expect(section.getByTestId("start-right-place-a5")).toContainText(
        "Liga 1: Platz von Wüstenfüchse · Füchse A frei (Frist verfallen). Nach der Regel rückt Flusskrebse · Krebse Eins nach – der beste Nicht-Aufsteiger.");
      await noSideScroll(page);
      await section.scrollIntoViewIfNeeded();
      await shot(section, `startrechte-verwaltung-${width}`);

      await section.getByTestId("start-right-fill-a5").click();
      const fillSheet = page.getByTestId("start-right-fill-sheet");
      await expect(fillSheet.getByTestId("start-right-fill-candidate-a6")).toBeChecked();
      await expect(fillSheet.getByTestId("start-right-fill-confirm")).toBeDisabled();
      await fillSheet.getByTestId("start-right-fill-reason").fill("Platz 2 der Tabelle rückt nach");
      await noSideScroll(page);
      await shot(page, `startrechte-nachruecken-${width}`);
      await fillSheet.getByTestId("start-right-fill-confirm").click();
      await expect.poll(() => sent.fill).toEqual({ candidate_id: "a6", reason: "Platz 2 der Tabelle rückt nach" });
      await expect(fillSheet).toHaveCount(0);

      await section.getByTestId("start-right-accept-a2").click();
      const acceptSheet = page.getByTestId("start-right-accept-sheet");
      await expect(acceptSheet.getByTestId("start-right-accept-confirm")).toBeDisabled();
      await acceptSheet.getByTestId("start-right-accept-reason").fill("Zusage per Nachricht am 08.01.");
      await acceptSheet.getByTestId("start-right-accept-confirm").click();
      await expect.poll(() => sent.accept).toEqual({ reason: "Zusage per Nachricht am 08.01." });
      await expect(acceptSheet).toHaveCount(0);

      // Umschalten auf „automatisch“ fragt im Panel nach (Entscheidung 26.11.): Offene Startrechte gelten erst nach der Bestätigung als zugesagt.
      await page.route("**/api/admin/leagues/seasons/s2/start-rights", (route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        sent.settings = route.request().postDataJSON();
        return json({ ...RIGHTS, settings: { ...RIGHTS.settings, mode: "auto" }, open_rights: 0 })(route);
      });
      await section.getByTestId("start-rights-mode").selectOption("auto");
      await section.getByTestId("start-rights-save").click();
      const box = section.getByTestId("start-rights-confirm-open");
      await expect(box).toContainText("3 offene Startrechte gelten dann als zugesagt und brauchen keine Zusage mehr.");
      expect(sent.settings).toBeUndefined();
      await noSideScroll(page);
      await box.getByTestId("start-rights-confirm-yes").click();
      await expect.poll(() => sent.settings && sent.settings.confirm_open).toBe(true);
      await expect(box).toHaveCount(0);
    });

    test(`Pause und Startdatum bei ${width} px: Die Übersicht sagt, warum gerade nichts verfällt`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, ADMIN);
      const rows = [right("a2", "Sturmfalken · Falken Rot", { rank: 2, accept_until: null, paused: true }),
        right("a7", "Nebelkrähen · Krähen B", { division_level: 2, division_label: "Liga 2", from_label: "Liga 2", rank: 3, waits_for_lead: true })];
      await page.route("**/api/admin/leagues/seasons/s2/start-rights", (route) => (route.request().method() === "GET"
        ? json({ ...RIGHTS, paused: true, started: true, counts: { offered: 2 }, rows, open_places: RIGHTS.open_places })(route) : route.fallback()));
      await page.goto("/admin/leagues/seasons/s2#startrechte");
      const section = page.getByTestId("season-start-rights");
      await expect(section.getByTestId("start-rights-paused")).toContainText("Die Fristen stehen still und laufen danach um die Dauer der Pause länger.");
      await expect(section.getByTestId("start-rights-started")).toContainText("Ab jetzt verfällt kein Startrecht mehr von selbst");
      await expect(section.getByTestId("start-right-a2")).toContainText("Frist ruht");
      await expect(section.getByTestId("start-right-a7")).toContainText("Frist vorbei – jetzt entscheidest du");
      // Weder in der Pause noch nach dem Startdatum rückt jemand nach.
      await expect(section.getByTestId("start-right-fill-a5")).toHaveCount(0);
      await noSideScroll(page);
      await section.getByTestId("start-rights-paused").scrollIntoViewIfNeeded();
      await shot(page, `startrechte-pause-${width}`);
    });

    test(`Neue Season aus … bei ${width} px: Startrechte mit Zusage gehen als Einstellung mit`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, ADMIN);
      let sent = null;
      await page.route("**/api/admin/leagues/seasons/s1/successor", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        sent = route.request().postDataJSON();
        return json({ ok: true, replay: false, carried: 4, notified: 8, season: { id: "s2", name: "Season 2", number: 2, slug: "season-2" } })(route);
      });
      await page.goto("/admin/leagues/seasons/s1");
      await page.getByTestId("season-successor").click();
      const sheet = page.getByTestId("successor-sheet");
      await expect(sheet.getByTestId("successor-rights-accept")).toBeChecked();
      await expect(sheet.getByTestId("successor-rights-days")).toHaveValue("10");
      await expect(sheet.getByTestId("successor-teams-note")).toContainText("sagen innerhalb von 10 Tagen zu");
      await sheet.getByTestId("successor-start").fill("2027-02-02");
      await sheet.getByTestId("successor-rights-days").fill("7");
      await sheet.getByTestId("successor-rights").scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await shot(page, `startrechte-neue-season-${width}`);
      await sheet.getByTestId("successor-create").click();
      await expect.poll(() => sent && sent.start_rights).toEqual({ mode: "accept", accept_days: 7, successor: "next", remind_hours: 48, announce: true });
      await expect(page).toHaveURL(/\/admin\/leagues\/seasons\/s2/);
    });

    test(`Unter Teams bei ${width} px: Startrecht annehmen, Prognose beim anderen Co-Team`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, CAPTAIN);
      let answered = null;
      await page.route("**/api/teams/my", json([MY_TEAM]));
      await page.route("**/api/teams/team-1/squads", json(MY_SQUADS));
      await page.route("**/api/me/league-applications", (route) => json({ items: [answered ? ACCEPTED : OFFER], start_rights: [FORECAST] })(route));
      await page.route("**/api/me/league-applications/a5/start-right", (route) => {
        answered = route.request().postDataJSON();
        return json({ ...ACCEPTED, replay: false })(route);
      });
      await page.goto("/teams");
      const row = page.getByTestId("squad-application-a5");
      await expect(row).toContainText("Startrecht – Zusage offen");
      await expect(row.getByTestId("squad-start-right-line-a5")).toHaveText("Startrecht für Liga 1: bitte bis 15.01.2027, 18:00 Uhr zusagen. Ohne Zusage verfällt es.");
      // Prognose ist nur Anzeige - mit dem Wort dafür und ohne Knopf.
      const forecast = page.getByTestId("squad-start-right-outlook-q9-s7");
      await expect(forecast).toContainText("Prognose nach der laufenden Tabelle: Aufstieg (Platz 1). Fest ist das erst, wenn die Season abgeschlossen ist.");
      await expect(forecast.getByRole("button")).toHaveCount(0);
      await noSideScroll(page);
      await shot(row.locator("xpath=ancestor::div[contains(@class,'rounded-sm')][1]"), `startrechte-teams-${width}`);
      await row.getByTestId("squad-start-right-accept-a5").click();
      await expect.poll(() => answered).toEqual({ action: "accept" });
      await expect(page.getByTestId("squad-application-a5")).toContainText("Zugesagt – Zuteilung folgt");
      await expect(page.getByTestId("squad-start-right-accept-a5")).toHaveCount(0);
    });
  }
});
