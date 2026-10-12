const { test, expect } = require("@playwright/test");

// Spieler melden mit Foto (#1157): bei 390 px große Plus/Minus-Knöpfe, ein Foto vom Ergebnis, der Satz vor dem
// Absenden - danach „Deine Meldung ist da – wartet auf die Gegenseite“. Die API ist nachgestellt, die Namen sind
// erfunden; das Foto ist ein kleines erzeugtes PNG.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const ENTRY = {
  id: "m1", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, label: "Halbfinale A",
  participants: [{ registration_id: "r1", name: "NeonFalke" }, { registration_id: "r2", name: "PixelPanther" }], advance: {},
};
const PAGE = {
  tournament: { id: "t1", slug: "fc-online-cup", title: "FC 26 Online-Cup" },
  match: { id: "m1", match_key: "HF-A", status: "in_progress", round_name: "Halbfinale A", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [{ slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" }, { slot: 2, status: "filled", registration_id: "r2", display_name: "PixelPanther" }],
  matchday_label: "Halbfinale A", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: true, can_player_report_result: true,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "r1",
  report_entry: ENTRY, report_state: { status: "open", own_summary: null, proposal: null, proposal_summary: null },
};

test.describe("Ergebnis melden mit Foto", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("bei 390 px: Knöpfe, Foto, Satz, melden", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-10-10T19:00:00+00:00"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    let reported = null;
    let uploads = 0;
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill(json({ id: "u1", username: "neonfalke", display_name: "NeonFalke", role: "player" }));
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (path === "/api/matches/m1/page") {
        return route.fulfill(json(reported ? { ...PAGE, report_state: { status: "waiting", own_summary: "NeonFalke gewinnt 2:1.", proposal: null, proposal_summary: null } } : PAGE));
      }
      if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
      if (path === "/api/matches/m1/proof-photos" && request.method() === "POST") {
        uploads += 1;
        return route.fulfill(json({ id: "p1", url: "/api/matches/m1/proof-photos/p1", scan_state: "safe" }));
      }
      if (path === "/api/matches/m1/report" && request.method() === "POST") {
        reported = request.postDataJSON();
        return route.fulfill(json({ awaiting_confirmation: true, report_status: "waiting" }));
      }
      return route.fulfill(json([]));
    });
    await page.goto("/matches/m1");

    await expect(page.getByTestId("match-report-form")).toBeVisible();
    await page.getByTestId("result-score-r1-plus").click();
    await page.getByTestId("result-score-r1-plus").click();
    await page.getByTestId("result-score-r2-plus").click();
    await expect(page.getByTestId("match-report-sentence")).toHaveText("NeonFalke gewinnt 2:1");
    await page.getByTestId("proof-photo-input").setInputFiles({ name: "ergebnis.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("proof-photo-state")).toHaveText("Foto angehängt – sehen nur die Gegenseite und die Turnierleitung.");
    expect(uploads).toBe(1);
    await testInfo.attach("melden-mit-foto-390.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByTestId("match-report-submit").click();
    await expect(page.getByTestId("match-report-state")).toContainText("Deine Meldung ist da – wartet auf die Gegenseite.");
    expect(reported).toEqual({
      results: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 1 }],
      screenshot_url: null, note: null, photo_id: "p1",
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
