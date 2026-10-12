const { test, expect } = require("@playwright/test");

// Problem melden (#1158) bei 390 px: ein Spieler meldet mit Grund und Text, die Turnierleitung öffnet den Fall über
// seine eigene Adresse (?fall=ds-…), sieht Meldung, Foto und Ergebnis und entscheidet mit einem Tipp. Die API ist
// nachgestellt, die Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const MATCH_PAGE = {
  tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" },
  match: { id: "m1", match_key: "HF-B", status: "completed", round_name: "Halbfinale B", slots: [{ slot: 1, registration_id: "r3" }, { slot: 2, registration_id: "r4" }],
    results: [{ registration_id: "r4", rank: 1, score: 2 }, { registration_id: "r3", rank: 2, score: 1 }] },
  participants: [{ slot: 1, status: "filled", registration_id: "r3", display_name: "TurboTina" }, { slot: 2, status: "filled", registration_id: "r4", display_name: "Frostbiss" }],
  matchday_label: "Halbfinale B", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: true,
  dispute_until: "2026-10-10T13:40:00+00:00", can_forfeit: false, allows_draw: false, event_mode: "local", result_entry_mode: "staff_only",
  schedule_mode: "fixed_by_staff", acting_registration_id: "r3",
};

const CASE = {
  id: "m1", label: "Halbfinale B", stage_name: "K.-o.", status: "disputed", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false,
  participants: [{ registration_id: "r3", name: "TurboTina" }, { registration_id: "r4", name: "Frostbiss" }], advance: {}, has_result: true,
  result: [{ registration_id: "r4", rank: 1, score: 2 }, { registration_id: "r3", rank: 2, score: 1 }], result_summary: "Frostbiss gewinnt 2:1.",
  station_text: "PC 4", timing: {}, can_enter: true,
  dispute: { by: "TurboTina", at: "2026-10-10T13:12:00+00:00", category: "wrong_result", category_label: "Falsches Ergebnis",
    text: "Es stand 2:1 für mich, nicht 1:2.", photo: null, result_by: "Ergebnisdienst", result_at: "2026-10-10T13:06:00+00:00", reports: [] },
};

test.describe("Problem melden und entscheiden", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("Spieler meldet, Turnierleitung entscheidet mit einem Tipp", async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-10-10T13:10:00+00:00"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(consent);
    let user = { id: "u3", username: "turbotina", display_name: "TurboTina", role: "player" };
    let dispute = null;
    let decision = null;
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me") return route.fulfill(json(user));
      if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (path === "/api/matches/m1/page") return route.fulfill(json(dispute ? { ...MATCH_PAGE, can_dispute: false, in_dispute: true, match: { ...MATCH_PAGE.match, status: "disputed" } } : MATCH_PAGE));
      if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
      if (path === "/api/matches/m1/dispute" && request.method() === "POST") {
        dispute = request.postDataJSON();
        return route.fulfill(json({ id: "m1", status: "disputed" }));
      }
      if (path === "/api/tournaments/fc-cup/lead") {
        const cases = decision ? [] : [{ id: "ds-m1", kind: "dispute", match_id: "m1", title: "Streitfall gemeldet", detail: "TurboTina: „Falsches Ergebnis“", action: "view", station_text: "PC 4", label: "Halbfinale B", names: "TurboTina gegen Frostbiss" }];
        return route.fulfill(json({ tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: decision ? [] : [CASE], attention: cases, stations: [], recent: [], counts: { open: decision ? 0 : 1, running: 0, missing: 0, disputes: decision ? 0 : 1, attention: cases.length } }));
      }
      if (path === "/api/matches/m1/dispute/decision" && request.method() === "POST") {
        decision = request.postDataJSON();
        return route.fulfill(json({ ok: true, decision: "keep", status: "completed" }));
      }
      return route.fulfill(json([]));
    });

    await page.goto("/matches/m1");
    await page.getByTestId("match-dispute-reason-wrong_result").click();
    await page.getByTestId("match-dispute-input").fill("Es stand 2:1 für mich, nicht 1:2.");
    await testInfo.attach("problem-melden-390.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByTestId("match-dispute-btn").click();
    await expect(page.getByTestId("match-in-dispute")).toBeVisible();
    expect(dispute).toEqual({ reason: "Es stand 2:1 für mich, nicht 1:2.", category: "wrong_result", photo_id: null });

    user = { id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true };
    await page.goto("/tournaments/fc-cup/leitung?fall=ds-m1");
    const card = page.getByTestId("lead-dispute-m1");
    await expect(card).toContainText("Falsches Ergebnis");
    await expect(card).toContainText("Eingetragen: Frostbiss gewinnt 2:1.");
    await testInfo.attach("streitfall-karte-390.png", { body: await page.screenshot(), contentType: "image/png" });
    await page.getByTestId("lead-dispute-note-m1").fill("Foto zeigt 1:2");
    await page.getByTestId("lead-dispute-keep-m1").click();
    await expect(page.getByText("Entschieden – beide Seiten bekommen Bescheid.")).toBeVisible();
    expect(decision).toEqual({ decision: "keep", note: "Foto zeigt 1:2" });
    await expect(page.getByTestId("lead-dispute-m1")).toHaveCount(0);
  });
});
