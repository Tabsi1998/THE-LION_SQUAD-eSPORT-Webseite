const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Liga-Verfahren (E.2, #1619, #2297) auf der Matchseite bei 390 und 1440 px: das geführte „Problem melden“ (Art, Grund, Nachweise)
// und die Karte des Verfahrens aus Sicht der Gegenseite und der Liga-Leitung - ohne seitlichen Überlauf. Die API ist nachgestellt,
// die Namen sind erfunden. Bilder gehen nach E2E_SCREENS_DIR, wenn gesetzt.

// Fristen relativ zu jetzt - so stehen in den Bildern glaubhafte Restzeiten.
const inHours = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SIDES = [{ registration_id: "a", name: "Loewen Langername · Rudel Alpha" }, { registration_id: "b", name: "Falken mit sehr langem Namen · Horst" }];
const REASONS = [["wrong_result", "Falsches Ergebnis"], ["rule_violation", "Regelverstoß"], ["equipment", "Ausrüstung", true], ["lobby", "Lobby und Einstellungen", true],
  ["player", "Spielberechtigung eines Spielers", true], ["cheating", "Cheat-Verdacht"], ["technical", "Technik"], ["other", "Sonstiges"]]
  .map(([key, label, ask]) => ({ key, label, ask_notified: Boolean(ask) }));
const FORM = { kind: "protest", kind_label: "Protest", until: inHours(40), open: true, reasons: REASONS, result_reason: "wrong_result",
  reason_min: 10, reason_max: 1000, incidents: [{ id: "v1", position: 2, kind: "disconnect" }], appealable: null };
const LEAGUE = {
  best_of: 3, needed: 2, team_size: 4, mode_order: ["stellung", "suchen"], pool: { modes: [] }, sides: SIDES, own_registration_id: "b",
  roster: [], rosters: {}, lineups_missing: [], own_games: [], proposal_games: [], can_amend_lineup: false,
  games: [1, 2].map((position) => ({ position, mode_label: "Stellung", map_name: "Nebelwerk am Fluss", winner_registration_id: "a", scores: { a: 250, b: 180 } })),
  procedures: [], contested: false, procedure_form: null, procedure_viewer: { lead: false, can_decide: false }, moss_candidates: [],
};
const BASE = {
  tournament: { id: "t1", slug: "cod-liga-a", title: "CoD-Liga Season 1 · Liga 1 · Staffel A" },
  participants: [{ slot: 1, status: "filled", registration_id: "a", display_name: SIDES[0].name }, { slot: 2, status: "filled", registration_id: "b", display_name: SIDES[1].name }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true, can_report_score: false, can_player_report_result: false,
  can_submit_result: false, can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal", acting_registration_id: "b", report_state: null,
  match: { id: "m1", match_key: "L1", status: "completed", slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }],
    results: [{ registration_id: "a", rank: 1, score: 2 }, { registration_id: "b", rank: 2, score: 0 }] },
};
const TEXT = "Die zweite Map wurde falsch gemeldet, wir haben sie 250:180 gewonnen.";
const PROCEDURE = {
  id: "p1", kind: "protest", kind_label: "Protest", state: "open", at: inHours(-4), side: "b", own: true, opponent: false,
  reason_key: "wrong_result", reason_label: "Falsches Ergebnis", reason: TEXT, additions: [], evidence_until: inHours(40), incident_id: null,
  statement: { side: "a", due_at: inHours(44), extended: false, text: null, at: null, expired: false },
  assignee: null, target_at: null, decision: null, decision_note: null, moss_requests: [], contested_mode: "counts",
  claimed: { results: [{ registration_id: "a", score: 1 }, { registration_id: "b", score: 2 }], games: [] },
  can_amend: true, can_withdraw: true, can_state: false, can_lead: false, own_decision: false, can_appeal: false,
};
const page_of = (league, extra = {}) => ({ ...BASE, ...extra, league: { ...LEAGUE, ...league } });
const CAPTAIN = page_of({ procedure_form: FORM }, { can_dispute: true });
const SUBMITTED = page_of({ procedures: [PROCEDURE], contested: true, procedure_form: { ...FORM, open: false } }, { can_dispute: true });
const OPPONENT = page_of({
  own_registration_id: "a", contested: true,
  procedures: [{ ...PROCEDURE, own: false, opponent: true, can_amend: false, can_withdraw: false, can_state: true,
    assignee: { name: "Liga-Leitung Nord", at: inHours(-3), own: false }, target_at: inHours(60) }],
}, { acting_registration_id: "a" });
const LEAD = page_of({
  own_registration_id: null, contested: true, procedure_viewer: { lead: true, can_decide: true },
  moss_candidates: [{ id: "u1", name: "Mila Mustermann", side: "a" }, { id: "u7", name: "Falke Zwei", side: "b" }],
  procedures: [{ ...PROCEDURE, own: false, can_amend: false, can_withdraw: false, can_lead: true, submitted_by: "Falke Eins",
    statement: { ...PROCEDURE.statement, text: "Die Map wurde korrekt gemeldet, die Aufzeichnung liegt bei.", at: inHours(-1) },
    assignee: { name: "Liga-Leitung Nord", at: inHours(-3), own: true }, target_at: inHours(60),
    moss_requests: [{ id: "r1", user_id: "u1", name: "Mila Mustermann", side: "a", at: inHours(-1), due_at: inHours(20), state: "requested", own: false }] }],
}, { acting_registration_id: null, can_act: false, can_submit_result: true, can_staff_submit_result: true });
const FORFEIT = page_of({ procedure_form: { ...FORM, open: false, kind: "protest", appealable: { type: "forfeit", ref_id: "m1", until: inHours(30) } } },
  { match: { ...BASE.match, status: "forfeit" } });
const PROOFS = { items: [{ id: "n1", type: "link", kind: "protest", ref_id: "p1", side: "b", own: false, own_side: false, can_remove: false, link: "https://video.example/clip?v=abc" }],
  open: true, can_add: true, limit: 10, link_max_length: 500 };
const MOSS = { items: [{ id: "z1", type: "file", kind: "moss", ref_id: "p1", side: "a", own: false, own_side: false, can_remove: false,
  url: "/api/matches/m1/proofs/z1/file", size: 18400000, sha256: "9f2c".repeat(16) }], open: true, can_add: true, limit: 10, link_max_length: 500 };

async function setup(page, first, { role = "player", next = null } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const calls = { dispute: [], posts: [] };
  let payload = first;
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const where = new URL(request.url());
    if (where.pathname.startsWith("/api/changes")) return route.abort();
    if (where.pathname === "/api/auth/me") return route.fulfill(json({ id: "u9", username: "falke", display_name: "Falke Eins", role }));
    if (where.pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (where.pathname === "/api/matches/m1/page") return route.fulfill(json(payload));
    if (where.pathname === "/api/matches/m1/dispute" && request.method() === "POST") {
      calls.dispute.push(request.postDataJSON());
      if (next) payload = next;
      return route.fulfill(json({ id: "m1", procedure_id: "p1", idempotent_replay: false }));
    }
    if (where.pathname === "/api/matches/m1/proofs") return route.fulfill(json(where.searchParams.get("kind") === "moss" ? MOSS : PROOFS));
    if (where.pathname === "/api/matches/m1/appeals" && request.method() === "POST") {
      calls.posts.push(["appeals", request.postDataJSON()]);
      return route.fulfill(json({ procedures: [], contested: true, procedure_id: "e1" }));
    }
    if (where.pathname.startsWith("/api/matches/m1/procedures/") && request.method() === "POST") {
      calls.posts.push([where.pathname.split("/procedures/p1/")[1], request.postDataJSON()]);
      return route.fulfill(json({ procedures: payload.league.procedures, contested: true }));
    }
    return route.fulfill(json([]));
  });
  return calls;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, locator, name, width) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  // Feste Leisten (Kopf, untere Navigation, Sprunglink) lägen sonst über dem Bild des Bausteins.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("body *")) {
      if (["fixed", "sticky"].includes(getComputedStyle(element).position)) element.style.visibility = "hidden";
    }
  });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: path.join(dir, `${name}-${width}.png`), animations: "disabled" });
}

test.describe("Liga: Beanstandung, Protest und Einspruch", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`Problem melden führt bei ${width} px durch Art, Grund und Nachweise`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const calls = await setup(page, CAPTAIN, { next: SUBMITTED });
      await page.goto("/matches/m1");
      const form = page.getByTestId("match-dispute-form");
      await expect(form.getByTestId("procedure-kind-label")).toHaveText("Protest");
      await expect(form.getByTestId("procedure-details")).toHaveCount(0);
      await form.getByTestId("match-dispute-reason-equipment").click();
      await expect(form.getByTestId("procedure-notified")).toBeVisible();
      await form.getByTestId("match-dispute-reason-wrong_result").click();
      await expect(form.getByTestId("procedure-notified")).toHaveCount(0);
      await form.getByTestId("match-dispute-input").fill(TEXT);
      await form.getByTestId("match-dispute-btn").click();
      await expect(form.getByTestId("match-dispute-error")).toContainText("Ergebnis angeben");
      await form.getByTestId("procedure-claimed-0").fill("1");
      await expect(form.getByTestId("match-dispute-error")).toHaveCount(0);
      await form.getByTestId("procedure-claimed-1").fill("2");
      await form.getByTestId("procedure-incident").selectOption("v1");
      await noSideScroll(page);
      await shot(page, form, "problem-melden-gefuehrt", width);
      await form.getByTestId("match-dispute-btn").click();

      await expect(page.getByTestId("procedure-step-proofs")).toBeVisible();
      expect(calls.dispute).toEqual([{ reason: TEXT, reason_key: "wrong_result", incident_id: "v1",
        claimed: { results: [{ registration_id: "a", score: 1 }, { registration_id: "b", score: 2 }] } }]);
      await expect(page.getByTestId("procedure-proofs-link-input")).toBeVisible();
      await expect(page.getByTestId("match-contested")).toContainText("In Klärung");
      await expect(page.getByTestId("procedure-p1")).toBeVisible();
      await noSideScroll(page);
      await shot(page, page.getByTestId("match-dispute-form"), "problem-melden-nachweise", width);
      await page.getByTestId("procedure-done").click();
      await expect(page.getByTestId("match-dispute-form")).toHaveCount(0);
      await expect(page.getByTestId("procedure-withdraw-p1")).toBeVisible();
    });

    test(`die Gegenseite sieht bei ${width} px Grund, Fristen und nimmt Stellung`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const calls = await setup(page, OPPONENT);
      await page.goto("/matches/m1");
      const card = page.getByTestId("procedure-p1");
      await expect(card.getByTestId("procedure-reason-p1")).toContainText("falsch gemeldet");
      await expect(card.getByTestId("procedure-claimed-p1")).toContainText("1 : 2");
      await expect(card.getByTestId("procedure-statement-until-p1")).toContainText("noch");
      await expect(card.getByTestId("procedure-assignee-p1")).toContainText("Übernommen von Liga-Leitung Nord");
      await expect(card.getByTestId("procedure-lead-p1")).toHaveCount(0);
      await expect(card.getByTestId("procedure-moss-p1")).toHaveCount(0);
      await expect(page.getByTestId("match-dispute-form")).toHaveCount(0);
      await card.getByTestId("procedure-statement-input-p1").fill("Die Map wurde korrekt gemeldet, die Aufzeichnung liegt bei.");
      await noSideScroll(page);
      await shot(page, card, "verfahren-gegenseite", width);
      await card.getByTestId("procedure-statement-send-p1").click();
      await expect.poll(() => calls.posts).toEqual([["statement", { text: "Die Map wurde korrekt gemeldet, die Aufzeichnung liegt bei." }]]);
    });

    test(`die Leitung übernimmt, fordert MOSS an und entscheidet bei ${width} px nur mit Begründung`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const calls = await setup(page, LEAD, { role: "admin" });
      await page.goto("/matches/m1");
      const card = page.getByTestId("procedure-p1");
      await expect(card.getByTestId("procedure-claimed-p1")).toContainText("1 : 2");
      await expect(card.getByTestId("procedure-target-p1")).toContainText("noch");
      await expect(card.getByTestId("procedure-moss-request-r1")).toContainText("angefordert");
      await expect(card.getByTestId("procedure-moss-proofs-p1-file-z1")).toContainText("MOSS-Datei (ZIP, 17,5 MB)");
      await expect(card.getByTestId("procedure-keep-p1")).toBeDisabled();
      await card.getByTestId("procedure-note-p1").fill("Die Aufzeichnung bestätigt das gemeldete Ergebnis.");
      await noSideScroll(page);
      await shot(page, card, "verfahren-leitung", width);
      await card.getByTestId("procedure-moss-player-p1").selectOption("u7");
      await card.getByTestId("procedure-moss-request-p1").click();
      await card.getByTestId("procedure-keep-p1").click();
      await expect.poll(() => calls.posts.map(([action]) => action)).toEqual(["moss-requests", "decision"]);
      expect(calls.posts[1][1]).toEqual({ decision: "keep", decision_note: "Die Aufzeichnung bestätigt das gemeldete Ergebnis." });
      // Der lange Hinweis zu Nachweisen steht je Karte einmal, nicht unter jeder der drei Listen.
      await expect(card.getByText(/Ingame-Uhr/)).toHaveCount(1);
    });

    test(`Einspruch gegen eine Wertung kampflos geht bei ${width} px per Knopf, mit Begründung`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const calls = await setup(page, FORFEIT);
      await page.goto("/matches/m1");
      const box = page.getByTestId("match-appealable");
      await expect(box).toContainText("kampflos gewertet");
      await expect(box.getByTestId("match-appeal-until")).toContainText("noch");
      await expect(box.getByTestId("match-appeal-input")).toHaveCount(0);
      await box.getByTestId("match-appeal-open").click();
      await expect(box.getByTestId("match-appeal-send")).toBeDisabled();
      await box.getByTestId("match-appeal-input").fill("Wir waren pünktlich da, der Check-in hat nicht gespeichert.");
      await noSideScroll(page);
      await shot(page, box, "einspruch-kampflos", width);
      await box.getByTestId("match-appeal-send").click();
      await expect.poll(() => calls.posts).toEqual([["appeals", { against_type: "forfeit", ref_id: "m1", reason: "Wir waren pünktlich da, der Check-in hat nicht gespeichert." }]]);
    });
  }
});
