const { test, expect } = require("@playwright/test");

// Liga-Check-in (#1652) bei 390 und 1440 px mit nachgestellter API: Matchseite mit offenem Fenster (Countdown, Anwesende anhaken,
// Einchecken), beide eingecheckt (Start), Regelwerks-Sperre, abgelaufen mit Vorschlag und Notfall-Eintrag der Leitung, „Mein Dienst“
// mit „Check-in abgelaufen“. Kein seitlicher Überlauf. Erfundene Namen.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" };
const LEAD = { id: "lead", username: "leitung", display_name: "Liga Leitung", role: "tournament_admin", areas: ["leagues"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 3, remind_minutes_before_close: 5 };
const SIDES = ["Loewen mit sehr langem Namen · Rudel Alpha", "Falken mit sehr langem Namen · Horst"];
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const ROSTER = [
  { id: "u1", name: "Mila Mustermann", blocked: null }, { id: "u2", name: "Tom Testfalke mit langem Namen", blocked: null },
  { id: "u3", name: "Ida Beispiel", blocked: null }, { id: "u4", name: "Jonas Probe", blocked: "Neu im Kader: darf ab 20.11.2026, 00:00 spielen." },
];
const OWN = { registration_id: "a", name: SIDES[0], own: true, checked_in: false, present: [], present_count: 0, consent_open: false, rules_url: "/liga/probe/season-1/regeln" };
const OTHER = { registration_id: "b", name: SIDES[1], own: false, checked_in: true, at: inMinutes(-3), present: [{ id: "f1", name: "Falke Eins" }, { id: "f2", name: "Falke Zwei" }, { id: "f3", name: "Falke Drei" }], present_count: 3, consent_open: false };
const OPEN = {
  rules: RULES, state: "open", scheduled_at: inMinutes(5), window: { opens_at: inMinutes(-10), closes_at: inMinutes(20) }, ready_at: null, started_at: null,
  sides: [OWN, OTHER], own_registration_id: "a", can_checkin: true, checkin_hint: null, roster: ROSTER, min_present: 3, can_start: false,
  start_hint: "Starten geht erst, wenn beide Seiten eingecheckt sind.", proposal: null, lead: null,
};
const PAGE = {
  tournament: { id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0] }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1] }],
  matchday_label: "Spieltag 2", collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false,
  can_forfeit: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  acting_registration_id: "a", report_state: null, schedule_proposals: [], schedule_block: null,
  match: { id: "m1", match_key: "L2", status: "scheduled", schedule_status: "accepted", schedule_source: "accepted", scheduled_at: inMinutes(5),
    slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
  checkin: OPEN,
};
const DUTY = {
  assignments: [], leagues: [], series: [], moderation: null, lead_today: [], ended_live: [], overdue_matches: [],
  checkin_proposals: [{ match_id: "m1", tournament_id: "t1", title: PAGE.tournament.title, label: "Spieltag 2", scheduled_at: inMinutes(-40), due_at: inMinutes(-25),
    missing: [SIDES[0]], url: "/matches/m1", lead_url: "/tournaments/probe-liga-a/leitung?fall=ns-m1" }],
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
      return route.fulfill(json({ ok: true, ready: false, idempotent_replay: false }));
    }
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Liga: Check-in und Start", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`offen: Countdown, Anwesende anhaken, Einchecken bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      await setup(page, CAPTAIN, PAGE, posts);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-headline")).toHaveText("Check-in offen");
      await expect(page.getByTestId("checkin-countdown-text")).toHaveText(/^\d+:\d\d$/);
      await expect(page.getByTestId("checkin-side-b")).toHaveAttribute("data-checked", "true");
      await expect(page.getByTestId("checkin-side-status-b")).toContainText("3 Spieler");
      await expect(page.getByTestId("checkin-roster-u4")).toBeDisabled();
      await expect(page.getByTestId("checkin-submit")).toBeDisabled();
      for (const id of ["u1", "u2"]) await page.getByTestId(`checkin-roster-${id}`).check();
      await expect(page.getByTestId("checkin-roster-count")).toContainText("noch eine Person");
      await page.getByTestId("checkin-roster-u3").check();
      await expect(page.getByTestId("checkin-roster-count")).toContainText("das reicht");
      await expectNoSideScroll(page);
      await testInfo.attach(`checkin-offen-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByTestId("checkin-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/checkin")?.body).toEqual({ present: ["u1", "u2", "u3"] });
    });

    test(`beide da: Spiel starten; Regelwerks-Sperre hält auf bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      const ready = { ...OPEN, state: "ready", ready_at: inMinutes(-1), can_start: true, start_hint: null,
        sides: [{ ...OWN, checked_in: true, at: inMinutes(-1), present: ROSTER.slice(0, 3).map(({ id, name }) => ({ id, name })), present_count: 3 }, OTHER] };
      await setup(page, CAPTAIN, { ...PAGE, checkin: ready }, posts);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-headline")).toHaveText("Spielbereit");
      await expect(page.getByTestId("checkin-countdown")).toHaveCount(0);
      await testInfo.attach(`checkin-bereit-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByTestId("checkin-start-button").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/checkin/start")?.method).toBe("POST");
      await expectNoSideScroll(page);

      await page.unrouteAll({ behavior: "ignoreErrors" });
      const blocked = { ...OPEN, can_checkin: false, checkin_hint: "Das Regelwerk hat sich geändert – bitte erst zustimmen.", sides: [{ ...OWN, consent_open: true }, OTHER] };
      await setup(page, CAPTAIN, { ...PAGE, checkin: blocked });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-hint")).toContainText("Das Regelwerk hat sich geändert");
      await expect(page.getByTestId("checkin-rules-link")).toHaveAttribute("href", "/liga/probe/season-1/regeln");
      await expect(page.getByTestId("checkin-submit")).toHaveCount(0);
      await expectNoSideScroll(page);
      await testInfo.attach(`checkin-regelwerk-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    // Fehlende Angaben sperren erst beim Spielen (#2313): eigener Grund mit Weg ins Profil, zu wenige Spielberechtigte als Satz.
    test(`gesperrt: eigener Grund mit Weg ins Profil, zu wenige spielberechtigt bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const short = "Nur 2 Spieler dürfen aus eurem Kader gerade spielen, mindestens 3 müssen anwesend sein – so könnt ihr nicht einchecken. "
        + "Wer grau steht, trägt die fehlende Angabe im eigenen Profil nach, dann geht es sofort.";
      const roster = [{ ...ROSTER[0], blocked: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein." }, ...ROSTER.slice(1)];
      const locked = { ...OPEN, can_checkin: false, checkin_hint: short, roster_hint: short, eligible_count: 2, roster,
        me: { reason: "Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein.", state: "age_missing", fix_url: "/profile?tab=basic" } };
      await setup(page, CAPTAIN, { ...PAGE, checkin: locked });
      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-me")).toContainText("Du kannst so nicht einchecken");
      await expect(page.getByTestId("checkin-me-fix")).toHaveAttribute("href", "/profile?tab=basic");
      await expect(page.getByTestId("checkin-hint")).toContainText("Nur 2 Spieler");
      await expect(page.getByTestId("checkin-roster-u1")).toBeDisabled();
      await expect(page.getByTestId("checkin-submit")).toHaveCount(0);
      await expectNoSideScroll(page);
      await testInfo.attach(`checkin-gesperrt-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    test(`Leitung: abgelaufen mit Vorschlag, Notfall-Eintrag und „Mein Dienst“ bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      const closed = { ...OPEN, state: "closed", scheduled_at: inMinutes(-40), window: { opens_at: inMinutes(-55), closes_at: inMinutes(-25) },
        own_registration_id: null, can_checkin: false, checkin_hint: null, roster: [], sides: [{ ...OWN, own: false }, OTHER],
        proposal: { due_at: inMinutes(-25), missing: [SIDES[0]] },
        lead: { can_enter: true, conflict: null, rosters: { a: ROSTER, b: [{ id: "f1", name: "Falke Eins", blocked: null }] } } };
      await setup(page, LEAD, { ...PAGE, acting_registration_id: null, checkin: closed }, posts);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("checkin-headline")).toHaveText("Check-in geschlossen");
      await expect(page.getByTestId("checkin-proposal")).toContainText("hat nicht eingecheckt");
      await expect(page.getByTestId("checkin-proposal-decide")).toHaveAttribute("href", "/tournaments/probe-liga-a/leitung?fall=ns-m1");
      await expect(page.getByTestId("checkin-lead-side-a")).toHaveAttribute("aria-pressed", "true");
      for (const id of ["u1", "u2", "u3"]) await page.getByTestId(`checkin-lead-roster-${id}`).check();
      await page.getByTestId("checkin-lead-reason").fill("Captain ohne Netz, per Telefon bestätigt");
      await expectNoSideScroll(page);
      await testInfo.attach(`checkin-leitung-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByTestId("checkin-lead-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/checkin")?.body).toEqual({
        present: ["u1", "u2", "u3"], registration_id: "a", reason: "Captain ohne Netz, per Telefon bestätigt" });

      await page.goto("/admin/dienst");
      await expect(page.getByTestId("duty-checkin-m1")).toContainText("Check-in abgelaufen: Spieltag 2");
      await expect(page.getByTestId("duty-checkin-open-m1")).toHaveAttribute("href", "/tournaments/probe-liga-a/leitung?fall=ns-m1");
      await expectNoSideScroll(page);
      await testInfo.attach(`dienst-checkin-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
});
