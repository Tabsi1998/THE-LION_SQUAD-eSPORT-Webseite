const { test, expect } = require("@playwright/test");
const D = require("./hilfe/daten");
const B = require("./hilfe/daten-bereiche");
const { CLIPS, SHOTS, camera, saveSizes } = require("./hilfe/kamera");

// Hilfe-Bereich (#2295): Jeder Ablauf aus src/hilfe/themen/*.json einmal durchgespielt, bei 390 px (Handy) und
// 1440 px (PC), mit nachgestellter API und erfundenen Namen. Jeder Schritt mit Bild muss dran gewesen sein, und keine
// Seite scrollt seitlich - bricht ein Ablauf (Knopf weg, Kennung geändert), wird dieser Test rot.
// Schritte mit Schleife (#2448, "clip": true) laufen über cam.clip: Handgriffe als act.click/check/select/type.
// Bilder neu erzeugen:     HILFE_BILDER=1 npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1
// Schleifen neu erzeugen:  HILFE_CLIPS=1 npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1
// (docs/entwicklung/hilfe-bilder.md)

const FORMS = [["handy", { width: 390, height: 844 }, 2], ["pc", { width: 1440, height: 900 }, 1]];

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `seitliches Scrollen auf ${page.url()}`).toBeLessThanOrEqual(1);
}

/** Der sichtbare von mehreren gleichen Knöpfen (Einstellungen haben am PC und am Handy je eine Leiste). */
const shown = (page, testId) => page.locator(`[data-testid="${testId}"]:visible`).first();
const labelOf = (locator) => locator.locator("xpath=ancestor::label[1]");
const ERFOLG_KARTE = require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", "hilfe-erfolg-karte.jpg"));

async function konto(page, cam, state) {
  state.routes = { "POST /auth/register": ({ body }) => ({ verification_required: true, email: body?.email }) };
  await page.goto("/register");
  const fields = [page.getByTestId("register-username"), page.getByTestId("register-email"), page.getByTestId("register-password")];
  await cam.clip("registrieren", fields, async (act) => {
    await act.type(fields[0], "neonfalke", { delay: 45 });
    await act.type(fields[1], "neon@example.test", { delay: 35 });
    await act.type(fields[2], "Probe-Passwort-2036!", { delay: 30 });
  });
  await noSideScroll(page);
  await cam.clip("zustimmen", [labelOf(page.getByTestId("register-accept")), labelOf(page.getByTestId("register-accept-terms")), page.getByTestId("register-submit")], async (act) => {
    await act.check(page.getByTestId("register-accept"));
    await act.check(page.getByTestId("register-accept-terms"));
  });
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
  // Mein Bereich (#2059): das Profil ist eine Gruppe mit Reitern; der Weg dorthin am PC über den Namen oben rechts,
  // am Handy über das Menü. Die Kopfzeile ist hier selbst zu sehen (keepBars).
  await page.goto("/mein-bereich/profil");
  await expect(page.getByTestId("mein-bereich-reiter")).toBeVisible();
  await noSideScroll(page);
  if (cam.form === "pc") {
    await cam.clip("einstellungen", page.getByTestId("nav-account-profil"), (act) => act.click(page.getByTestId("nav-user")),
      { area: [page.getByTestId("nav-user"), page.getByTestId("nav-user-menu")], start: page.getByTestId("nav-user"), keepBars: true });
    await page.keyboard.press("Escape");
  } else {
    await cam.clip("einstellungen", page.getByTestId("nav-account-profil-mobile"), (act) => act.click(page.getByTestId("nav-mobile-toggle")),
      { area: [page.getByTestId("nav-dashboard-mobile"), page.getByTestId("nav-logout-mobile")], start: page.getByTestId("nav-mobile-toggle"), keepBars: true });
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

  // Benachrichtigungen (#1204, #1206): Stufe, ein Thema selbst, Ruhezeit, Weitere Wege.
  state.routes["/users/me/notification-preferences"] = D.NOTIFICATION_SETTINGS;
  await page.goto("/mein-bereich/benachrichtigungen");
  await expect(page.getByTestId("notification-levels")).toBeVisible();
  await cam.clip("stufe", page.getByTestId("notification-level-important"), (act) => act.click(page.getByTestId("notification-level-important")),
    { area: page.getByTestId("notification-levels") });
  await expect(page.getByTestId("notification-level-important")).toHaveAttribute("aria-checked", "true");
  await noSideScroll(page);
  await cam.clip("themen", page.getByTestId("notification-topic-achievements"), (act) => act.click(page.getByTestId("notification-topic-achievements-off")),
    { area: [page.getByTestId("notification-topic-prize_updates"), page.getByTestId("notification-topic-billing_updates")], start: page.getByTestId("notification-topic-achievements") });
  await expect(page.getByTestId("notification-level-custom")).toBeVisible();
  await cam.clip("ruhezeit", [page.getByTestId("notification-quiet-toggle"), page.getByTestId("notification-quiet-start"), page.getByTestId("notification-quiet-end")],
    (act) => act.click(page.getByTestId("notification-quiet-toggle")), { area: page.getByTestId("notification-quiet"), start: page.getByTestId("notification-quiet-toggle") });
  await expect(page.getByTestId("notification-quiet-start")).toBeVisible();
  // Aufgeklappt reicht der Kasten weit nach unten - der Knopf steht deshalb vorher oben im Bild.
  await cam.clip("weitere-wege", page.getByTestId("notification-more-ways"), (act) => act.click(page.getByTestId("notification-more-ways")),
    { area: [page.getByTestId("notification-more-ways"), page.getByTestId("profile-notification-column-email")], block: "start" });
  await expect(page.getByTestId("profile-notification-channel-email")).toBeVisible();
  await noSideScroll(page);
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
  await cam.clip("team-daten", [page.getByTestId("team-name-input"), page.getByTestId("team-tag"), page.getByTestId("team-save")], async (act) => {
    await act.type(page.getByTestId("team-name-input"), D.TEAM.name);
    await act.type(page.getByTestId("team-tag"), D.TEAM.tag, { delay: 90 });
  }, { area: [page.getByTestId("team-name-input"), page.getByTestId("team-save")] });
  await noSideScroll(page);
  await page.getByTestId("team-save").click();

  await page.goto("/teams/t-1");
  await cam.clip("einladen", page.getByTestId("team-invite-url"), (act) => act.click(page.getByTestId("team-invite-open")),
    { area: [page.getByTestId("team-invite-url"), page.getByTestId("team-invite-renew")], start: page.getByTestId("team-invite-open") });
  await expect(page.getByTestId("team-join-code-value")).toHaveText("Pr0beCode");
  await noSideScroll(page);
  await cam.shot("beitrittscode", page.getByTestId("team-join-code-box"));
  const search = page.getByTestId("team-invite-members").getByRole("textbox").first();
  await cam.clip("persoenlich-einladen", page.getByTestId("team-invite-members"), (act) => act.type(search, "pia", { delay: 120 }), { start: search });
  await expect(page.getByTestId("team-invite-members")).toContainText("Pia Probe");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("team-invite-sheet")).toHaveCount(0);
  await cam.shot("rollen-team", page.getByTestId("team-promote-u-2"), { area: [page.getByTestId("team-manage-members").locator("h2, h3").first(), page.getByTestId("team-member-row-u-2")] });

  await page.goto("/teams?team=t-1");
  const add = page.getByRole("button", { name: /^Co-Team$/ });
  await noSideScroll(page);
  await cam.shot("co-team-anlegen", add);
  await add.click();
  await cam.clip("co-team-kader", [page.getByTestId("team-squad-name"), page.getByTestId("team-squad-game"), page.getByTestId("team-squad-member-u-1")], async (act) => {
    await act.type(page.getByTestId("team-squad-name"), "Rudel Alpha");
    await act.select(page.getByTestId("team-squad-game"), "g-1");
  }, { area: [page.getByTestId("team-squad-name"), page.getByTestId("team-squad-member-u-4")], start: page.getByTestId("team-squad-name") });
  await noSideScroll(page);
  await cam.clip("captain-vertreter", [page.getByTestId("team-squad-captain_id"), page.getByTestId("team-squad-vice_captain_id")], async (act) => {
    await act.select(page.getByTestId("team-squad-captain_id"), D.MATE.id);
    await act.select(page.getByTestId("team-squad-vice_captain_id"), D.MATE2.id);
  });
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
  await cam.clip("co-team-auswahl", [page.getByTestId("apply-squad-row-sq1"), page.getByTestId("apply-next")], (act) => act.check(page.getByTestId("apply-squad-sq1")),
    { start: page.getByTestId("apply-squad-row-sq1") });
  await noSideScroll(page);
  await page.getByTestId("apply-next").click();
  await expect(page.getByTestId("apply-check-ok")).toContainText("kann angemeldet werden");
  await noSideScroll(page);
  await cam.shot("passt-alles", page.getByTestId("apply-check-ok"));
  await cam.shot("offene-punkte", page.getByTestId("apply-warnings"));
  await page.getByTestId("apply-next").click();
  await cam.clip("regelwerk", [labelOf(page.getByTestId("apply-accept-rules")), labelOf(page.getByTestId("apply-accept-privacy"))], async (act) => {
    await act.check(page.getByTestId("apply-accept-rules"));
    await act.check(page.getByTestId("apply-accept-privacy"));
  });
  await noSideScroll(page);
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
  await cam.clip("verschieben", page.getByTestId("reschedule-form"), (act) => act.type(page.getByTestId("reschedule-form-reason"), "Zwei Spieler haben an dem Abend Dienst.", { delay: 35 }));
  await noSideScroll(page);

  match = D.checkinPage();
  await page.reload();
  await cam.clip("check-in", [page.getByTestId("checkin-roster"), page.getByTestId("checkin-submit")], async (act) => {
    for (const id of ["u1", "u2", "u3", "u4"]) await act.click(page.getByTestId(`checkin-roster-${id}`));
  }, { start: page.getByTestId("checkin-roster") });
  await expect(page.getByTestId("checkin-submit")).toBeEnabled();
  await noSideScroll(page);

  match = D.readyPage();
  await page.reload();
  await cam.shot("spiel-starten", page.getByTestId("checkin-start-button"), { area: page.getByTestId("checkin-start") });

  match = D.REPORT_PAGE;
  await page.reload();
  await cam.clip("ergebnis-melden", page.getByTestId("league-game-1"), async (act) => {
    await act.click(page.getByTestId("league-game-1-map-hafen"));
    await act.type(page.getByTestId("league-game-1-score-a"), "250", { delay: 110 });
    await act.type(page.getByTestId("league-game-1-score-b"), "180", { delay: 110 });
  });
  await noSideScroll(page);
  await cam.clip("wer-hat-gespielt", [page.getByTestId("league-participants-count"), page.getByTestId("match-report-submit")], async (act) => {
    for (const id of ["u1", "u2", "u3", "u4"]) await act.click(page.getByTestId(`league-participants-${id}`));
  }, { area: [page.getByTestId("league-participants-u1"), page.getByTestId("league-participants-count"), page.getByTestId("match-report-submit")], start: page.getByTestId("league-participants-u1") });
  await expect(page.getByTestId("league-participants-count")).toContainText("4");

  // Vorfälle im Spiel (D.5, #1619): melden, auf die Meldung der Gegenseite antworten, Map in Klärung.
  state.routes["/matches/m1/proofs"] = D.PROOFS;
  match = D.incidentPage();
  await page.reload();
  await page.getByTestId("incident-open-form").click();
  // Das Formular ist lang - die Schleife zeigt die ersten beiden Fragen (welche Map, was ist passiert).
  await cam.clip("vorfall-melden", [page.getByTestId("incident-form-position-2"), labelOf(page.getByTestId("incident-form-kind-disconnect"))], async (act) => {
    await act.click(page.getByTestId("incident-form-position-2"));
    await act.check(page.getByTestId("incident-form-kind-disconnect"));
  }, { area: [page.getByTestId("incident-form-position-1"), labelOf(page.getByTestId("incident-form-kind-pause-between"))], start: page.getByTestId("incident-form-position-1") });
  await page.getByTestId("incident-form-score-a").fill("3");
  await page.getByTestId("incident-form-score-b").fill("4");
  await page.getByTestId("incident-form-proposal-rehost").check();
  await noSideScroll(page);

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
  await cam.clip("bestaetigen", [page.getByTestId("match-report-confirm"), page.getByTestId("match-report-wrong")], async (act) => {
    for (const id of ["u1", "u2", "u3"]) await act.click(page.getByTestId(`league-confirm-participants-${id}`));
  }, { area: page.getByTestId("match-report"), start: page.getByTestId("league-confirm-participants-u1") });
  await noSideScroll(page);
  // „Stimmt nicht“ rollt das Formular selbst in die Mitte (MatchPage) - das passiert vor der Aufnahme, die Schleife
  // zeigt das Ausfüllen.
  await page.getByTestId("match-report-wrong").click();
  await expect(page.getByTestId("match-dispute-input")).toBeVisible();
  await page.waitForTimeout(400);
  await cam.clip("problem-melden", page.getByTestId("match-dispute-form"), (act) => act.type(page.getByTestId("match-dispute-input"), "Map 1 haben wir 250:180 gewonnen, nicht verloren.", { delay: 30 }),
    { start: page.getByTestId("match-dispute-form") });
  await noSideScroll(page);
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
  await cam.clip("anmeldung-pruefen", page.getByTestId("tournament-register-submit"), (act) => act.click(page.getByTestId("tournament-register-btn")),
    { area: [page.getByTestId("register-sheet-summary"), page.getByTestId("tournament-register-submit")], start: page.getByTestId("tournament-register-btn") });
  await expect(page.getByTestId("register-sheet")).toBeVisible();
  await noSideScroll(page);
  await page.getByTestId("tournament-register-submit").click();
  await expect(page.getByTestId("tournament-my-stand")).toBeVisible();
  await cam.shot("dein-stand", page.getByTestId("tournament-my-stand"));

  cup = D.CUP_CHECKIN;
  regs = [D.MY_REG];
  await page.reload();
  await noSideScroll(page);
  await cam.shot("einchecken", page.getByTestId("tournament-checkin-btn"));

  await page.goto("/matches/m1");
  await cam.clip("ergebnis-melden", [page.getByTestId("match-report-sentence"), page.getByTestId("match-report-submit")], async (act) => {
    await act.click(page.getByTestId("result-score-r1-plus"));
    await act.click(page.getByTestId("result-score-r1-plus"));
    await act.click(page.getByTestId("result-score-r2-plus"));
  }, { area: page.getByTestId("match-report-form"), start: page.getByTestId("result-score-r1-plus") });
  await expect(page.getByTestId("match-report-sentence")).toContainText("2:1");
  await noSideScroll(page);

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
  if (cam.form === "pc") {
    await cam.clip("weg-zeigen", page.locator("[data-mine='true']"), (act) => act.click(path), { area: page.getByTestId("bracket-tree"), each: true, start: page.getByTestId("bracket-tree") });
  } else {
    await cam.clip("weg-zeigen", [page.getByTestId("bracket-step-prev"), page.getByTestId("bracket-step-next")], (act) => act.click(path),
      { area: [page.getByTestId("bracket-step-label"), mine], start: path });
  }
}

// ---------------------------------------------------------------- Paket 3 (#2448): die übrigen Bereiche

async function verein(page, cam, state) {
  let application = null;
  state.user = { ...B.NEON };
  state.routes = {
    "/membership/fees": B.JOIN_FEES,
    "/membership/join-page": { benefits: [], fee_purpose: "" },
    "/membership/apply/form": B.APPLY_FORM,
    "/membership/apply/me": () => application,
    "POST /membership/apply": () => { application = { ...B.APPLICATION }; return application; },
    "/board/statutes": {},
  };
  await page.goto("/membership/join");
  await noSideScroll(page);
  await cam.shot("mitglied-werden", page.getByTestId("join-apply-btn"), { area: [page.getByTestId("join-apply-btn"), page.locator("h1").first()] });

  await page.goto("/membership/apply");
  await expect(page.getByTestId("apply-form")).toBeVisible();
  await noSideScroll(page);
  // Die Schleife zeigt die Wahl der Mitgliedsart; das Geburtsdatum (ein Fenster mit Kalender) kommt danach ohne Aufnahme.
  await cam.clip("antrag-ausfuellen", page.getByTestId("apply-fee-3"), (act) => act.check(page.getByTestId("apply-fee-3")),
    { area: page.getByTestId("apply-fees"), start: page.getByTestId("apply-fees") });
  await page.getByTestId("apply-birth").click();
  await page.getByTestId("apply-birth-year").selectOption("2001");
  await page.getByTestId("apply-birth-day-15").click();
  await noSideScroll(page);
  await cam.clip("antrag-einreichen", [labelOf(page.getByTestId("apply-statutes")), labelOf(page.getByTestId("apply-privacy")), page.getByTestId("apply-submit")], async (act) => {
    await act.check(page.getByTestId("apply-statutes"));
    await act.check(page.getByTestId("apply-privacy"));
  }, { area: [page.getByTestId("apply-consents"), page.getByTestId("apply-submit")] });
  await page.getByTestId("apply-submit").click();
  await expect(page.getByTestId("apply-pending")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("antrag-stand", page.getByTestId("apply-withdraw"), { area: page.getByTestId("apply-pending") });
}

async function events(page, cam, state) {
  let event = B.EVENT_BASE;
  state.user = { ...B.NEON };
  state.routes = {
    "/events/meta": B.EVENTS_META,
    "/events": B.EVENT_LIST,
    "/tournaments": [],
    "/f1/challenges": [],
    "/calendar/mine": { events: [], tournaments: [], fastlaps: [] },
    "/events/probe-lan": () => event,
    "/events/probe-lan/notices": { items: [] },
    "/events/probe-lan/friends": { sharing: true, hint: false, friends: [] },
    "POST /events/e1/registrations": () => ({ id: "r-neon", status: "registered", seat_count: 2, companion_count: 1 }),
  };
  await page.goto("/events");
  await expect(page.getByTestId("events-list")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("events-liste", [page.getByTestId("events-filter"), page.getByTestId("events-only-mine")], { area: [page.locator("h1").first(), page.getByTestId("events-filter")] });

  await page.goto("/events/probe-lan?anmelden=1");
  const form = page.getByTestId("event-register-form");
  await expect(form).toBeVisible();
  await page.waitForTimeout(500);
  await noSideScroll(page);
  const companions = form.locator("input[type='number']");
  await cam.clip("event-anmelden", [companions, page.getByTestId("event-register-submit")], (act) => act.type(companions, "1", { delay: 120 }),
    { area: [form, page.getByTestId("event-register-submit")], start: companions });
  await expect(page.getByTestId("event-quote")).toContainText("2 Personen");

  event = B.EVENT_FULL;
  await page.reload();
  await expect(page.getByTestId("event-register-form")).toBeVisible();
  await expect(page.getByTestId("event-waitlist-note")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("warteliste", [page.getByTestId("event-waitlist-note"), page.getByTestId("event-register-submit")], { area: page.getByTestId("event-register-form") });

  event = B.EVENT_MINE;
  await page.goto("/events/probe-lan");
  await expect(page.getByTestId("event-own-registration")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("anmeldung-aendern", [page.getByTestId("event-edit-link"), page.getByTestId("event-cancel-link")], { area: page.getByTestId("event-own-registration") });

  event = B.EVENT_PROGRAM;
  await page.reload();
  await expect(page.getByTestId("event-whatson")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("tagesplan", page.getByTestId("event-whatson"));

  let personal = { active: false, created_at: null, last_used_at: null };
  state.routes = {
    "/calendar/me": () => ({ items: B.CAL_ITEMS, subscription: personal, hint_due: false }),
    "/calendar": { items: B.CAL_ITEMS, signed_in: true, feed_path: "/api/calendar/feed.ics" },
    "/calendar/personal": () => personal,
    "POST /calendar/personal": () => { personal = { ...B.PERSONAL_FEED }; return personal; },
  };
  await page.goto("/calendar/mine");
  await expect(page.getByTestId("calendar-scope-mine")).toBeVisible();
  const asList = page.getByTestId("calendar-view-list");
  if (await asList.isVisible()) await asList.click();
  await expect(page.getByTestId("calendar-list")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("mein-kalender", page.getByTestId("calendar-badge-tournament-t-duo"),
    { area: [page.getByTestId("calendar-scope"), page.getByTestId("calendar-list")] });
  // Die Adresse beginnt im Bild mit der Adresse der Website statt mit dem Testserver (nur die Anzeige im Feld).
  const feedUrl = page.getByTestId("calendar-personal-feed-url");
  await cam.clip("kalender-abo", feedUrl, async (act) => {
    await act.click(page.getByTestId("calendar-personal-create"));
    await feedUrl.waitFor({ state: "visible" });
    await feedUrl.evaluate((input) => { input.value = input.value.replace(window.location.origin, "https://lionsquad.at"); });
  }, { area: page.getByTestId("calendar-personal"), start: page.getByTestId("calendar-personal-create") });
  await expect(page.getByTestId("calendar-personal-webcal")).toBeVisible();
  await noSideScroll(page);
}

async function turniertag(page, cam, state) {
  const cup = B.ONSITE_CUP;
  state.user = { ...B.NEON };
  state.routes = {
    [`/tournaments/${cup.slug}`]: cup,
    [`/tournaments/${cup.id}/registrations`]: [B.ONSITE_REG],
    [`/tournaments/${cup.id}/live-queue/me`]: B.MY_QUEUE,
    [`/tournaments/${cup.id}/notices`]: B.NOTICES,
    "/teams/my": [],
    "/matches/m-vor-ort/page": B.CALLED_MATCH,
    "/matches/m-vor-ort/chat": [],
  };
  await page.goto(`/tournaments/${cup.slug}`);
  await expect(page.getByTestId("live-queue-status")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("naechstes-spiel", page.getByTestId("live-queue-status"), { area: page.getByTestId("tournament-my-stand") });
  await cam.shot("hinweis-leitung", page.getByTestId("notice-banner"));

  await page.goto("/matches/m-vor-ort");
  await expect(page.getByTestId("match-call")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("aufruf", page.getByTestId("match-call-station"), { area: page.getByTestId("match-call") });
  await cam.shot("ergebnis-vor-ort", page.getByTestId("match-staff-enters"));

  // Spielplan vor Ort: echte Daten aus dem Planer (fixtures/tableScheduleGenerated.json), die Warteschlange dazu.
  const t = B.ONSITE;
  state.user = { ...B.NEON };
  state.routes = {
    [`/tournaments/${t.slug}`]: t,
    [`/tournaments/${t.id}`]: t,
    [`/tournaments/${t.id}/bracket`]: B.onsite.bracket,
    [`/tournaments/${t.id}/registrations`]: B.onsite.bracket.registrations,
    [`/tournaments/${t.id}/matchdays`]: { applies: false, matchdays: [] },
    [`/tournaments/${t.id}/live-queue`]: () => B.onsiteQueue(),
  };
  await page.goto(`/tournaments/${t.slug}/matches`);
  await expect(page.getByTestId("schedule-view-stations")).toBeVisible();
  await noSideScroll(page);
  const running = page.getByTestId(`schedule-now-${B.RUNNING.station_id}`);
  await cam.clip("nach-stationen", running, (act) => act.click(page.getByTestId("schedule-view-stations")),
    { area: [page.getByTestId("schedule-view-stations"), running], start: page.getByTestId("schedule-view-stations"), block: "start" });
  await noSideScroll(page);
  await cam.shot("spielzeit", page.getByTestId(`schedule-clock-${B.RUNNING.id}`), { area: running });
}

async function gewinne(page, cam, state) {
  state.user = { ...B.NEON };
  state.routes = {
    "/prizes/me": B.PRIZES,
    "/prizes/me/certificates": B.CERTIFICATES,
    "/users/public/neonfalke": B.PROFILE,
    "/me/rewards/unseen": { rewards: [] },
    "/achievements/me": B.ME_ACHIEVEMENTS,
    "/achievements/user/u-neon": { groups: B.ME_ACHIEVEMENTS.groups, awards: B.ME_ACHIEVEMENTS.awards },
    "POST /achievements/evaluate": { newly_awarded: 0 },
    "/users/me/profile-completeness": { score: 80, missing: [] },
    "/users/me/level": { level: 9, title: "Jäger", prestige: 0 },
    "/achievements/award/a2": B.SHARE_AWARD,
  };
  await page.goto("/mein-bereich/rechnungen?tab=gewinne");
  await expect(page.getByTestId("my-prize-p-ready")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("meine-gewinne", page.getByTestId("my-prize-p-ready"));

  await page.goto("/u/neonfalke?tab=trophaeen");
  await expect(page.getByTestId("profile-trophies")).toBeVisible();
  await noSideScroll(page);
  await page.getByTestId("profile-trophies-kind-medal").click();
  await expect(page.getByTestId("profile-trophies-count")).toContainText("1 von 6");
  await cam.shot("trophaeen", page.getByTestId("trophy-card-w-gold"),
    { area: [page.getByTestId("profile-trophies-filters"), page.getByTestId("trophy-card-w-gold")] });
  await page.getByTestId("profile-trophies-kind-all").click();
  await cam.shot("neben-den-namen", [page.getByTestId("trophy-emblem-w-emblem"), page.getByTestId("trophy-banner-w-emblem")],
    { area: page.getByTestId("trophy-card-w-emblem") });

  await page.goto("/u/neonfalke?tab=erfolge");
  await expect(page.getByTestId("profile-own-achievements")).toBeVisible();
  await noSideScroll(page);
  const group = page.getByTestId("achievement-group-sieg");
  await group.locator("button").first().click();
  await expect(page.getByTestId("achievement-share-sieg-2")).toBeVisible();
  await page.waitForTimeout(300);
  await cam.shot("erfolge", [page.getByTestId("achievement-group-sieg-tiers"), page.getByTestId("achievement-share-sieg-2")], { area: group });

  // Die Teilen-Karte selbst zeichnet der Server (services/achievement_share.py) - hier ein damit erzeugtes Bild.
  await page.route("**/api/static/achievements/**", (route) => route.fulfill({ contentType: "image/jpeg", body: ERFOLG_KARTE }));
  await page.goto("/achievements/a/a2");
  await expect(page.getByTestId("share-card")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("erfolg-teilen", [page.getByTestId("share-button"), page.getByTestId("share-download")], { area: page.getByTestId("share-card") });
}

async function datenschutz(page, cam, state) {
  let check = B.ERASE_OK;
  state.user = { ...B.NEON };
  state.routes = { "/dsgvo/anonymize-me/check": () => check, "/moderation/blocks": [] };
  // Mein Bereich → Datenschutz (#2059): „Daten herunterladen“ und „Konto löschen“ sind je ein Reiter.
  await page.goto("/mein-bereich/datenschutz?tab=daten");
  await expect(page.getByTestId("dsgvo-export-btn")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("daten-herunterladen", page.getByTestId("dsgvo-export-btn"));
  await page.getByTestId("profile-tab-loeschung").click();
  await page.getByTestId("dsgvo-anonymize-btn").click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("LÖSCHEN");
  await cam.shot("konto-anonymisieren", [dialog.getByRole("textbox"), page.getByTestId("confirm-dialog-confirm")], { area: dialog });
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(dialog).toHaveCount(0);

  check = B.ERASE_BLOCKED;
  await page.reload();
  await expect(page.getByTestId("dsgvo-erasure-blockers")).toBeVisible();
  await noSideScroll(page);
  await cam.shot("rollen-abgeben", page.getByTestId("dsgvo-erasure-blockers"),
    { area: [page.getByTestId("dsgvo-erasure-blockers"), page.getByTestId("dsgvo-anonymize-btn")] });
}

const FLOWS = {
  "konto-und-profil": konto, "team-und-co-team": team, "liga-captains": liga, turniere,
  "verein-und-mitgliedschaft": verein, "events-und-kalender": events, turniertag, "gewinne-und-trophaeen": gewinne, "datenschutz-und-konto": datenschutz,
};

test.describe.configure({ mode: "serial" });
test.afterAll(() => saveSizes());

for (const [form, viewport, scale] of FORMS) {
  test.describe(`Hilfe: Abläufe bei ${viewport.width} px`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breiten stellt der Test selbst ein");
    test.use({ viewport, deviceScaleFactor: SHOTS || CLIPS ? scale : 1, actionTimeout: 15_000 });

    for (const [slug, flow] of Object.entries(FLOWS)) {
      test(`${slug}: alle Schritte mit Bild`, async ({ page }) => {
        test.setTimeout(CLIPS ? 600_000 : 180_000);
        const state = { user: null, routes: {} };
        await D.serve(page, state);
        const cam = camera(page, slug, form);
        await flow(page, cam, state);
        expect(cam.missing(), "Schritte mit Bild, die der Ablauf nicht erreicht hat").toEqual([]);
      });
    }
  });
}
