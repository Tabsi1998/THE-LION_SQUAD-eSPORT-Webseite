const { test, expect } = require("@playwright/test");
const D = require("./hilfe/daten");
const { POINTER, SHOTS, VIDEOS, camera, saveSizes, saveVideo, showClick, stepsOf, subtitle } = require("./hilfe/kamera");

// Hilfe-Bereich (#2295): Jeder Ablauf aus src/hilfe/themen/*.json einmal durchgespielt, bei 390 px (Handy) und
// 1440 px (PC), mit nachgestellter API und erfundenen Namen. Jeder Schritt mit Bild muss dran gewesen sein, und keine
// Seite scrollt seitlich - bricht ein Ablauf (Knopf weg, Kennung geändert), wird dieser Test rot.
// Bilder neu erzeugen:  HILFE_BILDER=1 npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1
// Videos neu erzeugen:  HILFE_VIDEOS=1 npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1 -g Video
// (docs/entwicklung/hilfe-bilder.md)

const FORMS = [["handy", { width: 390, height: 844 }, 2], ["pc", { width: 1440, height: 900 }, 1]];

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `seitliches Scrollen auf ${page.url()}`).toBeLessThanOrEqual(1);
}

/** Der sichtbare von mehreren gleichen Knöpfen (Einstellungen haben am PC und am Handy je eine Leiste). */
const shown = (page, testId) => page.locator(`[data-testid="${testId}"]:visible`).first();
const labelOf = (locator) => locator.locator("xpath=ancestor::label[1]");

async function konto(page, cam, state) {
  state.routes = { "POST /auth/register": ({ body }) => ({ verification_required: true, email: body?.email }) };
  await page.goto("/register");
  await page.getByTestId("register-username").fill("neonfalke");
  await page.getByTestId("register-email").fill("neon@example.test");
  await page.getByTestId("register-password").fill("Probe-Passwort-2036!");
  await noSideScroll(page);
  await cam.shot("registrieren", [page.getByTestId("register-username"), page.getByTestId("register-email"), page.getByTestId("register-password")]);
  await page.getByTestId("register-accept").check();
  await page.getByTestId("register-accept-terms").check();
  await cam.shot("zustimmen", [labelOf(page.getByTestId("register-accept")), labelOf(page.getByTestId("register-accept-terms")), page.getByTestId("register-submit")]);
  await page.getByTestId("register-submit").click();
  await expect(page).toHaveURL(/verify-email/);
  await noSideScroll(page);
  await cam.shot("email-bestaetigen", page.getByText(/Der Versand wurde angefordert/), { area: [page.getByRole("heading", { name: /E-Mail bestätigen/i }), page.getByTestId("verify-resend-submit")] });

  state.user = { ...D.PLAYER };
  state.routes = {
    "/games": D.GAMES,
    "/me/league-eligibility": D.ELIGIBILITY,
    "PATCH /users/me": ({ body }) => { state.user = { ...state.user, ...body }; return state.user; },
  };
  await page.goto("/profile");
  await expect(shown(page, "settings-nav")).toBeVisible();
  await noSideScroll(page);
  // Der Weg zu den Einstellungen: am PC über den Namen oben rechts, am Handy über das Menü.
  if (cam.form === "pc") {
    await page.getByTestId("nav-user").click();
    await cam.shot("einstellungen", page.getByTestId("nav-account-settings"), { area: [page.getByTestId("nav-user"), page.getByTestId("nav-user-menu")] });
    await page.keyboard.press("Escape");
  } else {
    await page.getByTestId("nav-mobile-toggle").click();
    await cam.shot("einstellungen", page.getByTestId("nav-account-settings-mobile"), { area: [page.getByTestId("nav-dashboard-mobile"), page.getByTestId("nav-logout-mobile")] });
    await page.getByTestId("nav-mobile-toggle").click();
  }
  await shown(page, "profile-tab-basic").click();
  await cam.shot("grunddaten", page.getByTestId("profile-display-name"));
  await cam.shot("geburtsdatum", page.getByTestId("profile-birth-date"));
  await shown(page, "profile-tab-gaming").click();
  await noSideScroll(page);
  await cam.shot("plattform", page.getByTestId("profile-platforms"));
  await cam.shot("spiel-ids", [page.getByTestId("profile-game-id-probe-hauptspiel-activision_id"), page.getByTestId("profile-game-id-probe-hauptspiel-platform")]);
  await cam.shot("liga-hinweis", page.getByTestId("profile-league-eligibility-s1"));
}

async function team(page, cam, state) {
  let squads = [];
  state.user = D.LEAD;
  state.routes = {
    "/teams": [{ id: "t-1", name: D.TEAM.name, tag: D.TEAM.tag, member_count: 4 }],
    "/teams/my": [D.TEAM],
    "/teams/t-1": D.TEAM,
    "/teams/t-1/overview": { upcoming: [], recent: [] },
    "/teams/t-1/level": {},
    "/teams/t-1/squads": () => squads,
    "/games": D.TEAM_GAMES,
    "/teams/t-1/invite-link": { url: "http://127.0.0.1/teams/t-1?einladung=abc123", token: "abc123" },
    "/teams/t-1/invites": [],
    "/teams/t-1/invite-candidates": [{ id: "u-9", username: "pia", display_name: "Pia Probe", has_pending_invite: false }],
    "/teams/t-1/invite-link/check": { valid: true, team: { name: D.TEAM.name, member_count: 4 }, already_member: false },
    "POST /teams/t-1/squads": () => { squads = [D.SQUAD]; return D.SQUAD; },
  };
  await page.goto("/teams");
  await noSideScroll(page);
  await cam.shot("team-erstellen", page.getByTestId("team-create-open"));
  await page.getByTestId("team-create-open").click();
  await page.getByTestId("team-name-input").fill(D.TEAM.name);
  await page.getByTestId("team-tag").fill(D.TEAM.tag);
  await noSideScroll(page);
  await cam.shot("team-daten", [page.getByTestId("team-name-input"), page.getByTestId("team-tag"), page.getByTestId("team-save")],
    { area: [page.getByTestId("team-name-input"), page.getByTestId("team-save")] });
  await page.getByTestId("team-save").click();

  await page.goto("/teams/t-1");
  await page.getByTestId("team-invite-open").click();
  await expect(page.getByTestId("team-join-code-value")).toHaveText("Pr0beCode");
  await noSideScroll(page);
  await cam.shot("einladen", page.getByTestId("team-invite-url"), { area: [page.getByTestId("team-invite-url"), page.getByTestId("team-invite-renew")] });
  await cam.shot("beitrittscode", page.getByTestId("team-join-code-box"));
  const search = page.getByTestId("team-invite-members").getByRole("textbox").first();
  await search.fill("pia");
  await expect(page.getByTestId("team-invite-members")).toContainText("Pia Probe");
  await cam.shot("persoenlich-einladen", page.getByTestId("team-invite-members"));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("team-invite-sheet")).toHaveCount(0);
  await cam.shot("rollen-team", page.getByTestId("team-promote-u-2"), { area: [page.getByTestId("team-manage-members").locator("h2, h3").first(), page.getByTestId("team-member-row-u-2")] });

  await page.goto("/teams?team=t-1");
  const add = page.getByRole("button", { name: /^Co-Team$/ });
  await noSideScroll(page);
  await cam.shot("co-team-anlegen", add);
  await add.click();
  await page.getByTestId("team-squad-name").fill("Rudel Alpha");
  await page.getByTestId("team-squad-game").selectOption("g-1");
  await noSideScroll(page);
  await cam.shot("co-team-kader", [page.getByTestId("team-squad-name"), page.getByTestId("team-squad-game"), page.getByTestId("team-squad-member-u-1")],
    { area: [page.getByTestId("team-squad-name"), page.getByTestId("team-squad-member-u-4")] });
  await page.getByTestId("team-squad-captain_id").selectOption(D.MATE.id);
  await page.getByTestId("team-squad-vice_captain_id").selectOption(D.MATE2.id);
  await cam.shot("captain-vertreter", [page.getByTestId("team-squad-captain_id"), page.getByTestId("team-squad-vice_captain_id")]);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByTestId("team-squad-roles-s-1")).toContainText("Captain");

  // Sicht des Captains: Rolle abgeben.
  state.user = { ...D.MATE, role: "player", areas: [] };
  state.routes["/teams/my"] = [{ ...D.TEAM, my_role: "member", can_manage: false, can_edit_team: false, can_change_roles: false }];
  await page.goto("/teams?team=t-1");
  await cam.shot("rolle-abgeben", page.getByTestId("team-squad-resign-s-1"));

  // Sicht einer eingeladenen Person: Link öffnen, beitreten.
  state.user = { id: "u-9", username: "pia", display_name: "Pia Probe", role: "player", areas: [] };
  state.routes["/teams/t-1"] = { ...D.TEAM, is_member: false, my_role: null, can_manage: false, can_edit_team: false, can_change_roles: false, can_remove_members: false };
  await page.goto("/teams/t-1?einladung=abc123");
  await noSideScroll(page);
  await cam.shot("beitreten", page.getByTestId("team-join-invite-submit"), { area: page.getByTestId("team-join-invite") });
}

async function liga(page, cam, state) {
  let submitted = false;
  let match = D.MATCH_PROPOSALS;
  state.user = D.CAPTAIN;
  state.routes = {
    "/leagues/probe-liga/season-1": D.SEASON_VIEW,
    "/leagues/probe-liga/season-1/application": () => (submitted ? D.MINE_SUBMITTED : D.MINE),
    "POST /leagues/probe-liga/season-1/applications": () => { submitted = true; return { id: "a1", status: "submitted" }; },
    "/matches/m1/page": () => match,
    "/matches/m1/chat": [],
  };
  await page.goto("/liga/probe-liga/season-1");
  await noSideScroll(page);
  await cam.shot("anmeldung-starten", page.getByTestId("league-application-start"), { area: page.getByTestId("league-application") });
  await page.getByTestId("league-application-start").click();
  await page.getByTestId("apply-squad-sq1").check();
  await noSideScroll(page);
  await cam.shot("co-team-auswahl", [page.getByTestId("apply-squad-row-sq1"), page.getByTestId("apply-next")]);
  await page.getByTestId("apply-next").click();
  await expect(page.getByTestId("apply-check-ok")).toContainText("kann angemeldet werden");
  await noSideScroll(page);
  await cam.shot("passt-alles", page.getByTestId("apply-check-ok"));
  await cam.shot("offene-punkte", page.getByTestId("apply-warnings"));
  await page.getByTestId("apply-next").click();
  await page.getByTestId("apply-accept-rules").check();
  await page.getByTestId("apply-accept-privacy").check();
  await noSideScroll(page);
  await cam.shot("regelwerk", [labelOf(page.getByTestId("apply-accept-rules")), labelOf(page.getByTestId("apply-accept-privacy"))]);
  await page.getByTestId("apply-next").click();
  await noSideScroll(page);
  await cam.shot("einreichen", page.getByTestId("apply-submit"), { area: [page.getByTestId("apply-summary"), page.getByTestId("apply-submit")] });
  await page.getByTestId("apply-submit").click();
  await expect(page).toHaveURL(/season-1$/);
  await expect(page.getByTestId("league-application-open-sq1")).toBeVisible();
  await cam.shot("stand", page.getByTestId("league-application-row-sq1"));

  // Matchseite: Termin vorschlagen und beantworten.
  await page.goto("/matches/m1");
  await page.getByTestId("match-proposal-at").fill("2036-11-15T20:00");
  await noSideScroll(page);
  await cam.shot("termin-vorschlagen", [page.getByTestId("match-proposal-at"), page.getByRole("button", { name: "Vorschlagen" })], { area: page.getByTestId("match-proposal-form") });
  await cam.shot("termin-antworten", [page.getByTestId("match-proposal-accept-p-theirs"), page.getByTestId("match-proposal-decline-p-theirs")], { area: page.getByTestId("match-proposal-p-theirs") });

  match = D.MATCH_FIXED;
  await page.reload();
  await page.getByTestId("reschedule-form-reason").fill("Zwei Spieler haben an dem Abend Dienst.");
  await noSideScroll(page);
  await cam.shot("verschieben", page.getByTestId("reschedule-form"));

  match = D.checkinPage();
  await page.reload();
  for (const id of ["u1", "u2", "u3", "u4"]) await page.getByTestId(`checkin-roster-${id}`).click();
  await expect(page.getByTestId("checkin-submit")).toBeEnabled();
  await noSideScroll(page);
  await cam.shot("check-in", [page.getByTestId("checkin-roster"), page.getByTestId("checkin-submit")]);

  match = D.readyPage();
  await page.reload();
  await cam.shot("spiel-starten", page.getByTestId("checkin-start-button"), { area: page.getByTestId("checkin-start") });

  match = D.REPORT_PAGE;
  await page.reload();
  await page.getByTestId("league-game-1-map-hafen").click();
  await page.getByTestId("league-game-1-score-a").fill("250");
  await page.getByTestId("league-game-1-score-b").fill("180");
  await noSideScroll(page);
  await cam.shot("ergebnis-melden", page.getByTestId("league-game-1"));
  for (const id of ["u1", "u2", "u3", "u4"]) await page.getByTestId(`league-participants-${id}`).click();
  await expect(page.getByTestId("league-participants-count")).toContainText("4");
  await cam.shot("wer-hat-gespielt", [page.getByTestId("league-participants-count"), page.getByTestId("match-report-submit")],
    { area: [page.getByTestId("league-participants-u1"), page.getByTestId("league-participants-count"), page.getByTestId("match-report-submit")] });

  // Vorfälle im Spiel (D.5, #1619): melden, auf die Meldung der Gegenseite antworten, Map in Klärung.
  state.routes["/matches/m1/proofs"] = D.PROOFS;
  match = D.incidentPage();
  await page.reload();
  await page.getByTestId("incident-open-form").click();
  await page.getByTestId("incident-form-position-2").click();
  await page.getByTestId("incident-form-kind-disconnect").check();
  await page.getByTestId("incident-form-score-a").fill("3");
  await page.getByTestId("incident-form-score-b").fill("4");
  await page.getByTestId("incident-form-proposal-rehost").check();
  await noSideScroll(page);
  // Das Formular ist lang - das Bild zeigt die ersten beiden Fragen (welche Map, was ist passiert).
  await cam.shot("vorfall-melden", [page.getByTestId("incident-form-position-2"), labelOf(page.getByTestId("incident-form-kind-disconnect"))],
    { area: [page.getByTestId("incident-form-position-1"), labelOf(page.getByTestId("incident-form-kind-pause-between"))] });

  match = D.incidentPage([D.incidentRow()], { hold: { code: "proposed", position: 2, text: "Zu Map 2 ist ein Vorfall gemeldet – die Gegenseite antwortet noch. Bis dahin gilt kein Ergebnis." } });
  await page.reload();
  await expect(page.getByTestId("incident-countdown-text-v1")).toContainText(":");
  await noSideScroll(page);
  await cam.shot("vorfall-antworten", [page.getByTestId("incident-answer-v1-accept"), page.getByTestId("incident-answer-v1-decline")],
    { area: [page.getByTestId("incident-state-v1"), page.getByTestId("incident-sentence-v1"), page.getByTestId("incident-answer-v1")] });

  match = D.incidentPage([D.incidentRow({ state: "in_review", review_cause: "rejected", can_answer: false,
    answer: { registration_id: "a", name: D.SIDES[0].name, at: new Date().toISOString(), note: "Der Stand war 4:4, nicht 3:4." } })], { hold: D.INCIDENT_HOLD });
  await page.reload();
  await expect(page.getByTestId("incident-state-v1")).toContainText("In Klärung");
  await noSideScroll(page);
  // „In Klärung“ steht am Abzeichen der Karte; der Satz darunter sagt, warum und was die Serie solange tut.
  await cam.shot("in-klaerung", page.getByTestId("incident-state-v1"), { area: [page.getByTestId("incident-state-v1"), page.getByTestId("incident-sentence-v1")] });

  match = D.CONFIRM_PAGE;
  await page.reload();
  for (const id of ["u1", "u2", "u3"]) await page.getByTestId(`league-confirm-participants-${id}`).click();
  await noSideScroll(page);
  await cam.shot("bestaetigen", [page.getByTestId("match-report-confirm"), page.getByTestId("match-report-wrong")], { area: page.getByTestId("match-report") });
  await page.getByTestId("match-report-wrong").click();
  await page.getByTestId("match-dispute-input").fill("Map 1 haben wir 250:180 gewonnen, nicht verloren.");
  await noSideScroll(page);
  await cam.shot("problem-melden", page.getByTestId("match-dispute-form"));
}

async function turniere(page, cam, state) {
  let regs = [];
  let cup = D.CUP;
  let duel = D.DUEL_REPORT;
  state.user = D.SPIELER;
  state.routes = {
    "/tournaments/probe-cup": () => ({ ...cup, participant_count: 5 + regs.length }),
    "/tournaments/tournament-1/registrations": () => regs,
    "/teams/my": [],
    "POST /tournaments/tournament-1/register": () => { regs = [D.MY_REG]; return D.MY_REG; },
    "/matches/m1/page": () => duel,
    "/matches/m1/chat": [],
    "/tournaments/t9/bracket": { ...D.BRACKET, tournament: D.BRACKET_CUP },
  };
  await page.goto("/tournaments/probe-cup");
  await noSideScroll(page);
  await cam.shot("anmelden", page.getByTestId("tournament-register-btn"));
  await page.getByTestId("tournament-register-btn").click();
  await expect(page.getByTestId("register-sheet")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("anmeldung-pruefen", page.getByTestId("tournament-register-submit"), { area: [page.getByTestId("register-sheet-summary"), page.getByTestId("tournament-register-submit")] });
  await page.getByTestId("tournament-register-submit").click();
  await expect(page.getByTestId("tournament-my-stand")).toBeVisible();
  await cam.shot("dein-stand", page.getByTestId("tournament-my-stand"));

  cup = D.CUP_CHECKIN;
  regs = [D.MY_REG];
  await page.reload();
  await noSideScroll(page);
  await cam.shot("einchecken", page.getByTestId("tournament-checkin-btn"));

  await page.goto("/matches/m1");
  await page.getByTestId("result-score-r1-plus").click();
  await page.getByTestId("result-score-r1-plus").click();
  await page.getByTestId("result-score-r2-plus").click();
  await expect(page.getByTestId("match-report-sentence")).toContainText("2:1");
  await noSideScroll(page);
  await cam.shot("ergebnis-melden", [page.getByTestId("match-report-sentence"), page.getByTestId("match-report-submit")], { area: page.getByTestId("match-report-form") });

  duel = D.DUEL_CONFIRM;
  await page.reload();
  await cam.shot("ergebnis-bestaetigen", [page.getByTestId("match-report-confirm"), page.getByTestId("match-report-wrong")], { area: page.getByTestId("match-report") });

  cup = D.BRACKET_CUP;
  await page.goto("/tournaments/probe-cup/bracket");
  const mine = page.locator("[data-mine='true']:visible").first();
  await expect(mine).toBeVisible();
  await noSideScroll(page);
  await cam.shot("turnierbaum", mine, cam.form === "pc" ? { area: page.getByTestId("bracket-tree") } : {});
  const path = page.getByRole("button", { name: /Weg von NeonFalke zeigen/ }).filter({ visible: true }).first();
  await path.click();
  if (cam.form === "pc") await cam.shot("weg-zeigen", page.locator("[data-mine='true']"), { area: page.getByTestId("bracket-tree"), each: true });
  else await cam.shot("weg-zeigen", [page.getByTestId("bracket-step-prev"), page.getByTestId("bracket-step-next")], { area: [page.getByTestId("bracket-step-label"), mine] });
}

const FLOWS = { "konto-und-profil": konto, "team-und-co-team": team, "liga-captains": liga, turniere };

test.describe.configure({ mode: "serial" });
test.afterAll(() => saveSizes());

for (const [form, viewport, scale] of FORMS) {
  test.describe(`Hilfe: Abläufe bei ${viewport.width} px`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breiten stellt der Test selbst ein");
    test.skip(VIDEOS && !SHOTS, "nur Videos");
    test.use({ viewport, deviceScaleFactor: SHOTS ? scale : 1, actionTimeout: 15_000 });

    for (const [slug, flow] of Object.entries(FLOWS)) {
      test(`${slug}: alle Schritte mit Bild`, async ({ page }) => {
        test.setTimeout(180_000);
        const state = { user: null, routes: {} };
        await D.serve(page, state);
        const cam = camera(page, slug, form);
        await flow(page, cam, state);
        expect(cam.missing(), "Schritte mit Bild, die der Ablauf nicht erreicht hat").toEqual([]);
      });
    }
  });
}

// ---------------------------------------------------------------- Videos (nur mit HILFE_VIDEOS=1)

const VIDEO_SIZE = { width: 390, height: 760 };
const say = (slug, id) => stepsOf(slug).find((step) => step.id === id).text;

async function recorded(browser, id, run) {
  const dir = test.info().outputPath("video");
  const context = await browser.newContext({ viewport: VIDEO_SIZE, deviceScaleFactor: 1, recordVideo: { dir, size: VIDEO_SIZE }, hasTouch: false });
  const page = await context.newPage();
  await page.addInitScript(POINTER);
  const state = { user: null, routes: {} };
  await D.serve(page, state);
  try {
    await run(page, state);
    await page.waitForTimeout(1500);
  } finally {
    await saveVideo(page, context, id);
  }
}

async function step(page, text, wait = 900) {
  await subtitle(page, text);
  await page.waitForTimeout(Math.round(wait * 1.4));
}

test.describe("Hilfe: Videos", () => {
  test.skip(!VIDEOS, "nur mit HILFE_VIDEOS=1");
  test.skip(({ isMobile }) => Boolean(isMobile), "eigene Größe");

  test("Video: Liga-Anmeldung", async ({ browser }) => {
    test.setTimeout(180_000);
    const slug = "liga-captains";
    await recorded(browser, "liga-anmeldung", async (page, state) => {
      let submitted = false;
      state.user = D.CAPTAIN;
      state.routes = {
        "/leagues/probe-liga/season-1": D.SEASON_VIEW,
        "/leagues/probe-liga/season-1/application": () => (submitted ? D.MINE_SUBMITTED : D.MINE),
        "POST /leagues/probe-liga/season-1/applications": () => { submitted = true; return { id: "a1", status: "submitted" }; },
      };
      await page.goto("/liga/probe-liga/season-1");
      await page.getByTestId("league-application-start").scrollIntoViewIfNeeded();
      await step(page, say(slug, "anmeldung-starten"), 2500);
      await showClick(page, page.getByTestId("league-application-start"));
      await step(page, say(slug, "co-team-auswahl"), 1500);
      await showClick(page, page.getByTestId("apply-squad-sq1"));
      await showClick(page, page.getByTestId("apply-next"));
      await step(page, say(slug, "passt-alles"), 3500);
      await page.getByTestId("apply-warnings").scrollIntoViewIfNeeded();
      await step(page, say(slug, "offene-punkte"), 3500);
      await showClick(page, page.getByTestId("apply-next"));
      await step(page, say(slug, "regelwerk"), 2000);
      await showClick(page, page.getByTestId("apply-accept-rules"));
      await showClick(page, page.getByTestId("apply-accept-privacy"));
      await showClick(page, page.getByTestId("apply-next"));
      await step(page, say(slug, "einreichen"), 2500);
      await showClick(page, page.getByTestId("apply-submit"));
      await expect(page.getByTestId("league-application-row-sq1")).toBeVisible();
      await page.getByTestId("league-application-row-sq1").scrollIntoViewIfNeeded();
      await step(page, say(slug, "stand"), 3500);
    });
  });

  test("Video: Ergebnis melden", async ({ browser }) => {
    test.setTimeout(180_000);
    const slug = "liga-captains";
    await recorded(browser, "ergebnis-melden", async (page, state) => {
      state.user = D.CAPTAIN;
      state.routes = { "/matches/m1/page": D.REPORT_PAGE, "/matches/m1/chat": [], "POST /matches/m1/report": { awaiting_confirmation: true } };
      await page.goto("/matches/m1");
      await page.getByTestId("league-game-1").scrollIntoViewIfNeeded();
      await step(page, say(slug, "ergebnis-melden"), 2500);
      await showClick(page, page.getByTestId("league-game-1-map-hafen"));
      await showClick(page, page.getByTestId("league-game-1-score-a"));
      await page.keyboard.type("250", { delay: 120 });
      await showClick(page, page.getByTestId("league-game-1-score-b"));
      await page.keyboard.type("180", { delay: 120 });
      await step(page, say(slug, "wer-hat-gespielt"), 1500);
      for (const id of ["u1", "u2", "u3", "u4"]) await showClick(page, page.getByTestId(`league-participants-${id}`));
      await page.getByTestId("match-report-submit").scrollIntoViewIfNeeded();
      await step(page, "Prüf den Satz über dem Knopf. Tippe dann auf Ergebnis melden.", 2500);
      await showClick(page, page.getByTestId("match-report-submit"));
      await step(page, "Fertig. Jetzt bestätigt die Gegenseite.", 2500);
    });
  });

  test("Video: Team und Co-Team anlegen", async ({ browser }) => {
    test.setTimeout(180_000);
    const slug = "team-und-co-team";
    await recorded(browser, "team-und-co-team", async (page, state) => {
      let mine = [];
      let squads = [];
      state.user = D.LEAD;
      state.routes = {
        "/teams": () => mine.map(({ id, name, tag }) => ({ id, name, tag, member_count: 4 })),
        "/teams/my": () => mine,
        "POST /teams": () => { mine = [D.TEAM]; return D.TEAM; },
        "/teams/t-1/squads": () => squads,
        "/games": D.TEAM_GAMES,
        "POST /teams/t-1/squads": () => { squads = [D.SQUAD]; return D.SQUAD; },
      };
      await page.goto("/teams");
      await step(page, say(slug, "team-erstellen"), 2000);
      await showClick(page, page.getByTestId("team-create-open"));
      await step(page, say(slug, "team-daten"), 1000);
      await showClick(page, page.getByTestId("team-name-input"));
      await page.keyboard.type(D.TEAM.name, { delay: 70 });
      await showClick(page, page.getByTestId("team-tag"));
      await page.keyboard.type(D.TEAM.tag, { delay: 120 });
      await showClick(page, page.getByTestId("team-save"));
      await page.goto("/teams?team=t-1");
      const add = page.getByRole("button", { name: /^Co-Team$/ });
      await add.scrollIntoViewIfNeeded();
      await step(page, say(slug, "co-team-anlegen"), 3500);
      await showClick(page, add);
      await step(page, say(slug, "co-team-kader"), 1200);
      await showClick(page, page.getByTestId("team-squad-name"));
      await page.keyboard.type("Rudel Alpha", { delay: 70 });
      await page.getByTestId("team-squad-game").selectOption("g-1");
      await page.waitForTimeout(800);
      await page.getByTestId("team-squad-captain_id").scrollIntoViewIfNeeded();
      await step(page, say(slug, "captain-vertreter"), 2500);
      await page.getByTestId("team-squad-captain_id").selectOption(D.MATE.id);
      await page.waitForTimeout(700);
      await page.getByTestId("team-squad-vice_captain_id").selectOption(D.MATE2.id);
      await page.waitForTimeout(700);
      await showClick(page, page.getByRole("button", { name: "Speichern" }));
      await expect(page.getByTestId("team-squad-roles-s-1")).toBeVisible();
      await page.getByTestId("team-squad-roles-s-1").scrollIntoViewIfNeeded();
      await step(page, "Fertig. Das Co-Team steht mit Captain und Vertreter.", 2500);
    });
  });
});
