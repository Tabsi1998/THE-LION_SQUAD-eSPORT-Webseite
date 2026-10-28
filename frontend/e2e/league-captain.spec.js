const { test, expect } = require("@playwright/test");

// Captains in der Liga (#2110) bei 390 und 1440 px: Matchseite mit eigenem Vorschlag („wartet auf die Gegenseite“,
// Zurückziehen), Vorschlag der Gegenseite, Brotkrumen über die Ligaseite und Hinweis nach der Nachtragsfrist; die
// Startseite mit „Terminvorschlag beantworten“ und „Aufstellung nachtragen“. Kein seitlicher Überlauf. Die API ist
// nachgestellt, die Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const me = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" };
const SIDES = [{ registration_id: "a", name: "Loewen Langername · Rudel Alpha" }, { registration_id: "b", name: "Falken mit sehr langem Namen · Horst" }];
const LEAGUES = { leagues: [{ id: "lg1", slug: "probe-liga", name: "Probe-Liga", seasons: [{ id: "s1", slug: "season-1", name: "Season 1" }] }] };
const TOURNAMENT = {
  id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A",
  league_context: { league_id: "lg1", season_id: "s1", division_id: "d1", staffel: "A" },
};
const BASE = {
  tournament: TOURNAMENT,
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0].name }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1].name }],
  matchday_label: "Spieltag 1", collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: true, can_manage_schedule: true, can_dispute: false,
  can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  acting_registration_id: "a", report_state: null,
  match: { id: "m1", match_key: "L1", status: "scheduled", schedule_status: "proposed", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
};
const SCHEDULING = {
  ...BASE,
  schedule_proposals: [
    { id: "p-own", status: "pending", kind: "proposal", actor_registration_id: "a", actor_user_id: "u1", scheduled_at: "2026-11-15T19:00:00+00:00", note: "Sonntag nach dem Training, passt das?", actor: { display_name: "Mila Mustermann" } },
    { id: "p-theirs", status: "pending", kind: "counter", actor_registration_id: "b", actor_user_id: "f1", scheduled_at: "2026-11-16T19:00:00+00:00", actor: { display_name: "Falke mit Langem Namen" } },
    { id: "p-old", status: "declined", kind: "proposal", actor_registration_id: "b", actor_user_id: "f1", scheduled_at: "2026-11-14T19:00:00+00:00", actor: { display_name: "Falke mit Langem Namen" } },
  ],
};
const LATE = {
  ...BASE, schedule_proposals: [],
  match: { ...BASE.match, status: "completed", schedule_status: "accepted", results: [{ registration_id: "a", rank: 2, score: 0 }, { registration_id: "b", rank: 1, score: 2 }] },
  league: {
    best_of: 3, needed: 2, team_size: 4, mode_order: [], pool: { modes: [] }, sides: SIDES, own_registration_id: "a", roster: [], rosters: {},
    own_games: [], proposal_games: [], can_amend_lineup: false, amend_until: "2026-01-02T10:00:00+00:00", lineups_missing: ["a"],
    games: [1, 2].map((position) => ({ position, mode_label: "Stellung", map_name: "Nebelwerk am Fluss", winner_registration_id: "b", scores: {}, lineups: { b: [{ id: "f1", name: "Falke Eins" }] } })),
  },
};
const DASHBOARD = {
  me: {
    tournaments: [], events: [], matches: [], staff_matches: [],
    actions: [
      { id: "match-schedule-m1", type: "match_schedule", label: "Terminvorschlag beantworten", detail: `${TOURNAMENT.title} · gegen ${SIDES[1].name} · Vorschlag Mo 16.11. 20:00`, target_type: "match", target_id: "m1", priority: 8 },
      { id: "match-lineup-m2", type: "match_lineup", label: "Aufstellung nachtragen", detail: `${TOURNAMENT.title} · gegen ${SIDES[1].name} · im Web bis Mi 18.11. 21:00`, target_type: "match", target_id: "m2", priority: 6 },
    ],
  },
  season: null, stats: {},
};

async function setup(page, payload) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json(me));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/leagues") return route.fulfill(json(LEAGUES));
    if (path === "/api/matches/m1/page") return route.fulfill(json(payload));
    if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
    if (path === "/api/mobile/dashboard") return route.fulfill(json(DASHBOARD));
    if (path === "/api/prizes/me/open-count") return route.fulfill(json({ count: 0 }));
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Liga: Captains", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Terminabstimmung und Brotkrumen bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, SCHEDULING);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("match-proposal-status-p-own")).toHaveText(/wartet auf die Gegenseite/);
      await expect(page.getByTestId("match-proposal-withdraw-p-own")).toBeVisible();
      await expect(page.getByTestId("match-proposal-accept-p-theirs")).toBeVisible();
      await expect(page.getByTestId("match-proposal-status-p-old")).toHaveText(/abgelehnt/);
      await expect(page.getByTestId("match-scheduling")).not.toContainText("pending");
      const crumbs = page.getByTestId("breadcrumbs");
      await expect(crumbs.getByRole("link", { name: "Probe-Liga Season 1" })).toHaveAttribute("href", "/liga/probe-liga/season-1");
      await expect(crumbs).not.toContainText("Turniere");
      await expectNoSideScroll(page);
      await testInfo.attach(`termin-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    test(`Nach der Nachtragsfrist bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, LATE);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("league-lineup-closed")).toContainText("Frist zum Nachtragen ist vorbei");
      await page.getByTestId("league-lineup-closed-ask").click();
      await expect(page.getByTestId("match-chat").locator("textarea")).toHaveValue(/@leitung/);
      await expectNoSideScroll(page);
      await testInfo.attach(`nachtrag-vorbei-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    test(`Startseite mit Liga-Aufgaben bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, SCHEDULING);
      await page.goto("/dashboard");
      const actions = page.getByTestId("dashboard-actions");
      await expect(actions.getByText("Terminvorschlag beantworten", { exact: true })).toBeVisible();
      await expect(actions.getByText("Aufstellung nachtragen", { exact: true })).toBeVisible();
      await expect(page.getByTestId("dashboard-action-match-schedule-m1")).toHaveAttribute("href", "/matches/m1");
      await expectNoSideScroll(page);
      await testInfo.attach(`startseite-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
});
