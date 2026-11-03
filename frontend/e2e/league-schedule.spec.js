const { test, expect } = require("@playwright/test");

// Liga-Termine (#2194) bei 390 und 1440 px mit nachgestellter API: Matchseite mit festem Termin (Grenze im Klartext, Antrag mit
// Grund, Verlauf), Antwort der Gegenseite, Hinweis auf die Leitung, „Termin festlegen“ der Leitung; „Mein Dienst“ mit
// „Braucht deine Entscheidung“. Kein seitlicher Überlauf. Erfundene Namen.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" };
const LEAD = { id: "lead", username: "leitung", display_name: "Liga Leitung", role: "tournament_admin", areas: ["leagues"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 24, reschedule_max: 2, reschedule_same_week: true, result_reminder_hours: 24, result_overdue_hours: 48 };
const AT = "2030-11-14T19:00:00+00:00";
const SIDES = ["Loewen mit sehr langem Namen · Rudel Alpha", "Falken mit sehr langem Namen · Horst"];
const BLOCK = {
  rules: RULES, fixed: true, source: "accepted", scheduled_at: AT, window: { start: "2030-11-11T23:00:00+00:00", end: "2030-11-18T23:00:00+00:00" },
  count: 1, remaining: 1, request_until: "2030-11-13T19:00:00+00:00", can_request: true, request_hint: null, requests: [],
  history: [
    { id: "h2", kind: "reschedule", to: AT, from: "2030-11-13T19:00:00+00:00", by_name: "Falke mit Langem Namen", side_name: SIDES[1], reason: "Zwei Spieler auf Dienstreise", at: "2030-11-10T10:00:00+00:00" },
    { id: "h1", kind: "agreement", to: "2030-11-13T19:00:00+00:00", by_name: "Falke mit Langem Namen", side_name: SIDES[1], at: "2030-11-09T10:00:00+00:00" },
  ],
  home_rule_at: null, own_registration_id: "a", can_lead_set: false,
};
const PAGE = {
  tournament: { id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0] }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1] }],
  matchday_label: "Spieltag 2", collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false,
  can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  acting_registration_id: "a", report_state: null, schedule_proposals: [],
  match: { id: "m1", match_key: "L2", status: "scheduled", schedule_status: "accepted", schedule_source: "accepted", scheduled_at: AT,
    slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  schedule_block: BLOCK,
};
const OPEN = { id: "r2", status: "pending", from_at: AT, to_at: "2030-11-15T19:00:00+00:00", reason: "Server-Wartung am Abend", side_name: SIDES[1],
  requested_by_name: "Falke mit Langem Namen", own: false, can_answer: true, can_withdraw: false };
const DUTY = {
  assignments: [], leagues: [], series: [], moderation: null, lead_today: [],
  ended_live: [{ id: "t9", title: "Mario Kart Autumn Cup mit langem Namen", end_date: "2026-10-31T22:00:00Z", open_matches: 0, admin_url: "/admin/tournaments/t9" }],
  overdue_matches: [{ match_id: "m1", tournament_id: "t1", title: PAGE.tournament.title, label: "Spieltag 2", scheduled_at: AT, url: "/matches/m1" }],
};

async function setup(page, user, payload, posts = []) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json(user));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/leagues") return route.fulfill(json({ leagues: [] }));
    if (path === "/api/matches/m1/page") return route.fulfill(json(payload));
    if (path === "/api/matches/m1/chat") return route.fulfill(json([]));
    if (path === "/api/users/me/duty") return route.fulfill(json(DUTY));
    if (path === "/api/friends") return route.fulfill(json({ incoming: [], friends: [], outgoing: [] }));
    if (request.method() !== "GET") {
      posts.push({ path, method: request.method(), body: request.postDataJSON() });
      return route.fulfill(json({ ok: true }));
    }
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Liga: Termine und Verschiebung", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`fester Termin: Grenze, Antrag mit Grund, Verlauf bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const posts = [];
      await setup(page, CAPTAIN, PAGE, posts);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("schedule-limit")).toHaveText("Noch 1 Verschiebung möglich, beantragen bis Mi 13.11. 20:00.");
      await expect(page.getByTestId("schedule-week")).toContainText("Di 12.11. 00:00 bis Mo 18.11. 23:59");
      await expect(page.getByTestId("match-proposal-at")).toHaveCount(0);
      await expect(page.getByTestId("schedule-history-reschedule")).toContainText("Zwei Spieler auf Dienstreise");
      await page.getByTestId("reschedule-form-at").fill("2030-11-15T20:00");
      await page.getByTestId("reschedule-form-submit").click();
      await expect(page.getByTestId("reschedule-form-problem")).toContainText("Grund");
      await page.getByTestId("reschedule-form-reason").fill("Turnier am Wochenende");
      await page.getByTestId("reschedule-form-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/reschedule")?.body).toEqual({
        scheduled_at: "2030-11-15T19:00:00.000Z", reason: "Turnier am Wochenende" });
      await expectNoSideScroll(page);
      await testInfo.attach(`verschiebung-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    test(`Gegenseite stimmt zu, aufgebraucht führt zur Leitung bei ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const posts = [];
      await setup(page, CAPTAIN, { ...PAGE, schedule_block: { ...BLOCK, can_request: false, request_hint: "Es ist schon eine Verschiebung offen – erst muss darüber entschieden werden.", requests: [OPEN] } }, posts);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("reschedule-status-r2")).toContainText("wartet auf Zustimmung");
      await page.getByTestId("reschedule-accept-r2").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/reschedule/r2/decision")?.body).toEqual({ action: "accept" });
      await expectNoSideScroll(page);

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await setup(page, CAPTAIN, { ...PAGE, schedule_block: { ...BLOCK, remaining: 0, can_request: false,
        request_hint: "Dieses Spiel wurde schon 2-mal verschoben. Das entscheidet die Liga-Leitung – bitte im Matchchat @leitung schreiben." } });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("schedule-limit")).toContainText("Keine Verschiebung mehr möglich");
      await page.getByTestId("reschedule-hint").getByRole("button", { name: "@leitung schreiben" }).click();
      await expect(page.getByTestId("match-chat").locator("textarea")).toHaveValue(/@leitung/);
      await expectNoSideScroll(page);
    });

    test(`Leitung: Termin festlegen und „Braucht deine Entscheidung“ bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const posts = [];
      await setup(page, LEAD, { ...PAGE, acting_registration_id: null, schedule_block: { ...BLOCK, can_request: false, own_registration_id: null, can_lead_set: true } }, posts);
      await page.goto("/matches/m1");
      await page.getByTestId("lead-schedule-form-at").fill("2030-11-17T20:00");
      await page.getByTestId("lead-schedule-form-reason").fill("Dritte Verschiebung, Leitung entscheidet");
      await page.getByTestId("lead-schedule-form-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1")?.body).toEqual({
        scheduled_at: "2030-11-17T19:00:00.000Z", schedule_reason: "Dritte Verschiebung, Leitung entscheidet" });
      await expectNoSideScroll(page);

      await page.goto("/admin/dienst");
      await expect(page.getByTestId("duty-ended-t9")).toContainText("Läuft laut Stand noch, Ende war am Sa 31.10.2026, 23:00");
      await expect(page.getByTestId("duty-ended-open-t9")).toHaveAttribute("href", "/admin/tournaments/t9");
      await expect(page.getByTestId("duty-overdue-m1")).toContainText("Überfällig: Spieltag 2");
      await expectNoSideScroll(page);
      await testInfo.attach(`dienst-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
});
