const { test, expect } = require("@playwright/test");
const path = require("node:path");

// Solo-Liga, Paket P1 (#1629, docs/LIGA.md „S.1 Solo-Liga“) im echten Browser, Server nachgestellt: Liga mit „Spieler (1 gegen 1)“
// anlegen, Season einer Solo-Liga mit fester Teamgröße und „Anmeldung folgt“, auf der Staffel-Seite eine Person zuteilen - und daneben die
// Team-Liga, die sich verhält wie vorher (Gegenprobe). Bei 390 und 1440 px ohne seitliches Scrollen, feste Uhr. Mit E2E_SCREENS_DIR legt
// der Test die Bilder der Masken ab. Nur erfundene Namen.

const NOW = new Date("2026-11-27T10:00:00+00:00");
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const ALL = ["applications", "manage", "matches", "results", "roster", "sanctions", "season"];
const RULES = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
const DEFAULTS = { weeks_total: 10, matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, best_of: 3,
  team_size: 4, max_staffel_size: 8, min_squad_size: 3, max_squad_size: 50, min_age: 18, new_player_wait_days: 7 };
const LIST = {
  games: [{ id: "g1", name: "Probe Duell", slug: "probe-duell", supports_solo: true }, { id: "g2", name: "Nur Teams", slug: "nur-teams", supports_solo: false }],
  season_defaults: DEFAULTS,
  season_defaults_solo: { ...DEFAULTS, team_size: 1, min_squad_size: 1, max_squad_size: 1 },
  leagues: [
    { id: "l1", name: "Duell-Liga", slug: "duell", game_id: "g1", game_name: "Probe Duell", status: "active", participant_kind: "solo",
      seasons: [{ id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "draft", visibility: "admins", start_date: "2026-12-07T23:00:00+00:00", weeks_total: 10 }] },
    { id: "l2", name: "Team-Liga", slug: "team", game_id: "g1", game_name: "Probe Duell", status: "active", participant_kind: "team", seasons: [] },
  ],
};
const day = (offset) => new Date(Date.UTC(2026, 11, 8 + offset)).toISOString().slice(0, 10);
const WEEKS = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false }));
const CALENDAR = { weeks: WEEKS, blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 11, rounds_needed: 7, end_date: "2027-02-15T22:59:59+00:00" };
const SOLO_SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-12-07T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 1, min_squad_size: 1, max_squad_size: 1, lineup_mode: "series", lineup_min_players: 1, min_age: 18, unique_game_ids: true,
  game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48, visibility: "admins", status: "draft",
  blocked_periods: [], updated_at: "2026-11-27T09:00:00Z",
};
const SEASON_PAGE = {
  capabilities: ALL,
  league: { id: "l1", name: "Duell-Liga", slug: "duell", participant_kind: "solo" }, season: SOLO_SEASON,
  game: { id: "g1", name: "Probe Duell", modes: [{ mode: "duell", label: "Duell" }] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [{
    id: "d1", level: 1, nickname: null, overrides: {}, label: "Liga 1", calendar: CALENDAR,
    settings: { best_of: 3, team_size: 1, min_squad_size: 1, max_staffel_size: 8, scoring_rules: RULES },
    staffeln: [{ tournament_id: "t1", staffel: "A", status: "draft", participant_count: 2, max_participants: 8 }],
  }],
};
const STAFFEL = {
  id: "t1", slug: "duell-season-1-liga-1-a", title: "Duell-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
  format: "league", team_mode: "solo", team_size: 1, min_participants: 2, max_participants: 8, best_of: 3, game_id: "g1",
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" },
  league_links: { league_name: "Duell-Liga", season_name: "Season 1", division_label: "Liga 1", staffel: "A", league_id: "l1",
    season_admin_path: "/admin/leagues/seasons/s1", public_path: "/liga/duell/season-1", staffel_admin_path: "/admin/leagues/staffeln/t1" },
  league_capabilities: ALL, can_edit_staffel: true, can_manage_participants: true, can_manage_structure: true, can_use_staff_tools: true,
};
const PERSONS = [
  { id: "p1", status: "approved", display_name: "Duellant Eins", user_id: "u1", team_id: null, registration_type: "solo", user: { id: "u1", display_name: "Duellant Eins" } },
  { id: "p2", status: "approved", display_name: "Duellantin Zwei mit einem recht langen Anzeigenamen", user_id: "u2", team_id: null, registration_type: "solo",
    user: { id: "u2", display_name: "Duellantin Zwei mit einem recht langen Anzeigenamen" } },
];
const PEOPLE = {
  kind: "solo", max_participants: 8, seats_taken: 2, id_label: "Activision-ID",
  people: [
    { id: "u1", display_name: "Duellant Eins", username: "duellant1", problems: ["Duellant Eins steht schon in dieser Staffel."], notes: [], players: [] },
    { id: "u3", display_name: "Duellant Drei", username: "duellant3", problems: [], notes: ["Duellant Drei: Geburtsdatum fehlt im Profil."],
      players: [{ id: "u3", name: "Duellant Drei", state: "missing", ok: false, text: null }] },
  ],
};

async function mockServer(page, { staffel = {} } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  const calls = [];
  await page.route("**/api/**", json({}));
  for (const name of ["sponsors**", "notifications/me", "games", "partners", "events**"]) await page.route(`**/api/${name}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/admin/my-leagues**", json({ leagues: [{ id: "l1", capabilities: ALL }, { id: "l2", capabilities: ALL }] }));
  await page.route("**/api/admin/leagues", (route) => {
    if (route.request().method() === "POST") {
      calls.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "l3" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(LIST) });
  });
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
  // „Was fehlt noch?“ einer Solo-Season (Nr. 297): Veröffentlichen geht, die Warnung steht deutlich da.
  await page.route("**/api/admin/leagues/seasons/s1/readiness", json({ ok: true, superadmin: true, max_maps: 3, total: null, requirements: [], problems: [],
    warnings: [{ code: "solo_operations_follow", text: "Solo-Liga: Spielbetrieb folgt – Spiele lassen sich noch nicht austragen. Veröffentlichen geht, die Staffeln starten aber erst, wenn Check-in, Veto und Melden für Spieler fertig sind." }] }));
  await page.route("**/api/tournaments/t1/registrations", json(PERSONS));
  await page.route("**/api/tournaments/t1/matches-v2", json([]));
  await page.route("**/api/tournaments/t1/squad-candidates**", json(PEOPLE));
  await page.route("**/api/tournaments/t1/squad-registrations", (route) => {
    calls.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ registration: { id: "p3" }, ids_missing: [] }) });
  });
  await page.route(/\/api\/tournaments\/t1(\?.*)?$/, json({ ...STAFFEL, ...staffel }));
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", fullPage: true, style: ".tls-bottom-nav { display: none !important; }" });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Solo-Liga (${width} px): mit „Spieler (1 gegen 1)“ anlegen, die Team-Liga bleibt Vorgabe`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/leagues");
    await expect(page.getByTestId("league-head-duell")).toContainText("Probe Duell · Spieler (1 gegen 1) · /liga/duell");
    await expect(page.getByTestId("league-head-team")).toContainText("Probe Duell · Co-Teams · /liga/team");
    await noSideScroll(page);
    await shot(page, `liga-uebersicht-${width}`);

    await page.getByTestId("league-add").click();
    const sheet = page.getByTestId("league-create-sheet");
    await sheet.getByTestId("league-name").fill("Duell-Liga Zwei");
    await expect(sheet.getByTestId("league-kind")).toHaveValue("team");
    await sheet.getByTestId("league-kind").selectOption("solo");
    await expect(sheet).toContainText("Jede Person spielt für sich, 1 gegen 1.");
    await noSideScroll(page);
    await shot(page, `liga-anlegen-solo-${width}`);
    await sheet.getByTestId("league-create-save").click();
    await expect.poll(() => calls.find((row) => row.url.endsWith("/admin/leagues"))?.body)
      .toEqual({ name: "Duell-Liga Zwei", game_id: "g1", participant_kind: "solo", description: null });
  });

  test(`Solo-Liga (${width} px): Spiel ohne Einzelspieler - nur Co-Teams, Anfrage wie bisher`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/leagues");
    await page.getByTestId("league-add").click();
    const sheet = page.getByTestId("league-create-sheet");
    await sheet.getByTestId("league-name").fill("Team-Liga Zwei");
    await sheet.getByTestId("league-game").selectOption("g2");
    await expect(sheet.getByTestId("league-kind")).toHaveCount(0);
    await expect(sheet.getByTestId("league-kind-team-only")).toContainText("Co-Teams");
    await sheet.getByTestId("league-create-save").click();
    await expect.poll(() => calls.find((row) => row.url.endsWith("/admin/leagues"))?.body).toEqual({ name: "Team-Liga Zwei", game_id: "g2", description: null });
  });

  test(`Solo-Season (${width} px): Art im Kopf, Warnung in „Was fehlt noch?“, Teamgröße fest, Anmeldung folgt`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/leagues/seasons/s1");
    await expect(page.getByTestId("season-readiness-loud-solo_operations_follow")).toContainText("Solo-Liga: Spielbetrieb folgt");
    await expect(page.getByTestId("season-readiness-state")).toContainText("Bereit zur Veröffentlichung");
    await noSideScroll(page);
    await shot(page, `season-ueberblick-solo-${width}`);
    await page.getByTestId("season-tab-spielbetrieb").click();
    await expect(page.getByTestId("season-head")).toContainText("Probe Duell · Spieler (1 gegen 1)");
    await expect(page.getByTestId("season-form-team-size")).toBeDisabled();
    await noSideScroll(page);
    await page.getByTestId("season-tab-anmeldung").click();
    await expect(page.getByTestId("season-solo-entry-follows")).toContainText("Die Selbstanmeldung als Spieler folgt");
    await expect(page.getByTestId("season-form-min-squad")).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, `season-anmeldung-solo-${width}`);
    await page.getByTestId("season-tab-ligen").click();
    await expect(page.getByTestId("division-1")).toContainText("1 gegen 1 · bis 8 Spieler je Staffel");
    await noSideScroll(page);
    await shot(page, `season-ligen-solo-${width}`);
  });

  test(`Solo-Staffel (${width} px): Spieler zuteilen, „Liga starten“ gesperrt`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await mockServer(page);
    await page.goto("/admin/leagues/staffeln/t1");
    await expect(page.getByTestId("staffel-kind")).toHaveText("Spieler · 1 gegen 1");
    await expect(page.getByTestId("staffel-primary-action")).toBeDisabled();
    await expect(page.getByTestId("staffel-solo-follows")).toContainText("Der Spielbetrieb einer Solo-Liga");
    await noSideScroll(page);
    await shot(page, `staffel-ueberblick-solo-${width}`);

    await page.getByTestId("staffel-tab-teilnehmer").click();
    await expect(page.getByTestId("staffel-teams-count")).toContainText("Spieler 2 von 8");
    await expect(page.getByTestId("squad-assign-open")).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, `staffel-teilnehmer-solo-${width}`);

    await page.getByTestId("person-assign-open").click();
    const dialog = page.getByTestId("person-assign-dialog");
    await dialog.getByTestId("person-assign-search").fill("Duell");
    await expect(dialog.getByTestId("person-assign-person-u1")).toBeDisabled();
    await expect(dialog).toContainText("Duellant Eins steht schon in dieser Staffel.");
    await dialog.getByTestId("person-assign-person-u3").check();
    await noSideScroll(page);
    await shot(page, `staffel-spieler-zuteilen-${width}`);
    await dialog.getByTestId("person-assign-confirm").click();
    await expect.poll(() => calls.find((row) => row.url.endsWith("/squad-registrations"))?.body).toEqual({ user_id: "u3" });
  });

  test(`Team-Staffel (${width} px): Gegenprobe - Co-Team zuteilen und „Liga starten“ wie bisher`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { staffel: { team_mode: "team", team_size: 4 } });
    await page.route("**/api/tournaments/t1/registrations", (route) => route.fulfill({ contentType: "application/json",
      body: JSON.stringify([{ id: "r1", status: "approved", display_name: "Nebelwölfe · Rudel", team_id: "tm1", squad_id: "sq1" }]) }));
    await page.goto("/admin/leagues/staffeln/t1");
    await expect(page.getByTestId("staffel-primary-action")).toBeEnabled();
    await expect(page.getByTestId("staffel-start-note")).toBeVisible();
    await expect(page.getByTestId("staffel-kind")).toHaveCount(0);
    await page.getByTestId("staffel-tab-teilnehmer").click();
    await expect(page.getByTestId("staffel-teams-count")).toContainText("Co-Teams 1 von 8");
    await expect(page.getByTestId("squad-assign-open")).toBeVisible();
    await expect(page.getByTestId("person-assign-open")).toHaveCount(0);
    await noSideScroll(page);
  });
}
