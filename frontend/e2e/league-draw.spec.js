const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“ - Samstag, 28.11.2026.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-28T10:00:00Z") });
});

// Mehrere Staffeln je Liga (#1623, #1627, docs/LIGA.md „B.4 Los auf mehrere Staffeln“ und „F.2 … Platzprüfung“) im echten Browser, Server
// nachgestellt: Staffeln auslosen mit Vorschau, Tausch mit Grund und Zuteilen; die Platzprüfung im Abschnitt und im Blatt „Neue Season
// aus …“; neue Co-Teams im Eingang zuerst in der untersten Liga. Bei 390 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt
// der Test die Bilder ab (los-vorschau-…, platzpruefung-…). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const day = (offset) => new Date(Date.UTC(2027, 1, 2 + offset)).toISOString().slice(0, 10);
const CALENDAR = { weeks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false })),
  blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 5, end_date: "2027-04-12T21:59:59+00:00" };
const SCORING = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff", "lead_decision"], head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON = { id: "s2", league_id: "l1", number: 2, name: "Season 2", slug: "season-2", start_date: "2027-02-01T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
  default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 4, best_of: 3, team_size: 4, min_squad_size: 4,
  game_mode_order: [], scoring_rules: SCORING, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "admins", status: "draft", blocked_periods: [],
  entry_policy: "all", new_squads_lowest_division: true, application_opens_at: "2027-01-01T08:00:00+00:00", application_closes_at: "2027-01-31T20:00:00+00:00" };
const staffel = (id, letter, count = 0, status = "draft") => ({ tournament_id: id, staffel: letter, status, participant_count: count, max_participants: 4 });
const division = (level, top, bottom, staffeln) => ({ id: `d${level}`, level, overrides: {}, label: `Liga ${level}`, calendar: CALENDAR,
  settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 4, scoring_rules: SCORING },
  zones: { promote: 1, relegate: 1, playoff_promote: 0, playoff_relegate: 0 },
  zones_effective: { promote: top ? 0 : 1, relegate: bottom ? 0 : 1, playoff_promote: 0, playoff_relegate: 0, top, bottom }, staffeln });
const PAGE = {
  capabilities: ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules"],
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON,
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [division(1, true, false, [staffel("t1", "A", 1), staffel("t2", "B")]), division(2, false, true, [staffel("t3", "A")])],
};
const OLD_PAGE = { ...PAGE, season: { ...SEASON, id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "completed", visibility: "public", start_date: "2026-11-09T23:00:00+00:00" },
  divisions: [division(1, true, false, [staffel("o1", "A", 4, "completed")]), division(2, false, true, [staffel("o2", "A", 4, "completed"), staffel("o3", "B", 4, "completed")])] };

const TEAMS = [["q1", "Nordlicht · Nordlicht A"], ["q2", "Sturmfalken · Falken Rot"], ["q3", "Eisbären · Eisbären B"], ["q4", "Sturmfalken · Falken Blau"],
  ["q5", "Wüstenfüchse · Füchse A"], ["q6", "Bergdohlen · Dohlen Grün"]];
const waiting = TEAMS.map(([squad, name], index) => ({ application_id: `a${index + 1}`, squad_id: squad, display_name: name, carry_over: true }));
const drawn = (squad) => ({ squad_id: squad, application_id: `a${squad.slice(1)}`, display_name: TEAMS.find(([id]) => id === squad)[1], swapped: false, done: false });
const AT = "2027-01-20T18:05:00+00:00";
const DRAW = {
  id: "draw1", seed: "3f9a6c01d2e4b587", number: 1, status: "draft", stale: false, policy: 1, fingerprint: "fp1", created_at: AT, applied_at: null,
  staffeln: [
    { tournament_id: "t1", staffel: "A", capacity: 4, seated: ["Flusskrebse · Krebse Eins"], size: 4, teams: [drawn("q2"), drawn("q5"), drawn("q3")] },
    { tournament_id: "t2", staffel: "B", capacity: 4, seated: [], size: 3, teams: [drawn("q4"), drawn("q1"), drawn("q6")] },
  ],
  swaps: [], log: [{ action: "create", number: 1, at: AT, by_name: "Leitung" }],
};
const SWAPPED = { ...DRAW, fingerprint: "fp2",
  staffeln: [
    { ...DRAW.staffeln[0], teams: [drawn("q2"), { ...drawn("q6"), swapped: true }, drawn("q3")] },
    { ...DRAW.staffeln[1], teams: [drawn("q4"), drawn("q1"), { ...drawn("q5"), swapped: true }] },
  ],
  swaps: [{ a: "q5", b: "q6", a_name: "Wüstenfüchse · Füchse A", b_name: "Bergdohlen · Dohlen Grün", reason: "Terminwunsch beider Teams", at: AT, by_name: "Leitung" }],
  log: [...DRAW.log, { action: "swap", at: AT, by_name: "Leitung", reason: "Terminwunsch beider Teams" }] };
const LIGA_1 = {
  id: "d1", level: 1, label: "Liga 1", lowest: false, own_team: false, problem: null, can_draw: true, draw: null, waiting,
  staffeln: [{ tournament_id: "t1", staffel: "A", status: "draft", open: true, max_participants: 4, seats: 1 }, { tournament_id: "t2", staffel: "B", status: "draft", open: true, max_participants: 4, seats: 0 }],
  suggestion: { teams: 7, cap: 4, needed: 2, sizes: [4, 3], fits: true, text: "7 Co-Teams, höchstens 4 je Staffel: 2 Staffeln mit 4 und 3 Teams." },
};
const LIGA_2 = {
  id: "d2", level: 2, label: "Liga 2", lowest: true, own_team: false, can_draw: false, draw: null,
  problem: "Liga 2 hat nur eine Staffel – dort teilst du im Eingang direkt zu.",
  waiting: Array.from({ length: 5 }, (_, index) => ({ application_id: `b${index}`, squad_id: `p${index}`, display_name: `Probe ${index}`, carry_over: true })),
  staffeln: [{ tournament_id: "t3", staffel: "A", status: "draft", open: true, max_participants: 4, seats: 0 }],
  suggestion: { teams: 5, cap: 4, needed: 2, sizes: [3, 2], fits: false, text: "5 Co-Teams, höchstens 4 je Staffel: 2 Staffeln mit 3 und 2 Teams. Es gibt 1 Staffel – es fehlt 1." },
};

const team = (squad, name, extra) => ({ squad_id: squad, display_name: name, from_staffel: "A", ...extra });
const SEATS_1 = "5 Co-Teams, höchstens 4 je Staffel: 2 Staffeln mit 3 und 2 Teams. Bisher gab es 1 Staffel – es fehlt 1.";
const SEATS_2 = "7 Co-Teams, höchstens 4 je Staffel: 2 Staffeln mit 4 und 3 Teams.";
const PREVIEW = {
  season: { id: "s1", name: "Season 1", number: 1, status: "completed" }, can_create: true, problems: [], successor: null, suggested: { number: 2, name: "Season 2" },
  copied: ["Spielbetrieb: Best of, Teamgröße, Modi je Map, Ergebnisregeln, Veto, Vorfälle und Pausen", "Tabelle: Punkte, Gleichstand, Ausscheiden"],
  dates_to_set: ["Beginn der ersten Spielwoche", "Sperrzeiten", "Anmeldefenster und Meldeschluss"],
  map_pool: { version: 4 }, loadout_bans: { version: 2 }, rules: { kind: "league", label: "Version 3", version_id: "v3" }, carried: 12,
  relegation_note: "Relegationsplätze sind vorbereitet: Sie stehen farbig in der Tabelle, die Teams bleiben vorerst in ihrer Liga.",
  capacity_hints: [`Liga 1: ${SEATS_1}`],
  divisions: [
    { level: 1, label: "Liga 1", zones_label: "oberste Liga: kein Aufstieg · 1 Absteiger",
      capacity: { teams: 5, staffeln_before: 1, cap: 4, cap_by: "setting", needed: 2, sizes: [3, 2], fits: false, text: SEATS_1 },
      teams: [team("q1", "Nordlicht · Nordlicht A", { from_label: "Liga 1", rank: 1, movement: "stay" }), team("q2", "Sturmfalken · Falken Rot", { from_label: "Liga 1", rank: 2, movement: "stay" }),
        team("q3", "Eisbären · Eisbären B", { from_label: "Liga 1", rank: 3, movement: "stay" }), team("q5", "Wüstenfüchse · Füchse A", { from_label: "Liga 2", rank: 1, movement: "up" }),
        team("q6", "Bergdohlen · Dohlen Grün", { from_label: "Liga 2", from_staffel: "B", rank: 1, movement: "up" })] },
    { level: 2, label: "Liga 2", zones_label: "1 Aufsteiger · unterste Liga: kein Abstieg",
      capacity: { teams: 7, staffeln_before: 2, cap: 4, cap_by: "setting", needed: 2, sizes: [4, 3], fits: true, text: SEATS_2 },
      teams: [team("q4", "Sturmfalken · Falken Blau", { from_label: "Liga 1", rank: 4, movement: "down" }), team("q7", "Flusskrebse · Krebse Eins", { from_label: "Liga 2", rank: 2, movement: "stay" }),
        team("q8", "Nebelkrähen · Krähen B", { from_label: "Liga 2", rank: 3, movement: "stay" })] },
  ],
  dropped: [],
};

const NEW_TEAM = { id: "n1", status: "accepted", squad_id: "q9", team_id: "team-9", display_name: "Hafenmöwen · Möwen Blau", submitted_at: "2027-01-10T18:00:00+00:00",
  applied_by_name: "Kapitänin", rules_version: 3, rules_at: "2027-01-10T18:00:00+00:00", privacy_at: "2027-01-10T18:00:00+00:00", member_count: 5, captain_name: "Kapitänin",
  vice_name: "Vertreter", problems: [], warnings: [], shared_with: [], own_team: false, carry_over: null, target_division_id: "d2", assignment: null,
  history: [{ status: "submitted", at: "2027-01-10T18:00:00+00:00", by_name: "Kapitänin" }] };
const INBOX = { configured: true, window: "open", superadmin: true, new_lowest: true, items: [NEW_TEAM],
  stats: { slots: 16, taken: 13, free: 3, open: 0, waiting: 0, unassigned: 13, full: false },
  divisions: [{ id: "d1", label: "Liga 1", lowest: false, staffeln: PAGE.divisions[0].staffeln }, { id: "d2", label: "Liga 2", lowest: true, staffeln: PAGE.divisions[1].staffeln }] };

async function mockServer(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "teams/invites/my", "teams/dissolved/mine", "teams?**", "teams/levels"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/admin/leagues/seasons/s1", json(OLD_PAGE));
  await page.route("**/api/admin/leagues/seasons/s2", json(PAGE));
  await page.route("**/api/admin/leagues/seasons/s1/successor", (route) => (route.request().method() === "GET" ? json(PREVIEW)(route) : route.fallback()));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(target, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", style: ".tls-bottom-nav { display: none !important; }" });
}

test.describe("Liga: mehrere Staffeln je Liga", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Staffeln auslosen bei ${width} px: Platzprüfung, Vorschau, Tausch mit Grund, zuteilen`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      let draw = null;
      const sent = [];
      await page.route("**/api/admin/leagues/seasons/s2/draws", (route) => json({ superadmin: true, siblings_allowed: false,
        divisions: [{ ...LIGA_1, draw, waiting: draw?.status === "applied" ? [] : waiting, can_draw: !draw }, LIGA_2] })(route));
      await page.route("**/api/admin/leagues/seasons/s2/draws/d1**", (route) => {
        const url = new URL(route.request().url());
        const action = url.pathname.split("/draws/d1")[1].replace("/", "") || "create";
        sent.push([action, route.request().postDataJSON()]);
        if (action === "swap") draw = SWAPPED;
        else if (action === "apply") draw = { ...SWAPPED, status: "applied", applied_at: AT, log: [...SWAPPED.log, { action: "apply", at: AT, by_name: "Leitung" }] };
        else draw = DRAW;
        return json({ replay: false, assigned: action === "apply" ? 6 : undefined, draw })(route);
      });
      await page.goto("/admin/leagues/seasons/s2#auslosung");
      const first = page.getByTestId("draw-division-1");
      await expect(first).toContainText("6 Co-Teams warten auf eine Staffel · Staffel A 1 von 4 · Staffel B 0 von 4");
      await expect(page.getByTestId("draw-seats-1")).toHaveAttribute("data-fits", "yes");
      // Liga 2: eine Staffel für fünf Teams - die Platzprüfung warnt, gelost wird dort nicht.
      await expect(page.getByTestId("draw-seats-2")).toHaveAttribute("data-fits", "no");
      await expect(page.getByTestId("draw-seats-2")).toContainText("Es gibt 1 Staffel – es fehlt 1.");
      await expect(page.getByTestId("draw-run-2")).toHaveCount(0);
      await noSideScroll(page);

      await page.getByTestId("draw-run-1").click();
      const sheet = page.getByTestId("draw-sheet");
      await expect(sheet.getByTestId("draw-status")).toHaveText("Los Nr. 1 – Vorschau, noch nicht übernommen");
      await expect(sheet.getByTestId("draw-seed")).toHaveText("3f9a6c01d2e4b587");
      await expect(sheet.getByTestId("draw-staffel-A")).toContainText("4 von 4 Plätzen");
      await expect(sheet.getByTestId("draw-staffel-A")).toContainText("Flusskrebse · Krebse Eins · schon zugeteilt");
      // Zwei Co-Teams eines Hauptteams stehen in verschiedenen Staffeln.
      await expect(sheet.getByTestId("draw-staffel-A")).toContainText("Sturmfalken · Falken Rot");
      await expect(sheet.getByTestId("draw-staffel-B")).toContainText("Sturmfalken · Falken Blau");
      await expect(sheet.getByTestId("draw-apply")).toHaveText("6 Co-Teams zuteilen");
      await noSideScroll(page);
      await shot(page, `los-vorschau-${width}`);

      await sheet.getByTestId("draw-swap-open-q5").click();
      await expect(sheet.getByTestId("draw-swap-send")).toBeDisabled();
      await sheet.getByTestId("draw-swap-with").selectOption("q6");
      await sheet.getByTestId("draw-swap-reason").fill("Terminwunsch beider Teams");
      await noSideScroll(page);
      await sheet.getByTestId("draw-swap-send").click();
      await expect(sheet.getByTestId("draw-swaps")).toContainText("Tausch: Wüstenfüchse · Füchse A und Bergdohlen · Dohlen Grün – Terminwunsch beider Teams (Leitung)");
      await expect(sheet.getByTestId("draw-team-q6")).toContainText("getauscht");

      await sheet.getByTestId("draw-apply").click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId("draw-state-1")).toContainText("Los Nr. 1 – übernommen am Mi 20. Jänner 2027 · 19:05");
      expect(sent).toEqual([
        ["create", {}],
        ["swap", { squad_id: "q5", other_squad_id: "q6", reason: "Terminwunsch beider Teams" }],
        ["apply", { fingerprint: "fp2", confirm: true }],
      ]);
      // Nachlesen geht weiter, ändern nicht mehr.
      await page.getByTestId("draw-open-1").click();
      await expect(page.getByTestId("draw-log")).toContainText("Übernommen, Leitung");
      await expect(page.getByTestId("draw-apply")).toHaveCount(0);
    });

    test(`Platzprüfung in „Neue Season aus …“ bei ${width} px: Hinweis je Liga, Anlegen bleibt möglich`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/admin/leagues/seasons/s1#ligen");
      await page.getByTestId("season-successor").click();
      const sheet = page.getByTestId("successor-sheet");
      await expect(sheet.getByTestId("successor-capacity")).toContainText("Nicht jede Liga kommt mit ihren bisherigen Staffeln aus.");
      await expect(sheet.getByTestId("successor-seats-1")).toHaveAttribute("data-fits", "no");
      await expect(sheet.getByTestId("successor-seats-1")).toContainText(SEATS_1);
      await expect(sheet.getByTestId("successor-seats-2")).toHaveAttribute("data-fits", "yes");
      await sheet.getByTestId("successor-start").fill("2027-02-02");
      await sheet.getByTestId("successor-start").blur();
      await expect(sheet.getByTestId("successor-create")).toBeEnabled();
      await sheet.getByTestId("successor-capacity").evaluate((node) => node.scrollIntoView({ block: "start" }));
      await noSideScroll(page);
      await shot(page, `platzpruefung-${width}`);
    });

    test(`Eingang bei ${width} px: neues Co-Team zuerst in die unterste Liga, höher nur mit Grund`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      let sent = null;
      await page.route("**/api/admin/leagues/seasons/s2/applications", json(INBOX));
      await page.route("**/api/admin/leagues/seasons/s2/applications/n1/assign", (route) => {
        sent = route.request().postDataJSON();
        return json({ ...NEW_TEAM, assignment: { tournament_id: "t2" } })(route);
      });
      await page.goto("/admin/leagues/seasons/s2#anmeldungen");
      const select = page.getByTestId("application-staffel-n1");
      await expect(select.locator("option")).toHaveText(["Staffel wählen …", "Liga 2 · Staffel A (0 von 4)",
        "Liga 1 · Staffel A (1 von 4) – höhere Liga, nur mit Grund", "Liga 1 · Staffel B (0 von 4) – höhere Liga, nur mit Grund"]);
      await select.selectOption("t2");
      await expect(page.getByTestId("application-assign-n1")).toBeDisabled();
      await page.getByTestId("application-deviation-n1").fill("Sieger der Turnierserie 2026");
      await noSideScroll(page);
      await page.getByTestId("application-assign-n1").click();
      await expect.poll(() => sent).toEqual({ tournament_id: "t2", deviation_reason: "Sieger der Turnierserie 2026" });
    });
  }

  // Härtetest mit den längsten Werten, die der Server annimmt: Teamname 60 Zeichen plus Co-Team, ein Wort ohne Trennstelle, fünf Staffeln,
  // eine leere Staffel, ein Grund mit 500 Zeichen, genau ein Co-Team. Nichts schiebt die Seite zur Seite, jeder Knopf bleibt erreichbar.
  for (const [width, height] of [[320, 700], [1440, 900]]) {
    test(`Vorschau des Loses hält die längsten Werte aus bei ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      const long = "Aleksandra-Wiśniewska-Kowalczyk-Gedächtnis-Gaming-Gemeinschaft · Zweite Mannschaft der Reserve";
      const word = "Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichenverein · Rindfleischetikettierungsüberwachung";
      const reason = `${"Beide Teams haben um den Tausch gebeten, weil ihre Spieler unter der Woche Schicht arbeiten. ".repeat(5)}Ende.`.slice(0, 500);
      const teamRow = (squad, name, extra = {}) => ({ squad_id: squad, application_id: `a-${squad}`, display_name: name, swapped: false, done: false, ...extra });
      const hard = { ...DRAW, number: 12,
        staffeln: [
          { tournament_id: "t1", staffel: "A", capacity: 20, seated: [long], size: 3, teams: [teamRow("w1", long, { swapped: true }), teamRow("w2", word)] },
          { tournament_id: "t2", staffel: "B", capacity: 20, seated: [], size: 1, teams: [teamRow("w3", "Jo")] },
          { tournament_id: "t4", staffel: "C", capacity: 20, seated: [], size: 0, teams: [] },
          { tournament_id: "t5", staffel: "D", capacity: 20, seated: [word], size: 2, teams: [teamRow("w4", "X · Y")] },
          { tournament_id: "t6", staffel: "E", capacity: 20, seated: [], size: 1, teams: [teamRow("w5", long)] },
        ],
        swaps: [{ a: "w1", b: "w3", a_name: long, b_name: word, reason, at: AT, by_name: "Bartholomäus Fitzgerald-Montgomery von und zu Hohenlohe-Langenburg" }],
        log: [{ action: "create", number: 12, at: AT, by_name: "Gelöschter User" },
          { action: "redraw", number: 12, at: AT, by_name: "Bartholomäus Fitzgerald-Montgomery von und zu Hohenlohe-Langenburg", reason, conflict_reason: reason }] };
      const division = { ...LIGA_1, label: "Liga 3 · Die Liga der außergewöhnlichen Gentlemen", draw: hard, can_draw: false,
        waiting: [{ application_id: "a-w3", squad_id: "w3", display_name: "Jo", carry_over: false }],
        suggestion: { ...LIGA_2.suggestion, text: `${LIGA_2.suggestion.text} ${word}` } };
      await page.route("**/api/admin/leagues/seasons/s2/draws", json({ superadmin: true, siblings_allowed: false, divisions: [division] }));
      await page.goto("/admin/leagues/seasons/s2#auslosung");
      await expect(page.getByTestId("draw-division-1")).toContainText("1 Co-Team wartet auf eine Staffel");
      await noSideScroll(page);
      await page.getByTestId("draw-open-1").click();
      const sheet = page.getByTestId("draw-sheet");
      await expect(sheet.getByTestId("draw-staffel-C")).toContainText("Kein Team.");
      await expect(sheet.getByTestId("draw-staffel-B")).toContainText("1 von 20 Plätzen");
      await noSideScroll(page);
      // Das Blatt selbst scrollt auch nicht zur Seite, und der Tausch-Knopf neben dem längsten Namen liegt im Bild.
      const inner = await sheet.evaluate((node) => Math.max(...Array.from(node.querySelectorAll("*")).map((child) => child.scrollWidth - child.clientWidth)));
      expect(inner).toBeLessThanOrEqual(1);
      for (const squad of ["w1", "w2", "w5"]) {
        const button = sheet.getByTestId(`draw-swap-open-${squad}`);
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.width).toBeGreaterThanOrEqual(40);
      }
      await sheet.getByTestId("draw-swap-open-w3").click();
      await expect(sheet.getByTestId("draw-swap-with").locator("option")).toHaveCount(5);
      // Der Tausch steht unter fünf Staffeln: Nach dem Klick liegt er im Bild, nicht unter dem Rand.
      await expect(sheet.getByTestId("draw-swap-with")).toBeInViewport();
      await noSideScroll(page);
      await shot(page, `haertetest-los-${width}`);
    });
  }
});

// Plätze über Staffeln hinweg (#1627, docs/LIGA.md „F.2 … Zielregel je Zone“) im Reiter „Abschluss“: Kandidaten mit Schnitt je Spiel,
// Gleichstand an der Grenze, Entscheid ohne Los - bei 390 und 1440 px, dazu mit den längsten Namen bei 320 px.
const standing = (index, name) => ({ registration_id: `r${index}`, display_name: name, rank: index, played: 3, won: 4 - index, drawn: 0, lost: index - 1,
  score_for: 8 - index, score_against: index, score_diff: 8 - 2 * index, points: 12 - 3 * index, form: [], zone: index === 1 ? "promotion" : null });
const closeRow = (id, letter, extra = {}) => ({
  tournament_id: id, title: `Probe-Liga · Liga 2 · Staffel ${letter}`, staffel: letter, division_label: "Liga 2", status: "live", champion_place: false, own_team: false,
  history: [], closed: false, final: null, standings: [standing(1, `Probe ${letter}1`), standing(2, `Probe ${letter}2`), standing(3, `Probe ${letter}3`)],
  table_rules: { allow_draws: false, tiebreakers: ["head_to_head", "lead_decision"] }, blockers: [], ties: [], can_decide: true, champion: null, can_close: true,
  closed_by_me: false, can_reopen: false, zones_label: "1 Aufsteiger · dazu 1 bester Nächstplatzierter über alle Staffeln · unterste Liga: kein Abstieg", ...extra });
const crossCandidate = (id, name, letter, extra = {}) => ({ registration_id: id, display_name: name, tournament_id: `c${letter}`, staffel: letter, rank: 2, played: 3, points: 6,
  score_diff: 2, points_per_game: 2, map_diff_per_game: 0.667, chosen: false, tied: true, ...extra });
const crossTie = (names) => ({ kind: "promote_best", open: 1, registration_ids: ["ra", "rb"], names, staffeln: ["A", "B"] });
const closing = (names, sideExtra = {}, decided = false) => ({
  season: { id: "s2", name: "Season 2", status: "active", closed: false }, can_act: true, superadmin: true, responsible: "„Season konfigurieren“", successor: null,
  methods: { playoff: "Entscheidungsspiel", lot: "Los", lead: "Entscheid der Leitung" }, cross_methods: { playoff: "Entscheidungsspiel", lead: "Entscheid der Leitung" },
  staffeln: [closeRow("cA", "A", { closed: true, can_close: false, status: "completed",
    final: { id: "f1", version: 1, closed_at: "2027-04-13T17:00:00+00:00", closed_by_name: "Leitung", champion: null, decisions: [] } }),
  closeRow("cB", "B", decided ? {} : { can_close: false, blockers: [{ code: "zone_cross_tie", label: "Gleichstand zwischen den Staffeln", count: 1,
    text: "Über die Staffeln hinweg stehen Teams gleich, aber nur ein Teil bekommt den Platz.", items: [{ text: names.join(" – "), url: "/admin/leagues/seasons/s2#abschluss" }] }] })],
  cross: [{ division_id: "d2", label: "Liga 2", final: false, sides: [{ kind: "promote_best", label: "Aufstieg über den Vergleich der Staffeln", count: 1, zone: "promotion",
    own_team: false, decision: null, tie: crossTie(names), candidates: [crossCandidate("ra", names[0], "A"), crossCandidate("rb", names[1], "B")], ...sideExtra }] }],
});

test.describe("Liga: Plätze über Staffeln hinweg", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Gleichstand zwischen Staffeln entscheiden bei ${width} px: Kandidaten, Art ohne Los, Grund`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      const names = ["Sturmfalken · Falken Rot", "Wüstenfüchse · Füchse A"];
      let decided = false;
      let sent = null;
      await page.route("**/api/admin/leagues/seasons/s2/closing", (route) => json(decided
        ? closing(names, { tie: null, decision: { registration_ids: ["rb"], names: [names[1]], tied: ["ra", "rb"], method: "playoff", method_label: "Entscheidungsspiel", reason: "Entscheidungsspiel 3:1" },
          candidates: [crossCandidate("rb", names[1], "B", { chosen: true, tied: false }), crossCandidate("ra", names[0], "A", { tied: false, passed: true })] }, true)
        : closing(names))(route));
      await page.route("**/api/admin/leagues/divisions/d2/zone-decision", (route) => {
        sent = route.request().postDataJSON();
        decided = true;
        return json({ ok: true })(route);
      });
      await page.goto("/admin/leagues/seasons/s2#abschluss");
      const section = page.getByTestId("cross-division-d2");
      await expect(section).toContainText("Liga 2 · Plätze über Staffeln hinweg");
      await expect(page.getByTestId("cross-status-d2")).toContainText("Stand von jetzt");
      await expect(page.getByTestId("cross-candidate-ra")).toContainText("Staffel A, Platz 2 · 2,00 Punkte je Spiel · +0,67 Maps je Spiel");
      await expect(page.getByTestId("cross-candidate-ra")).toContainText("Gleichstand");
      await expect(page.getByTestId("close-blocker-cB-zone_cross_tie")).toContainText("Gleichstand zwischen den Staffeln");
      await expect(page.getByTestId("close-button-cB")).toBeDisabled();
      await noSideScroll(page);
      await page.getByTestId("cross-decide-d2-promote_best").click();
      const sheet = page.getByTestId("cross-decision-sheet");
      await expect(sheet.getByTestId("cross-decision-method").locator("option")).toHaveText(["Bitte wählen …", "Entscheidungsspiel", "Entscheid der Leitung"]);
      await expect(sheet.getByTestId("cross-decision-save")).toBeDisabled();
      await sheet.getByTestId("cross-decision-pick-rb").check();
      await sheet.getByTestId("cross-decision-method").selectOption("playoff");
      await sheet.getByTestId("cross-decision-reason").fill("Entscheidungsspiel 3:1");
      await noSideScroll(page);
      await shot(page, `staffelvergleich-entscheid-${width}`);
      await sheet.getByTestId("cross-decision-save").click();
      await expect.poll(() => sent).toEqual({ kind: "promote_best", registration_ids: ["rb"], method: "playoff", reason: "Entscheidungsspiel 3:1" });
      await expect(page.getByTestId("cross-decision-d2-promote_best")).toContainText("Entscheid: Wüstenfüchse · Füchse A – Entscheidungsspiel: Entscheidungsspiel 3:1");
      await expect(page.getByTestId("cross-candidate-rb")).toContainText("steigt auf");
      await expect(page.getByTestId("cross-candidate-ra")).toContainText("bleibt");
      await expect(page.getByTestId("cross-tie-d2-promote_best")).toHaveCount(0);
      // Mit dem Entscheid entfällt der Sperrgrund: Die letzte Staffel lässt sich abschließen.
      await expect(page.getByTestId("close-blocker-cB-zone_cross_tie")).toHaveCount(0);
      await expect(page.getByTestId("close-button-cB")).toBeEnabled();
      await section.scrollIntoViewIfNeeded();
      await shot(page, `staffelvergleich-${width}`);
    });
  }

  test("die längsten Namen bei 320 px: nichts schiebt die Seite zur Seite, der Knopf bleibt erreichbar", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await mockServer(page);
    const names = ["Aleksandra-Wiśniewska-Kowalczyk-Gedächtnis-Gaming-Gemeinschaft · Zweite Mannschaft der Reserve",
      "Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichenverein · Rindfleischetikettierungsüberwachung"];
    await page.route("**/api/admin/leagues/seasons/s2/closing", json(closing(names)));
    await page.goto("/admin/leagues/seasons/s2#abschluss");
    await expect(page.getByTestId("cross-tie-d2-promote_best")).toContainText("Nur einer bekommt den Platz.");
    await noSideScroll(page);
    const button = page.getByTestId("cross-decide-d2-promote_best");
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await button.click();
    await expect(page.getByTestId("cross-decision-pick-rb")).toBeVisible();
    await noSideScroll(page);
  });
});

