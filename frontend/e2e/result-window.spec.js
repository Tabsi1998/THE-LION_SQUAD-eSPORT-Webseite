const { test, expect } = require("@playwright/test");

// Ein Ergebnis-Fenster für alle Wege (#1370) bei 390, 768 und 1440 px: ein Ergebnis über die Station und eines über den
// Matchplan - dasselbe Fenster, dieselbe Anfrage. Am Handy und Tablet ein Blatt von unten, am PC in der Mitte. Die API
// ist nachgestellt, die Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const TOURNAMENT = { id: "t1", slug: "rl-cup", title: "Rocket League 2v2", status: "live", format: "single_elim", team_mode: "solo", max_participants: 8, can_manage_structure: true, can_manage_results: true };
const REGS = [{ id: "r1", tournament_id: "t1", display_name: "Lions Rocket", status: "checked_in" }, { id: "r2", tournament_id: "t1", display_name: "Boost und Burger", status: "checked_in" }];
const MATCH = {
  id: "m1", tournament_id: "t1", stage_id: "s1", match_key: "VF-1", round: 1, round_name: "Viertelfinale", section: "main", status: "in_progress",
  station_id: "pc3", slots: [{ slot: 1, status: "filled", registration_id: "r1" }, { slot: 2, status: "filled", registration_id: "r2" }],
};
const ENTRY = {
  id: "m1", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, has_result: false, result: [], label: "Viertelfinale", station_text: "PC 3",
  participants: [{ registration_id: "r1", name: "Lions Rocket" }, { registration_id: "r2", name: "Boost und Burger" }], advance: { 1: { text: "ins Halbfinale", flow: "W" } },
};

async function mockAdmin(page, saved) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json({ id: "a1", username: "leitung", display_name: "Turnierleitung", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true }));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/matches/m1/page") return route.fulfill(json({ match: MATCH, result_entry: ENTRY }));
    if (path === "/api/matches/m1/result" && request.method() === "POST") {
      saved.push(request.postDataJSON());
      return route.fulfill(json({ ok: true, held: true, hold: { id: `h${saved.length}` } }));
    }
    if (path === "/api/tournaments") return route.fulfill(json([TOURNAMENT]));
    if (path === "/api/stations") return route.fulfill(json([{ id: "pc3", name: "PC 3", device_type: "pc", tournament_id: "t1", status: "busy", current_match_id: "m1" }]));
    if (path === "/api/tournaments/t1") return route.fulfill(json(TOURNAMENT));
    if (path === "/api/tournaments/t1/registrations") return route.fulfill(json(REGS));
    if (path === "/api/tournaments/t1/bracket") return route.fulfill(json({ tournament: TOURNAMENT, matches_v2: [MATCH], registrations: REGS, stages: [], rounds: [] }));
    if (path === "/api/tournaments/t1/stages") return route.fulfill(json([{ id: "s1", tournament_id: "t1", name: "K.-o.", stage_type: "single_elimination", stage_number: 1, status: "live", settings: {} }]));
    if (path === "/api/tournaments/t1/matches-v2") return route.fulfill(json([MATCH]));
    if (path.endsWith("/planning-check")) return route.fulfill(json({ ok: true, warnings: [], errors: [] }));
    return route.fulfill(json([]));
  });
}

async function enterThreeOne(page, width) {
  const sheet = page.getByTestId("result-window");
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  if (width >= 1280) expect(box.y + box.height).toBeLessThan(viewport.height - 20);
  else expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
  for (let step = 0; step < 3; step += 1) await page.getByTestId("result-score-r1-plus").click();
  await page.getByTestId("result-score-r2-plus").click();
  await expect(page.getByTestId("result-sentence")).toHaveText("Lions Rocket gewinnt 3:1 – weiter ins Halbfinale");
  await page.getByTestId("result-save").click();
  await expect(page.getByTestId("result-undo-bar")).toBeVisible();
}

test.describe("Ein Ergebnis-Fenster für alle Wege", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 768, 1440]) {
    test(`Station und Matchplan bei ${width} px: dasselbe Fenster, dieselbe Anfrage`, async ({ page }, testInfo) => {
      await page.clock.setFixedTime(new Date("2026-10-10T13:12:00+00:00"));
      await page.setViewportSize({ width, height: width < 800 ? 900 : 900 });
      const saved = [];
      await mockAdmin(page, saved);

      await page.goto("/admin/stations");
      await page.getByTestId("station-result-pc3").click();
      await enterThreeOne(page, width);
      await testInfo.attach(`ergebnis-fenster-station-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });

      await page.goto("/admin/tournaments/t1?tab=stages");
      await page.getByTestId("matchplan-result-m1").click();
      await enterThreeOne(page, width);

      expect(saved).toHaveLength(2);
      expect(saved[0]).toEqual(saved[1]);
      expect(saved[0]).toEqual({ results: [{ registration_id: "r1", rank: 1, score: 3 }, { registration_id: "r2", rank: 2, score: 1 }], hold: true, reason: null });
      await expect(page.locator("body")).not.toContainText("DNF");
    });
  }
});
