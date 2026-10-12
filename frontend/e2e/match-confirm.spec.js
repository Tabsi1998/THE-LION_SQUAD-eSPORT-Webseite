const { test, expect } = require("@playwright/test");

// Ergebnis der Gegenseite bestätigen (#1159) bei 390 px: „Frostbiss meldet 2:1 für dich. Stimmt das?“ - ein Klick auf
// „Stimmt“, das Spiel ist entschieden und der Sieger steht im nächsten Spiel. Die API ist nachgestellt, die Namen sind
// erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const PROPOSAL = [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 1 }];
const BASE = {
  tournament: { id: "t1", slug: "fc-liga", title: "FC 26 Online-Liga" },
  participants: [{ slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" }, { slot: 2, status: "filled", registration_id: "r2", display_name: "Frostbiss" }],
  matchday_label: "Halbfinale", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: true, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "r1",
};
const OPEN = {
  ...BASE,
  match: { id: "m1", match_key: "HF", status: "in_progress", round_name: "Halbfinale", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  report_state: { status: "confirm", proposal: PROPOSAL, proposal_summary: "NeonFalke gewinnt 2:1.", proposal_text: "Frostbiss meldet 2:1 für dich.",
    proposal_by: "Frostbiss", proposal_at: "2026-10-10T18:39:00+00:00", can_confirm: true },
};
const DONE = {
  ...BASE, can_player_report_result: false, can_report_score: false, report_state: null,
  match: { ...OPEN.match, status: "completed", results: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 1 }] },
};

test.describe("Ergebnis bestätigen", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("bei 390 px: „Stimmt“ entscheidet das Spiel", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-10-10T18:41:00+00:00"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    let confirmed = null;
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill(json({ id: "u1", username: "neonfalke", display_name: "NeonFalke", role: "player" }));
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (path === "/api/matches/m1/page") return route.fulfill(json(confirmed ? DONE : OPEN));
      if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
      if (path === "/api/matches/m1/report" && request.method() === "POST") {
        confirmed = request.postDataJSON();
        return route.fulfill(json({ id: "m1", status: "completed", awaiting_confirmation: false }));
      }
      return route.fulfill(json([]));
    });
    await page.goto("/matches/m1");
    await expect(page.getByTestId("match-report-proposal")).toHaveText("Frostbiss meldet 2:1 für dich.");
    await testInfo.attach("bestaetigen-390.png", { body: await page.screenshot(), contentType: "image/png" });
    await page.getByTestId("match-report-confirm").click();
    await expect(page.getByTestId("match-finished")).toContainText("Beendet");
    expect(confirmed).toEqual({ results: PROPOSAL, screenshot_url: null, note: null });
    await expect(page.getByText("Ergebnis bestätigt – das Spiel ist entschieden.")).toBeVisible();
  });
});
