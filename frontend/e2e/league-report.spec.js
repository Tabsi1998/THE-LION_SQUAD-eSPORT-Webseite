const { test, expect } = require("@playwright/test");

// Liga-Ergebnis je Map (#1650) bei 390 und 1440 px: das Melde-Formular (Map-Kacheln, Sieger, Spieler-Chips) und die
// Anzeige der gespielten Maps passen in die Breite - kein seitlicher Überlauf. Die API ist nachgestellt, die Namen
// sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SIDES = [{ registration_id: "a", name: "Loewen Langername · Rudel Alpha" }, { registration_id: "b", name: "Falken mit sehr langem Namen · Horst" }];
const POOL = {
  modes: [
    { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafenkante" }, { map_id: "nebel", name: "Nebelwerk am Fluss" }, { map_id: "turm", name: "Turm" }] },
    { mode: "suchen", label: "Suchen & Zerstören", maps: [{ map_id: "turm", name: "Turm" }, { map_id: "nebel", name: "Nebelwerk am Fluss" }] },
  ],
};
const ROSTER = [
  { id: "u1", name: "Mila Mustermann" }, { id: "u2", name: "Tom Beispiel" }, { id: "u3", name: "Ida Langername-Doppelname" },
  { id: "u4", name: "Ben" }, { id: "u5", name: "Kai" },
];
const LEAGUE = {
  best_of: 3, needed: 2, team_size: 4, mode_order: ["stellung", "suchen"], pool: POOL, sides: SIDES, own_registration_id: "a",
  roster: ROSTER, rosters: {}, games: [], lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false,
};
const BASE = {
  tournament: { id: "t1", slug: "cod-liga-a", title: "CoD-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0].name }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1].name }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a",
  match: { id: "m1", match_key: "L1", status: "in_progress", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
};
const OPEN = { ...BASE, league: LEAGUE, report_state: { status: "open" } };
const PLAYED = {
  ...BASE, can_player_report_result: false, report_state: null,
  match: { ...BASE.match, status: "completed", results: [{ registration_id: "a", rank: 1, score: 2 }, { registration_id: "b", rank: 2, score: 1 }] },
  league: {
    ...LEAGUE, can_amend_lineup: true, lineups_missing: ["b"],
    games: [1, 2, 3].map((position) => ({
      position, mode_label: position === 2 ? "Suchen & Zerstören" : "Stellung", map_name: "Nebelwerk am Fluss",
      winner_registration_id: position === 2 ? "b" : "a", scores: { a: 250, b: 180 },
      lineups: { a: ROSTER.slice(0, 4) },
    })),
  },
};

async function setup(page, payload) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json({ id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" }));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/matches/m1/page") return route.fulfill(json(payload));
    if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Liga: Ergebnis je Map", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Melde-Formular bei ${width} px ohne seitlichen Überlauf`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, OPEN);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("league-game-1")).toBeVisible();
      await page.getByTestId("league-game-1-map-nebel").click();
      await page.getByTestId("league-game-1-winner-b").click();
      for (const id of ["u1", "u2", "u3", "u4"]) await page.getByTestId(`league-game-1-lineup-${id}`).click();
      await expect(page.getByTestId("league-game-2")).toBeVisible();
      await expectNoSideScroll(page);
      await testInfo.attach(`melden-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    test(`Maps nach dem Ergebnis bei ${width} px ohne seitlichen Überlauf`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, PLAYED);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("league-games-3")).toContainText("Nebelwerk am Fluss");
      await expect(page.getByTestId("league-games-1")).toContainText("Aufstellung fehlt noch");
      await expect(page.getByTestId("league-lineup-amend")).toBeVisible();
      await expectNoSideScroll(page);
      await testInfo.attach(`maps-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
});
