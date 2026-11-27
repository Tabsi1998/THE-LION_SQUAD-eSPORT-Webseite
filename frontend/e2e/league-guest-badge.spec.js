const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Gast-Plakette (#1665, Entscheidung Nr. 286) im echten Browser, Server nachgestellt: Tabelle und Spielplan der Ligaseite, Teams der
// Season, Teamseite und Matchseite mit einem Gastteam einer Schule mit sehr langem Namen und einem Gastteam ohne freigegebenen Namen
// („Gast“ allein). Nichts schiebt die Seite zur Seite, nichts wird abgeschnitten, Vereinsteams bleiben ohne Plakette. Am PC 1440 px und
// am Handy 390 px (chromium) sowie im Gerät „mobile“. GUEST_SHOTS=<Ordner> legt die Bilder ab. Nur erfundene Namen.

const SHOTS = process.env.GUEST_SHOTS || "";
const SCHOOL = "Höhere Technische Bundeslehranstalt für Probeberufe am Probeberg Nord";
const LONG = { label: "Gast", org: SCHOOL };
const ONLY = { label: "Gast", org: null };
const TEAMS = [
  { id: "r1", name: "Probeberg Pixelpiraten · Klasse 4B", team_id: "team-1", guest_badge: LONG },
  { id: "r2", name: "Nebelwölfe · Rudel", team_id: "team-2" },
  { id: "r3", name: "Sturmfalken · Horst", team_id: "team-3", guest_badge: ONLY },
  { id: "r4", name: "Bergdohlen · Schwarm", team_id: "team-4" },
];
const side = (team, score = null) => ({ registration_id: team.id, name: team.name, team_id: team.team_id, score,
  ...(team.guest_badge ? { guest_badge: team.guest_badge } : {}) });
const SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter", modes: [] } },
  season: { name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", matchday_days: 7, best_of: 3, team_size: 4,
    weeks_total: 3, match_points: { win: 3, draw: 0, loss: 0 } },
  look: { emblem_url: null, banner: null, accent_color: null },
  divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [{ tournament_id: "t1", slug: "a", staffel: "A", status: "live" }] }],
};
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const STAFFEL = {
  staffel: { staffel: "A", division_label: "Liga 1", tournament_id: "t1", table_rules: { tiebreakers: ["head_to_head", "score_diff"] } },
  current: 1,
  weeks: [{ week: 1, first_day: day(0), last_day: day(6), kind: "matchday", matchday: 1, label: "Spieltag 1", matches: [
    { id: "m1", matchday: 1, done: true, status: "completed", home: side(TEAMS[0], 2), away: side(TEAMS[1], 1), winner_registration_id: "r1", games: [] },
    { id: "m2", matchday: 1, done: false, status: "scheduled", scheduled_at: `${day(5)}T19:00:00+00:00`, home: side(TEAMS[2]), away: side(TEAMS[3]), games: [] },
  ] }],
  standings: TEAMS.map((team, index) => ({ registration_id: team.id, rank: index + 1, display_name: team.name, team_id: team.team_id, played: 1,
    won: index ? 0 : 1, drawn: 0, lost: index ? 1 : 0, points: index ? 0 : 3, score_for: 2, score_against: 1, score_diff: 1, form: [index ? "L" : "W"],
    ...(team.guest_badge ? { guest_badge: team.guest_badge } : {}) })),
  teams: TEAMS.map((team) => ({ id: team.id, display_name: team.name, team_id: team.team_id, logo_url: null,
    ...(team.guest_badge ? { guest_badge: team.guest_badge } : {}) })),
};
const TEAM = {
  id: "team-1", name: "Probeberg Pixelpiraten", tag: "PPP", leader_id: "p9", co_leader_ids: [], member_ids: ["p9"],
  members: [{ id: "p9", username: "klassensprecherin", display_name: "Klassensprecherin" }], is_member: false, can_manage: false,
  awards: [], featured_award: null, featured_title: null, featured_emblems: [], rank_banners: [], league_history: [], league_overall: [],
  guest_badge: LONG,
};
const MATCH = {
  tournament: { id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A",
    league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" } },
  participants: [
    { slot: 1, status: "filled", registration_id: "r1", display_name: TEAMS[0].name, team: { id: "team-1", name: "Probeberg Pixelpiraten", tag: "PPP" }, guest_badge: LONG },
    { slot: 2, status: "filled", registration_id: "r2", display_name: TEAMS[1].name, team: { id: "team-2", name: "Nebelwölfe", tag: "NW" } },
  ],
  matchday_label: "Spieltag 1", collection: "matches_v2", can_act: false, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false,
  can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  acting_registration_id: null, report_state: null, schedule_proposals: [],
  match: { id: "m1", match_key: "L1", status: "scheduled", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
};

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "streams/live", "teams?**"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues/probe-liga/season-1", json(SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(STAFFEL));
  await page.route("**/api/teams/team-1", json(TEAM));
  await page.route("**/api/teams/team-1/overview", json({ upcoming: [], recent: [], league: [] }));
  await page.route("**/api/matches/m1/page", json(MATCH));
  await page.route("**/api/matches/m1/chat", json([]));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Die Plakette steht ganz da: kein Kürzen mit „…“, kein Text über den eigenen Rand hinaus, und sie bleibt in ihrer Zeile bzw. Karte. */
async function whole(locator, text) {
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(text);
  const box = await locator.evaluate((node) => {
    const own = node.getBoundingClientRect();
    const holder = node.parentElement.getBoundingClientRect();
    return { scroll: node.scrollWidth, client: node.clientWidth, ellipsis: getComputedStyle(node).textOverflow,
      left: own.left - holder.left, right: holder.right - own.right, viewport: window.innerWidth - own.right };
  });
  expect(box.ellipsis).not.toBe("ellipsis");
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
  expect(box.left).toBeGreaterThanOrEqual(-1);
  expect(box.right).toBeGreaterThanOrEqual(-1);
  expect(box.viewport).toBeGreaterThanOrEqual(-1);
  // „Gast“ steht in einer Zeile - nie „GAS/T“ (Prüfung 27.11., 320 px).
  const label = await locator.locator(".tls-guest-badge__label").evaluate((node) => node.getClientRects().length);
  expect(label).toBe(1);
}

/** In schmalen Spalten (Spielplan) am Handy nur „Gast“: eine ruhige Zeile, der Name im title. Ab 640 px der Name dazu. */
async function compactBelow640(locator, width) {
  const box = await locator.evaluate((node) => ({ height: node.getBoundingClientRect().height,
    org: getComputedStyle(node.querySelector(".tls-guest-badge__org")).display, title: node.getAttribute("title") }));
  expect(box.title).toContain(SCHOOL);
  if (width < 640) {
    expect(box.org).toBe("none");
    expect(box.height).toBeLessThanOrEqual(24);
  } else {
    expect(box.org).not.toBe("none");
  }
}

async function shot(page, locator, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Mitte des Fensters: Am Handy deckt die feste Leiste unten sonst den Ausschnitt ab.
  await locator.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(1200);
  await locator.screenshot({ path: path.join(SHOTS, name) });
}

const SIZES = [[320, 640], [390, 844], [1440, 900]];

for (const [width, height] of SIZES) {
  test.describe(`Gast-Plakette bei ${width} px`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "Größe stellt der Test selbst ein - im Gerät „mobile“ läuft der Block unten");
      await page.setViewportSize({ width, height });
      await mockServer(page);
    });

    test("Tabelle und Spielplan der Ligaseite", async ({ page }) => {
      await page.goto("/liga/probe-liga/season-1");
      const staffel = page.getByTestId("league-staffel-A").first();
      await expect(staffel).toBeVisible();
      await whole(page.getByTestId("standing-guest-r1").first(), SCHOOL);
      await expect(page.getByTestId("standing-guest-r3").first()).toHaveText(/^GastGastteam$/);
      await expect(page.getByTestId("standing-guest-r2")).toHaveCount(0);
      await noSideScroll(page);
      const table = page.getByTestId("standing-row-r1").first().locator("xpath=ancestor::table[1]");
      await table.scrollIntoViewIfNeeded();
      await shot(page, table, `tabelle-${width}.png`);
      await page.goto("/liga/probe-liga/season-1/spieltage");
      await whole(page.getByTestId("match-side-guest-r1").first(), SCHOOL);
      await compactBelow640(page.getByTestId("match-side-guest-r1").first(), width);
      await expect(page.getByTestId("match-side-guest-r2")).toHaveCount(0);
      await noSideScroll(page);
      await shot(page, page.getByTestId("match-side-guest-r1").first().locator("xpath=ancestor::*[contains(@class,'tls-league-match__teams')][1]"),
        `spielplan-${width}.png`);
    });

    test("Teams der Season", async ({ page }) => {
      await page.goto("/liga/probe-liga/season-1/teams");
      await whole(page.getByTestId("season-team-r1-guest"), SCHOOL);
      await expect(page.getByTestId("season-team-r2-guest")).toHaveCount(0);
      await noSideScroll(page);
    });

    test("Teamseite", async ({ page }) => {
      await page.goto("/teams/team-1");
      await whole(page.getByTestId("team-guest-badge"), SCHOOL);
      await noSideScroll(page);
      await shot(page, page.getByTestId("team-header-line").locator("xpath=.."), `teamseite-${width}.png`);
    });

    test("Matchseite", async ({ page }) => {
      await page.goto("/matches/m1");
      await whole(page.getByTestId("match-guest-r1"), SCHOOL);
      await expect(page.getByTestId("match-guest-r2")).toHaveCount(0);
      await noSideScroll(page);
      await shot(page, page.getByTestId("match-result-sides"), `spielseite-${width}.png`);
    });
  });
}

test.describe("Gast-Plakette im Gerät „mobile“", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "nur im Gerät");
    await mockServer(page);
  });

  test("Tabelle, Teamseite und Matchseite ohne Überlauf", async ({ page }) => {
    await page.goto("/liga/probe-liga/season-1");
    await whole(page.getByTestId("standing-guest-r1").first(), SCHOOL);
    await noSideScroll(page);
    await page.goto("/teams/team-1");
    await whole(page.getByTestId("team-guest-badge"), SCHOOL);
    await noSideScroll(page);
    await page.goto("/matches/m1");
    await whole(page.getByTestId("match-guest-r1"), SCHOOL);
    await noSideScroll(page);
  });
});
