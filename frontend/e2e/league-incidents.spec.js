const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Vorfälle im Spiel (D.5, #1619) bei 390 und 1440 px mit nachgestellter API: Captain meldet geführt, die Gegenseite antwortet mit
// Countdown, die Liga-Leitung entscheidet und stellt die Serie fest, Gäste lesen nur „in Klärung“, „Mein Dienst“ nennt die Fälle.
// Kein seitlicher Überlauf, auch mit langen Namen; mit „Bewegung reduzieren“ steht alles still. Erfundene Namen.
// Bilder: E2E_SCREENS_DIR=<Ordner> legt je Zustand ein Bild der Fläche ab.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player" };
const LEAD = { id: "lead", username: "leitung", display_name: "Liga Leitung", role: "tournament_admin", areas: ["leagues"], mfa_enabled: true, auth_mfa_verified: true };
const NAMES = ["Loewen mit sehr langem Namen · Rudel Alpha", "Falken mit sehr langem Namen · Horst"];
const SIDES = [{ registration_id: "a", name: NAMES[0] }, { registration_id: "b", name: NAMES[1] }];
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const KINDS = [["disconnect", "Verbindungsabbruch"], ["rehost", "Rehost"], ["pause", "Technische Pause"], ["moss_crash", "MOSS-Absturz"],
  ["restart_early", "Abbruch in der frühen Phase"], ["replay", "Map soll wiederholt werden"], ["other", "Sonstiges"]].map(([key, label]) => ({ key, label }));
const PROPOSALS = [["continue_at_score", "Beim Stand fortsetzen"], ["rehost", "Rehost beim Stand"], ["restart", "Neustart (frühe Phase)"], ["replay", "Map wiederholen"]]
  .map(([key, label]) => ({ key, label }));
const OUTCOMES = [...PROPOSALS, { key: "awarded", label: "Map zugesprochen" }, { key: "no_action", label: "Keine Maßnahme – die Map gilt wie gemeldet" }];
const INFO = {
  can_report: true, as_lead: false, can_decide: false, conflict: null, kinds: KINDS, proposals: PROPOSALS, outcomes: OUTCOMES, answer_minutes: 10,
  clarification_mode: "continue", break_after: 2, break_minutes: 5, quota: { limit: 1, used: [] }, hold: null,
};
const ROSTER = [{ id: "u1", name: "Mila Mustermann" }, { id: "u2", name: "Tom Testfalke mit langem Namen" }, { id: "u3", name: "Ida Beispiel" }];
const LEAGUE = {
  lineup_mode: "series", lineup_min_players: 3, participants: {}, own_lineup: [], best_of: 3, needed: 2, team_size: 4, mode_order: [], pool: { modes: [] },
  sides: SIDES, own_registration_id: "a", roster: ROSTER, rosters: {}, games: [], planned_games: [{ position: 2, map_name: "Funkturm bei Nacht" }], lineups_missing: [],
  own_games: [], proposal_games: [], can_amend_lineup: false, lobby_ids: [], map_repeat: "always",
};
const HOLD = { code: "in_review", position: 2, text: "Map 2 ist in Klärung – die Liga-Leitung entscheidet. Bis dahin gilt kein Ergebnis." };

function incident(extra = {}) {
  return {
    id: "v1", position: 2, kind: "disconnect", kind_label: "Verbindungsabbruch", between_maps: false, minutes: null, at: inMinutes(-2), score: { a: 3, b: 4 }, round: 8,
    players: [{ id: "f2", name: "Falke Zwei mit langem Namen" }], note: "Falke Zwei ist in Runde 8 aus der Lobby geflogen, Ursache war ein Ausfall beim Anbieter.",
    proposal: "rehost", proposal_label: "Rehost beim Stand", reported_by: { registration_id: "b", name: NAMES[1], own: false }, state: "proposed", open: true,
    expired: false, answer_deadline: inMinutes(8), answer: null, review_cause: null, counts_quota: true, decision: null, voided: null, closed_at: null, procedure: false,
    can_answer: false, can_withdraw: false, can_decide: false, can_settle: false, ...extra,
  };
}

function matchPage({ incidents = [], info = {}, league = {}, page = {} } = {}) {
  const clarifying = incidents.filter((row) => row.state === "in_review").map((row) => row.position);
  return {
    tournament: { id: "t1", slug: "probe-liga-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A" },
    participants: SIDES.map((side, index) => ({ slot: index + 1, status: "filled", registration_id: side.registration_id, display_name: side.name })),
    matchday_label: "Spieltag 2", collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false, can_submit_result: false,
    can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false, allows_draw: false,
    event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "a", report_state: null,
    schedule_proposals: [], schedule_block: null,
    match: { id: "m1", match_key: "L2", status: "in_progress", schedule_status: "accepted", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }] },
    league: {
      ...LEAGUE, incidents,
      map_state: [1, 2, 3].map((position) => ({ position, state: clarifying.includes(position) ? "in_clarification" : "open" })),
      incident_info: info === null ? null : { ...INFO, server_time: new Date().toISOString(), ...info }, ...league,
    },
    ...page,
  };
}

const DUTY = {
  assignments: [], leagues: [], series: [], moderation: null, lead_today: [], ended_live: [], overdue_matches: [], checkin_proposals: [], rules_pending: [],
  incident_reviews: [
    { match_id: "m1", tournament_id: "t1", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", label: "Spieltag 2", code: "in_review", position: 2, since: inMinutes(-20), url: "/matches/m1#vorfaelle" },
    { match_id: "m2", tournament_id: "t1", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", label: "Spieltag 3", code: "unsettled", position: 1, since: inMinutes(-90), url: "/matches/m2#vorfaelle" },
  ],
};

async function setup(page, user, payload, posts = []) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const where = new URL(request.url()).pathname;
    if (where === "/api/auth/me") return user ? route.fulfill(json(user)) : route.fulfill(json({ detail: "nicht angemeldet" }, 401));
    if (where === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (where === "/api/leagues") return route.fulfill(json({ leagues: [] }));
    if (where === "/api/matches/m1/page") return route.fulfill(json(typeof payload === "function" ? payload() : payload));
    if (where === "/api/matches/m1/proofs") return route.fulfill(json({ items: [], open: true, can_add: true, limit: 10, link_max_length: 500 }));
    if (where === "/api/users/me/duty") return route.fulfill(json(DUTY));
    if (where === "/api/friends") return route.fulfill(json({ incoming: [], friends: [], outgoing: [] }));
    if (where.startsWith("/api/changes")) return route.abort();
    if (request.method() !== "GET") {
      posts.push({ path: where, method: request.method(), body: request.postDataJSON() });
      return route.fulfill(json({ incident_id: "v1", state: "proposed", result_confirmed: false, hold: null }));
    }
    return route.fulfill(json([]));
  });
}

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Ein Bild der Fläche „Vorfälle im Spiel“ - am Test angehängt und, mit E2E_SCREENS_DIR, als Datei abgelegt. */
async function shot(page, testInfo, name, width, locator = page.getByTestId("incident-panel")) {
  const file = `${name}-${width}.png`;
  // Kopfleiste, Leiste unten und „Nach oben“ kleben am Fenster und lägen sonst mitten im Bild einer langen Fläche.
  await page.addStyleTag({ content: "[data-sonner-toaster], [data-testid='scroll-top-btn'] { display: none !important; }" });
  await page.evaluate(() => {
    for (const node of document.querySelectorAll("header, nav, div, a, button")) {
      const position = window.getComputedStyle(node).position;
      if (position !== "sticky" && position !== "fixed") continue;
      node.dataset.shotHidden = "1";
      node.style.visibility = "hidden";
    }
  });
  const body = await locator.screenshot({ animations: "disabled" });
  await testInfo.attach(file, { body, contentType: "image/png" });
  const dir = process.env.E2E_SCREENS_DIR;
  if (dir) await locator.screenshot({ path: path.join(dir, file), animations: "disabled" });
  await page.evaluate(() => {
    for (const node of document.querySelectorAll("[data-shot-hidden]")) {
      node.style.visibility = "";
      delete node.dataset.shotHidden;
    }
  });
}

test.describe("Liga: Vorfälle im Spiel", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Captain meldet geführt: Map, was passiert ist, Stand, Vorschlag bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      await setup(page, CAPTAIN, matchPage(), posts);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("incident-panel")).toContainText("Vorfälle im Spiel");
      await expect(page.getByTestId("incident-empty")).toBeVisible();
      await page.getByTestId("incident-open-form").click();
      // Ohne Angaben: der Satz nennt den ersten fehlenden Schritt, nichts geht hinaus.
      await page.getByTestId("incident-form-submit").click();
      await expect(page.getByTestId("incident-form-problem")).toContainText("welche Map");
      await expect(page.getByTestId("incident-form-position-2")).toContainText("Map 2 · Funkturm bei Nacht");
      await page.getByTestId("incident-form-position-2").click();
      await expect(page.getByTestId("incident-form-proposal-rehost")).toHaveCount(0);
      await page.getByTestId("incident-form-kind-rehost").check();
      await expect(page.getByTestId("incident-form-quota")).toContainText("bisher 0 von 1 genutzt");
      await page.getByTestId("incident-form-score-a").fill("3");
      await page.getByTestId("incident-form-score-b").fill("4");
      await page.getByTestId("incident-form-round").fill("8");
      await page.getByTestId("incident-form-player-u2").click();
      await page.getByTestId("incident-form-proposal-rehost").check();
      await page.getByTestId("incident-form-note").fill("Lobby ist abgestürzt.");
      await expect(page.getByTestId("incident-form-next")).toContainText("10 Minuten zum Antworten");
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-melden", width);
      await page.getByTestId("incident-form-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/incidents")?.body).toEqual({
        position: 2, kind: "rehost", proposal: "rehost", score: { a: 3, b: 4 }, round: 8, players: ["u2"], note: "Lobby ist abgestürzt." });
      await expect(page.getByTestId("incident-form")).toHaveCount(0);
    });

    test(`die Map-Pause wird nur festgehalten bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      await setup(page, CAPTAIN, matchPage(), posts);
      await page.goto("/matches/m1");
      await page.getByTestId("incident-open-form").click();
      await page.getByTestId("incident-form-position-2").click();
      await page.getByTestId("incident-form-kind-pause-between").check();
      await expect(page.getByTestId("incident-form-minutes")).toHaveValue("5");
      await page.getByTestId("incident-form-minutes").fill("10");
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-map-pause", width);
      await page.getByTestId("incident-form-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/incidents")?.body).toEqual({ position: 2, kind: "pause", between_maps: true, minutes: 10, note: null });
    });

    test(`die Gegenseite antwortet: Countdown, Zustimmen oder Ablehnen bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      const hold = { code: "proposed", position: 2, text: "Zu Map 2 ist ein Vorfall gemeldet – die Gegenseite antwortet noch. Bis dahin gilt kein Ergebnis." };
      await setup(page, CAPTAIN, matchPage({ incidents: [incident({ can_answer: true })], info: { hold, quota: { limit: 1, used: [] } } }), posts);
      await page.goto("/matches/m1");
      const card = page.getByTestId("incident-v1");
      await expect(card).toContainText("Map 2 · Funkturm bei Nacht · Verbindungsabbruch");
      await expect(card).toContainText("Vorschlag: Rehost beim Stand");
      await expect(card).toContainText("Stand beim Vorfall: 3:4 · Runde 8");
      await expect(page.getByTestId("incident-sentence-v1")).toContainText("Bitte antwortet.");
      await expect(page.getByTestId("incident-countdown-text-v1")).toHaveText(/^[78]:\d\d$/);
      await expect(page.getByTestId("incident-hold")).toContainText("die Gegenseite antwortet noch");
      await expect(page.getByTestId("incident-proof-v1")).toBeVisible();
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-antworten", width);
      await page.getByTestId("incident-answer-v1-decline").click();
      await page.getByTestId("incident-answer-v1-note").fill("Der Stand war 4:4.");
      await expectNoSideScroll(page);
      await page.getByTestId("incident-answer-v1-decline-confirm").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/incidents/v1/answer")?.body).toEqual({ accept: false, note: "Der Stand war 4:4." });
    });

    test(`in Klärung: Satz zum Ergebnis, Serie pausiert, Nachweise bleiben offen bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const row = incident({ state: "in_review", review_cause: "rejected", answer: { registration_id: "a", name: NAMES[0], at: inMinutes(-1), note: "Der Stand war 4:4." } });
      await setup(page, CAPTAIN, matchPage({ incidents: [row], info: { hold: HOLD, clarification_mode: "pause_series", can_report: true } }));
      await page.goto("/matches/m1");
      await expect(page.getByTestId("incident-state-v1")).toHaveText("In Klärung");
      await expect(page.getByTestId("incident-hold")).toContainText("Die Serie pausiert: Spätere Maps lassen sich erst danach melden.");
      await expect(page.getByTestId("incident-sentence-v1")).toContainText("Abgelehnt");
      await expect(page.getByTestId("map-state-2")).toContainText("Map 2 ist in Klärung");
      await expect(page.getByTestId("incident-decision-v1")).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-in-klaerung", width);
    });

    test(`die Liga-Leitung entscheidet und stellt die Serie fest bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const posts = [];
      let rows = [incident({ state: "in_review", review_cause: "expired", can_decide: true })];
      const info = { as_lead: true, can_decide: true, hold: HOLD };
      await setup(page, LEAD, () => matchPage({ incidents: rows, info, league: { own_registration_id: null, roster: [] }, page: { can_act: false, acting_registration_id: null } }), posts);
      await page.goto("/matches/m1");
      await expect(page.getByTestId("incident-sentence-v1")).toContainText("Keine Antwort in der Zeit");
      await page.getByTestId("incident-decision-v1-submit").click();
      await expect(page.getByTestId("incident-decision-v1-problem")).toContainText("wie entschieden wird");
      await page.getByTestId("incident-decision-v1-replay").check();
      await expect(page.getByTestId("incident-decision-v1-settle")).toHaveCount(0);
      await page.getByTestId("incident-decision-v1-awarded").check();
      await page.getByTestId("incident-decision-v1-side-a").click();
      await page.getByTestId("incident-decision-v1-reason").fill("Der Clip beider Seiten zeigt den Abbruch durch die Falken.");
      await page.getByTestId("incident-decision-v1-settle").check();
      await page.getByTestId("incident-decision-v1-surplus-3").click();
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-entscheiden", width);
      await page.getByTestId("incident-decision-v1-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/incidents/v1/decision")?.body).toEqual({
        outcome: "awarded", registration_id: "a", reason: "Der Clip beider Seiten zeigt den Abbruch durch die Falken.", settle: { missing_positions: [], surplus_positions: [3] } });

      // Nach „Map wiederholen“: Begründung steht da, die Serie wird im zweiten Schritt festgestellt.
      rows = [incident({ state: "decided", open: false, can_settle: true, voided: { score: { a: 3, b: 4 } },
        decision: { outcome: "replay", outcome_label: "Map wiederholen", reason: "Serverausfall belegt.", missing_positions: [], surplus_positions: [], settled_at: null } })];
      await page.reload();
      await expect(page.getByTestId("incident-settled-v1")).toContainText("noch nicht festgestellt");
      await expect(page.getByTestId("incident-voided-v1")).toContainText("Die erste Austragung (Stand 3:4) zählt nicht");
      await page.getByTestId("incident-settle-v1-missing-3").click();
      await page.getByTestId("incident-settle-v1-reason").fill("Map 3 fehlt noch, es steht 1:1.");
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-serie-feststellen", width);
      await page.getByTestId("incident-settle-v1-submit").click();
      await expect.poll(() => posts.find((row) => row.path === "/api/matches/m1/incidents/v1/settle")?.body).toEqual({
        missing_positions: [3], surplus_positions: [], reason: "Map 3 fehlt noch, es steht 1:1." });
    });

    test(`Gäste lesen nur „in Klärung“ an der Map bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const row = incident({ state: "in_review" });
      await setup(page, null, matchPage({ incidents: [row], info: null, league: { incidents: [], own_registration_id: null }, page: { can_act: false, acting_registration_id: null } }));
      await page.goto("/matches/m1");
      await expect(page.getByTestId("map-state-2")).toHaveText("Map 2 ist in Klärung");
      await expect(page.getByTestId("incident-panel")).toHaveCount(0);
      await expect(page.getByText("Verbindungsabbruch")).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-oeffentlich", width, page.getByTestId("match-result-card"));
    });

    test(`Mein Dienst nennt „Map in Klärung“ und „Serie feststellen“ bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await setup(page, LEAD, matchPage());
      await page.goto("/admin/dienst");
      await expect(page.getByTestId("duty-incident-m1")).toContainText("Map in Klärung: Spieltag 2");
      await expect(page.getByTestId("duty-incident-m1")).toContainText("Nachweise ansehen und entscheiden");
      await expect(page.getByTestId("duty-incident-m2")).toContainText("Serie feststellen: Spieltag 3");
      await expect(page.getByTestId("duty-incident-open-m1")).toHaveAttribute("href", "/matches/m1#vorfaelle");
      await expectNoSideScroll(page);
      await shot(page, testInfo, "vorfall-mein-dienst", width, page.getByTestId("duty-attention"));
    });
  }

  test("mit „Bewegung reduzieren“ steht der Balken voll und nichts atmet", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 1000 });
    const rows = [incident({ can_answer: true }), incident({ id: "v2", position: 1, state: "in_review", can_answer: false })];
    await setup(page, CAPTAIN, matchPage({ incidents: rows, info: { hold: HOLD } }));
    await page.goto("/matches/m1");
    await expect(page.getByTestId("incident-countdown-text-v1")).toHaveText(/^[78]:\d\d$/);
    const bar = page.getByTestId("incident-countdown-v1").locator(".tls-incident-bar");
    await expect(bar).toHaveAttribute("style", /scaleX\(1\)/);
    const pulse = await page.getByTestId("incident-state-v2").evaluate((node) => window.getComputedStyle(node, "::after").animationName);
    expect(pulse).toBe("none");
  });

  test("mit Bewegung läuft der Balken und „In Klärung“ atmet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    const rows = [incident({ can_answer: true }), incident({ id: "v2", position: 1, state: "in_review", can_answer: false })];
    await setup(page, CAPTAIN, matchPage({ incidents: rows, info: { hold: HOLD } }));
    await page.goto("/matches/m1");
    const bar = page.getByTestId("incident-countdown-v1").locator(".tls-incident-bar");
    await expect.poll(async () => Number((await bar.getAttribute("style")).match(/scaleX\(([\d.]+)\)/)?.[1])).toBeLessThan(1);
    const pulse = await page.getByTestId("incident-state-v2").evaluate((node) => window.getComputedStyle(node, "::after").animationName);
    expect(pulse).toBe("tls-incident-pulse");
  });
});
