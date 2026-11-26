const { test, expect } = require("@playwright/test");
const g1 = require("./g1");

const {
  ADMIN, LARGE, MINUTE, SMALL, WIDTHS, api, as, buildLeague, checkIn, done, get, job, noSideScroll, ok, pattern, playVeto,
  registrationIndex, resultsOf, seriesGames, shot, staffelMatches, standings, state,
} = g1;

// Liga-Gesamtabnahme G.1 (#1632, docs/liga/abnahme.md): die 18 Szenarien aus Abschnitt 24 des Auftrags am Stück, gegen das echte
// Backend und ein echtes MongoDB, im Browser bei 390 und 1440 px. Eine Liga mit 16 Co-Teams in einer Staffel, Best of 5 mit Veto
// und Check-in, wie die Tiroler Liga sie spielt. Was die Spec über die API macht, ist dieselbe Route, die das Web aufruft; die
// Seiten öffnet sie dort, wo Menschen arbeiten, und prüft sie auf Fehler und seitliches Scrollen. Zeit läuft nie in Echtzeit:
// Fristen stößt die Spec über die Zeit-Helfer aus scripts/seed_liga_g1.py an. Alle Namen sind erfunden.
//
// Ergebnisse folgen einer festen Rangfolge: Bei jedem Spiel gewinnt das Co-Team mit dem kleineren Index im Stand. So ist die
// Endtabelle eindeutig (Meister Index 0), und die Spec kann jeden Endstand vorhersagen.

const world = {};
const leagueUrl = () => `/liga/${world.league.slug}/${world.season.slug}`;
const seasonAdmin = () => `${ADMIN}/seasons/${world.season.id}`;

/** Ein Spiel am ersten Spieltag, Heim und Gast, mit den Rollen ihrer Captains und Vertreter. */
function sidesOf(match) {
  const [home, away] = match.slots.map((slot) => slot.registration_id);
  const homeIndex = world.index[home];
  const awayIndex = world.index[away];
  const [winner, loser] = homeIndex < awayIndex ? [home, away] : [away, home];
  return { id: match.id, home, away, homeIndex, awayIndex, winner, loser, round: Number(match.round) };
}

async function openPage(person, url) {
  await person.page.goto(url);
  await expect(person.page.locator("main").first()).toBeVisible();
  await noSideScroll(person.page);
}

test.describe("Liga-Gesamtabnahme: die 18 Szenarien gegen echte API und MongoDB", () => {
  test.skip(!g1.READY, g1.SKIP_REASON);
  test.describe.configure({ mode: "serial", timeout: 360_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Szenario 1 und 2: Liga und Season anlegen, Modi, Maps, Pool, Veto-Vorlage und Regelwerk", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    Object.assign(world, await buildLeague(admin, lead, { name: `Abnahme-Liga ${g1.RUN}-${Date.now().toString(36)}` }));

    // Die Season trägt Best of 5, die Modusfolge und die Ergebnisregeln der Modi (C.3) - Punkte je Map sind Pflicht.
    const view = await get(lead, seasonAdmin());
    expect(view.season.best_of).toBe(5);
    expect(view.season.game_mode_order).toEqual(g1.MODE_ORDER);
    const rules = await get(lead, `${seasonAdmin()}/result-rules`);
    expect(JSON.stringify(rules)).toContain("250");

    // Veto-Vorlage: neue Seasons schlagen sie aus dem Pool vor (D.3) - sie passt ohne Hinweis.
    const veto = await get(lead, `${seasonAdmin()}/veto-rules`);
    expect(veto.veto_rules.enabled).toBe(true);
    expect(veto.problems).toEqual([]);
    expect(veto.veto_rules.steps.length).toBeGreaterThan(5);
    // Check-in-Regeln (D.2): Fenster 15 Minuten vor bis 15 nach dem Termin, mindestens drei Anwesende.
    const checkin = await get(lead, `${seasonAdmin()}/checkin-rules`);
    expect(checkin.checkin_rules.opens_minutes_before).toBe(15);
    expect(checkin.checkin_rules.min_present).toBe(3);

    // Veröffentlichen geht ohne Notausnahme: Pool, Regelwerk und Staffel sind da (Vorab-Prüfung, C.2).
    await ok(lead, "PATCH", seasonAdmin(), { visibility: "public" });

    for (const viewport of WIDTHS) {
      const person = await as(browser, testInfo, "lead", viewport);
      await openPage(person, `/admin/leagues/seasons/${world.season.id}`);
      await shot(person.page, `g1-season-verwaltung-${viewport.width}.png`);
      await done(person);
    }
    await done(admin, lead);
  });

  test("Szenario 3 und 4: Co-Teams melden sich über die Website an, die Leitung nimmt an und teilt zu", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    await ok(lead, "PATCH", seasonAdmin(), {
      application_opens_at: new Date(Date.now() - 60 * MINUTE).toISOString(),
      application_closes_at: new Date(Date.now() + 48 * 60 * MINUTE).toISOString(),
      application_slots: 16,
    });

    // Zwei Captains im Browser, bei 390 und 1440 px: Co-Team wählen, Prüfung, Regelwerk und Datenschutz, einreichen.
    for (const [index, viewport] of [[0, SMALL], [1, LARGE]]) {
      const captain = await as(browser, testInfo, `captain-${index}`, viewport);
      const squadId = state.teams[index].squad_id;
      await captain.page.goto(leagueUrl());
      await captain.page.getByTestId("league-application-start").click();
      await expect(captain.page.getByTestId(`apply-squad-${squadId}`)).toBeChecked();
      await captain.page.getByTestId("apply-next").click();
      await expect(captain.page.getByTestId("apply-check-ok")).toBeVisible();
      await captain.page.getByTestId("apply-next").click();
      await captain.page.getByTestId("apply-accept-rules").check();
      await captain.page.getByTestId("apply-accept-privacy").check();
      await noSideScroll(captain.page);
      await captain.page.getByTestId("apply-next").click();
      await expect(captain.page.getByTestId("apply-summary")).toContainText(state.teams[index].squad_name);
      await captain.page.getByTestId("apply-submit").click();
      await expect(captain.page.getByTestId(`league-application-row-${squadId}`)).toContainText("Eingereicht");
      // Die Season hat schon begonnen, das Fenster läuft weiter (Nachmeldung, Entscheidung Nr. 180) - die Ligaseite sagt es.
      await captain.page.goto(leagueUrl());
      await expect(captain.page.getByTestId("league-application-after-start")).toContainText("Anmeldung läuft nach Season-Start weiter (bis ");
      await noSideScroll(captain.page);
      await shot(captain.page, `g1-anmeldung-${viewport.width}.png`);
      await done(captain);
    }

    // Die übrigen 14 über dieselbe Route, die das Formular nutzt. Einer zieht zurück und reicht neu ein (Abbruch).
    const base = `/api/leagues/${world.league.slug}/${world.season.slug}`;
    for (let index = 2; index < 16; index += 1) {
      const captain = await as(browser, testInfo, `captain-${index}`, LARGE);
      const body = { squad_id: state.teams[index].squad_id, rule_version_id: world.rule.id, accept_rules: true, accept_privacy: true };
      const first = await ok(captain, "POST", `${base}/applications`, body);
      expect(first.status).toBe("submitted");
      if (index === 15) {
        const withdrawn = await ok(captain, "POST", `${base}/applications/${first.id}/withdraw`, {});
        expect(withdrawn.status).toBe("withdrawn");
        expect((await ok(captain, "POST", `${base}/applications`, body)).status).toBe("submitted");
      }
      await captain.close();
    }

    // Leitung: der Eingang zeigt 16 offene Anträge. Den ersten nimmt sie im Browser an und teilt Staffel A zu, die anderen über die Route.
    const inbox = `${seasonAdmin()}/applications`;
    const items = (await get(lead, inbox)).items.filter((row) => row.status === "submitted");
    expect(items).toHaveLength(16);
    const appOf = (index) => items.find((row) => row.squad_id === state.teams[index].squad_id).id;
    await lead.page.goto(`/admin/leagues/seasons/${world.season.id}#selbstanmeldung`);
    await expect(lead.page.getByTestId("season-form-application-after-start")).toContainText("Anmeldung läuft nach Season-Start weiter");
    await noSideScroll(lead.page);
    await lead.page.goto(`/admin/leagues/seasons/${world.season.id}#anmeldungen`);
    await lead.page.getByTestId(`application-staffel-${appOf(0)}`).selectOption(world.tid);
    await lead.page.getByTestId(`application-accept-${appOf(0)}`).click();
    await expect(lead.page.getByTestId(`application-open-staffel-${appOf(0)}`)).toBeVisible();
    await noSideScroll(lead.page);
    await shot(lead.page, "g1-anmeldung-eingang-1440.png");
    for (let index = 1; index < 16; index += 1) {
      const accepted = await ok(lead, "POST", `${inbox}/${appOf(index)}/accept`, { tournament_id: world.tid });
      expect(accepted.status).toBe("accepted");
    }
    const registrations = await get(lead, `/api/tournaments/${world.tid}/registrations`);
    expect(registrations).toHaveLength(16);
    expect(new Set(registrations.map((row) => row.squad_id)).size).toBe(16);
    await done(lead);
  });

  test("Szenario 5: Spielplan mit 16 Teams - 120 Spiele in 15 Runden", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    await ok(lead, "POST", `/api/tournaments/${world.tid}/status`, { status: "live" });
    const matches = await staffelMatches(lead, world.tid);
    expect(matches).toHaveLength(120);
    expect(new Set(matches.map((row) => row.round)).size).toBe(15);
    world.index = await registrationIndex(lead, world.tid);
    for (const registrationId of Object.keys(world.index)) {
      const own = matches.filter((row) => row.slots.some((slot) => slot.registration_id === registrationId));
      expect(own, "jedes Team spielt jeden einmal").toHaveLength(15);
    }
    world.matches = matches;
    for (const viewport of WIDTHS) {
      const guest = await as(browser, testInfo, "anon", viewport);
      await openPage(guest, `${leagueUrl()}/spieltage?staffel=${world.tid}&woche=1`);
      await expect(guest.page.getByTestId("league-plan-A")).toBeVisible();
      await shot(guest.page, `g1-spielplan-${viewport.width}.png`);
      await done(guest);
    }
    await done(lead);
  });

  test("Szenario 6 bis 10 im Browser: Termin, Check-in, Veto, BO5 3:0 melden und bestätigen", async ({ browser }, testInfo) => {
    const round1 = world.matches.filter((row) => Number(row.round) === 1).map(sidesOf);
    world.round1 = round1;
    const play = round1[0];
    world.sweep = play;
    // Heimseite bei 390 px, Gastseite bei 1440 px - beide gleichzeitig angemeldet.
    const home = await as(browser, testInfo, `captain-${play.homeIndex}`, SMALL);
    const away = await as(browser, testInfo, `captain-${play.awayIndex}`, LARGE);
    const people = { [play.home]: home, [play.away]: away };

    // Szenario 6: Termin - die Heimseite schlägt „in zehn Minuten“ vor, die Gastseite nimmt an. Das Check-in-Fenster ist damit offen.
    const when = new Date(Date.now() + 10 * MINUTE);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(when).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
    await home.page.goto(`/matches/${play.id}`);
    await home.page.getByTestId("match-proposal-at").fill(`${local.year}-${local.month}-${local.day}T${local.hour}:${local.minute}`);
    await home.page.getByRole("button", { name: "Vorschlagen" }).click();
    await expect(home.page.getByTestId("match-scheduling")).toContainText("wartet auf die Gegenseite");
    await noSideScroll(home.page);
    await away.page.goto(`/matches/${play.id}`);
    await away.page.locator('[data-testid^="match-proposal-accept-"]').click();
    await expect(away.page.locator('[data-testid^="match-proposal-status-"]').first()).toContainText("angenommen");
    await shot(away.page, "g1-termin-1440.png");

    // Szenario 7: Check-in - jede Seite hakt drei Anwesende an. Danach startet das Veto von selbst.
    for (const person of [home, away]) {
      await person.page.goto(`/matches/${play.id}`);
      await expect(person.page.getByTestId("checkin-headline")).toHaveText("Check-in offen");
      const roster = (await get(person, `/api/matches/${play.id}/page`)).checkin.roster.filter((row) => !row.blocked);
      for (const row of roster.slice(0, 3)) await person.page.getByTestId(`checkin-roster-${row.id}`).check();
      await noSideScroll(person.page);
      await person.page.getByTestId("checkin-submit").click();
    }
    await expect(away.page.getByTestId("veto-headline")).toHaveText("Veto läuft");

    // Szenario 8: das ganze Veto im Browser - die Seite am Zug tippt die erste zulässige Map an, bis die Spielreihenfolge steht.
    let block = (await get(home, `/api/matches/${play.id}/veto`)).veto;
    for (let guard = 0; guard < 40 && block.status === "running"; guard += 1) {
      const actor = people[block.current.registration_id];
      await actor.page.goto(`/matches/${play.id}`);
      await expect(actor.page.getByTestId("veto-panel")).toHaveAttribute("data-own-turn", "true");
      const option = block.options.find((row) => row.allowed);
      if (guard < 2) {
        await noSideScroll(actor.page);
        await shot(actor.page, `g1-veto-am-zug-${actor === home ? 390 : 1440}.png`);
      }
      await actor.page.getByTestId(`veto-option-${option.map_id}`).click();
      await expect.poll(async () => (await get(actor, `/api/matches/${play.id}/veto`)).veto.version).toBeGreaterThan(block.version);
      block = (await get(actor, `/api/matches/${play.id}/veto`)).veto;
    }
    expect(block.status).toBe("done");
    expect(block.planned_games.map((row) => row.position)).toEqual([1, 2, 3, 4, 5]);
    expect(block.planned_games.map((row) => row.mode)).toEqual(g1.MODE_ORDER);
    // Eine Map kommt in der Serie nur in einem anderen Modus wieder vor.
    const pairs = block.planned_games.map((row) => `${row.map_id}:${row.mode}`);
    expect(new Set(pairs).size).toBe(5);
    world.planned = block.planned_games;

    // Start und Szenario 9 (3:0): die Seite des Siegers meldet im Formular mit den Maps laut Veto und ihrer Teilnehmerliste.
    const reporter = people[play.winner];
    const confirmer = people[play.loser];
    await reporter.page.goto(`/matches/${play.id}`);
    await reporter.page.getByTestId("checkin-start-button").click();
    await expect(reporter.page.getByTestId("checkin-headline")).toHaveText("Spiel läuft");
    await expect(reporter.page.getByTestId("match-report-form")).toBeVisible();
    await expect(reporter.page.getByTestId("league-game-1-planned")).toContainText("laut Veto");
    for (let position = 1; position <= 3; position += 1) {
      const mode = g1.MODE_ORDER[position - 1];
      await reporter.page.getByTestId(`league-game-${position}-score-${play.winner}`).fill(String(g1.TARGET[mode]));
      await reporter.page.getByTestId(`league-game-${position}-score-${play.loser}`).fill(String(mode === "stellung" ? 180 : 1));
    }
    const chips = reporter.page.getByTestId("league-participants").getByRole("button");
    for (let chip = 0; chip < 3; chip += 1) await chips.nth(chip).click();
    await expect(reporter.page.getByTestId("match-report-sentence")).toContainText("3:0");
    await noSideScroll(reporter.page);
    await shot(reporter.page, `g1-melden-${reporter === home ? 390 : 1440}.png`);
    await reporter.page.getByTestId("match-report-submit").click();
    await expect(reporter.page.getByTestId("match-report-state")).toHaveAttribute("data-status", "waiting");

    // Szenario 10: die Gegenseite bestätigt mit ihrer Teilnehmerliste.
    await confirmer.page.goto(`/matches/${play.id}`);
    await expect(confirmer.page.getByTestId("match-report-state")).toHaveAttribute("data-status", "confirm");
    const lineup = confirmer.page.getByTestId("league-confirm-participants").getByRole("button");
    for (let chip = 0; chip < 3; chip += 1) await lineup.nth(chip).click();
    await noSideScroll(confirmer.page);
    await confirmer.page.getByTestId("match-report-confirm").click();
    await expect(confirmer.page.getByTestId("match-outcome")).toBeVisible();
    await shot(confirmer.page, `g1-bestaetigt-${confirmer === home ? 390 : 1440}.png`);

    const stored = (await get(home, `/api/matches/${play.id}/page`)).match;
    expect(stored.status).toBe("completed");
    expect(stored.games).toHaveLength(3);
    expect(stored.games.map((row) => row.map_id)).toEqual(world.planned.slice(0, 3).map((row) => row.map_id));
    await done(home, away);
  });

  /** Ein ganzes Spiel über die Routen des Webs: Termin auf gleich (Leitung), Check-in, Veto, Meldung, Bestätigung. */
  async function playSeries(browser, testInfo, play, score, { timeout = false, reportBy = "loser" } = {}) {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const home = await as(browser, testInfo, `captain-${play.homeIndex}`, LARGE);
    const away = await as(browser, testInfo, `vice-${play.awayIndex}`, LARGE);
    const people = { [play.home]: home, [play.away]: away };
    await ok(lead, "PATCH", `/api/matches/${play.id}`, { scheduled_at: new Date(Date.now() + 5 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin jetzt" });
    await checkIn(home, play.id);
    await checkIn(away, play.id);
    if (timeout) {
      // Veto-Zeitüberschreitung (60 Sekunden je Schritt): der Job läuft „zwei Minuten später“ und wählt per Los eine zulässige Map.
      const before = (await get(home, `/api/matches/${play.id}/veto`)).veto;
      expect(before.status).toBe("running");
      expect(job("veto", { tournament: world.tid, minutes: 2 }).auto).toBeGreaterThanOrEqual(1);
      const after = (await get(home, `/api/matches/${play.id}/veto`)).veto;
      expect(after.history[0].via).toBe("auto");
    }
    const block = await playVeto(people, play.id);
    const winners = pattern(score, play.winner, play.loser);
    const games = seriesGames(winners, play.home, play.away, { planned: block.planned_games });
    const results = resultsOf(play.winner, play.loser, score);
    const first = people[reportBy === "loser" ? play.loser : play.winner];
    const second = first === home ? away : home;
    const reported = await ok(first, "POST", `/api/matches/${play.id}/report`, { results, games, lineup: await g1.presentOf(first, play.id, 3) });
    expect(reported.report_status).toBe("waiting");
    await ok(second, "POST", `/api/matches/${play.id}/report`, { results, games, lineup: await g1.presentOf(second, play.id, 3) });
    const stored = (await get(lead, `/api/matches/${play.id}/page`)).match;
    expect(stored.status).toBe("completed");
    expect(stored.games).toHaveLength(winners.length);
    await done(lead, home, away);
    return stored;
  }

  test("Szenario 9: BO5 3:1 (mit Veto-Zeitüberschreitung) und 3:2", async ({ browser }, testInfo) => {
    await playSeries(browser, testInfo, world.round1[1], "3:1", { timeout: true });
    await playSeries(browser, testInfo, world.round1[2], "3:2", { reportBy: "winner" });
  });

  test("Szenario 11: Die Tabelle rechnet Punkte und Maps sofort", async ({ browser }, testInfo) => {
    const guest = await as(browser, testInfo, "anon", LARGE);
    const table = await standings(guest, world.tid);
    for (const [play, won, lost] of [[world.round1[0], 3, 0], [world.round1[1], 3, 1], [world.round1[2], 3, 2]]) {
      expect(table[play.winner]).toMatchObject({ points: 3, played: 1, won: 1, score_for: won, score_against: lost });
      expect(table[play.loser]).toMatchObject({ points: 0, played: 1, lost: 1, score_for: lost, score_against: won });
    }
    expect(table[world.round1[0].winner].rank).toBe(1);
    await done(guest);
    for (const viewport of WIDTHS) {
      const person = await as(browser, testInfo, "anon", viewport);
      await openPage(person, leagueUrl());
      await expect(person.page.getByTestId("league-staffel-A")).toBeVisible();
      await shot(person.page, `g1-tabelle-${viewport.width}.png`);
      await done(person);
    }
  });

  test("Szenario 12 und 13: Protest nach der Bestätigung, Stellungnahme, Korrektur mit Grund, Einspruch an eine zweite Person", async ({ browser }, testInfo) => {
    const play = world.round1[2]; // 3:2 bestätigt
    const loser = await as(browser, testInfo, `captain-${world.index[play.loser]}`, SMALL);
    const winner = await as(browser, testInfo, `captain-${world.index[play.winner]}`, LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    const lead2 = await as(browser, testInfo, "lead2", LARGE);
    const before = await standings(lead, world.tid);

    // Szenario 12: Protest der unterlegenen Seite - Grund „falsches Ergebnis“ mit dem behaupteten Stand. Der Sieg zählt vorläufig.
    const protest = await ok(loser, "POST", `/api/matches/${play.id}/dispute`, {
      reason: "Map 3 ging laut Aufzeichnung an uns, nicht an die Gegenseite.", reason_key: "wrong_result",
      claimed: { results: [{ registration_id: play.loser, score: 3 }, { registration_id: play.winner, score: 2 }] } });
    const procedure = protest.procedure_id;
    expect(procedure).toBeTruthy();
    let stored = (await get(lead, `/api/matches/${play.id}/page`)).match;
    expect(stored.contested).toBe(true);
    expect((await standings(lead, world.tid))[play.winner].points).toBe(before[play.winner].points);
    // Ein zweiter Protest derselben Seite wird abgewiesen.
    const twice = await api(loser, "POST", `/api/matches/${play.id}/dispute`, { reason: "Noch einmal derselbe Protest zur Map 3.", reason_key: "other" });
    expect(twice.status).toBe(409);

    // Stellungnahme der Gegenseite, die Leitung übernimmt den Fall.
    await ok(winner, "POST", `/api/matches/${play.id}/procedures/${procedure}/statement`, { text: "Map 3 haben wir laut Aufzeichnung gewonnen, Map 4 ging verloren." });
    await ok(lead, "POST", `/api/matches/${play.id}/procedures/${procedure}/assign`, {});
    await openPage(lead, `/matches/${play.id}`);
    await shot(lead.page, "g1-protest-leitung-1440.png");
    await openPage(loser, `/matches/${play.id}`);
    await shot(loser.page, "g1-protest-team-390.png");

    // Szenario 13: Korrektur der Leitung mit Grund - Endstand 3:1 statt 3:2 (Map 3 und 4 anders), der Protest ist damit entschieden.
    const winners = pattern("3:1", play.winner, play.loser);
    const short = await api(lead, "POST", `/api/matches/${play.id}/result?force=true`, {
      results: resultsOf(play.winner, play.loser, "3:1"), games: seriesGames(winners, play.home, play.away, { planned: stored.planned_games }), reason: "kurz" });
    expect(short.status).toBe(422);
    await ok(lead, "POST", `/api/matches/${play.id}/result?force=true`, {
      results: resultsOf(play.winner, play.loser, "3:1"), games: seriesGames(winners, play.home, play.away, { planned: stored.planned_games }),
      reason: "Laut Aufzeichnung stand es nach vier Maps 3:1." });
    stored = (await get(lead, `/api/matches/${play.id}/page`)).match;
    expect(stored.status).toBe("completed");
    expect(stored.games).toHaveLength(4);
    const after = await standings(lead, world.tid);
    expect(after[play.winner]).toMatchObject({ points: 3, played: 1, score_for: 3, score_against: 1 });
    expect(after[play.loser]).toMatchObject({ points: 0, played: 1, score_for: 1, score_against: 3 });

    // Einspruch gegen die Korrektur: Wer entschieden hat, entscheidet nie über den Einspruch - die zweite Leitung bestätigt.
    const appeal = await ok(loser, "POST", `/api/matches/${play.id}/appeals`, { against_type: "protest_decision", ref_id: procedure, reason: "Wir sehen die Map 4 weiterhin anders." });
    const own = await api(lead, "POST", `/api/matches/${play.id}/procedures/${appeal.procedure_id}/decision`, { decision: "keep", decision_note: "Die Korrektur bleibt bestehen." });
    expect(own.status).toBe(403);
    await ok(lead2, "POST", `/api/matches/${play.id}/procedures/${appeal.procedure_id}/assign`, {});
    await ok(lead2, "POST", `/api/matches/${play.id}/procedures/${appeal.procedure_id}/decision`, { decision: "keep", decision_note: "Die Korrektur bleibt bestehen, laut Aufzeichnung 3:1." });
    const again = await api(loser, "POST", `/api/matches/${play.id}/appeals`, { against_type: "protest_decision", ref_id: procedure, reason: "Ein zweiter Einspruch zur selben Sache." });
    expect(again.status).toBe(409);
    expect((await standings(lead, world.tid))[play.winner].score_against).toBe(1);
    await done(loser, winner, lead, lead2);
  });

  test("Szenario 14: Sanktionen - Punktabzug wirkt in der Tabelle, Spielsperre im Check-in, Einspruch, Widerruf", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const lead2 = await as(browser, testInfo, "lead2", LARGE);
    const sanctions = `${seasonAdmin()}/sanctions`;
    const deducted = Object.entries(world.index).find(([, index]) => index === 10)[0];
    const before = (await standings(lead, world.tid))[deducted].points;
    const deduction = await ok(lead, "POST", sanctions, { kind: "point_deduction", target_type: "squad", registration_id: deducted, points: 2,
      rule_ref: "Anlage C.4", reason: "Unsportliches Verhalten laut Bericht der Leitung." });
    expect((await standings(lead, world.tid))[deducted]).toMatchObject({ deducted_points: 2, points: before - 2 });
    world.deduction = { registration_id: deducted, id: deduction.id };
    const zero = await api(lead, "POST", sanctions, { kind: "point_deduction", target_type: "squad", registration_id: deducted, points: 0, rule_ref: "Anlage C.4", reason: "Fehleingabe ohne Punkte." });
    expect(zero.status).toBe(422);

    // Spielsperre: Ein Spieler der Gastseite ist gesperrt - der Check-in mit ihm wird abgelehnt, ohne ihn geht er.
    const play = world.round1[3];
    const side = world.index[play.away];
    const banned = state.accounts[`member-${side}`];
    const ban = await ok(lead, "POST", sanctions, { kind: "player_ban", target_type: "player", user_id: banned.id, matches: 1,
      rule_ref: "Anlage C.4", reason: "Nachweis liegt der Leitung vor." });
    expect(ban.status).toBe("active");
    await ok(lead, "PATCH", `/api/matches/${play.id}`, { scheduled_at: new Date(Date.now() + 5 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin jetzt" });
    const away = await as(browser, testInfo, `captain-${side}`, SMALL);
    const page = await get(away, `/api/matches/${play.id}/page`);
    expect(page.checkin.roster.find((row) => row.id === banned.id).blocked).toContain("Gesperrt");
    const refused = await api(away, "POST", `/api/matches/${play.id}/checkin`, { present: page.checkin.roster.slice(0, 4).map((row) => row.id) });
    expect(refused.status).toBe(422);
    expect(refused.text).toContain("Gesperrt");
    await openPage(away, `/matches/${play.id}`);
    await shot(away.page, "g1-sperre-checkin-390.png");

    // Einspruch des Gesperrten; die Leitung, die gesperrt hat, entscheidet nicht darüber, die zweite Leitung lehnt ab.
    const player = await as(browser, testInfo, `member-${side}`, SMALL);
    await ok(player, "POST", `/api/penalties/sanctions/${ban.id}/appeal`, { text: "Ich war an dem Abend gar nicht online, bitte prüfen." });
    const own = await api(lead, "POST", `${sanctions}/${ban.id}/appeal/decision`, { decision: "upheld", note: "Bleibt bestehen." });
    expect(own.status).toBe(403);
    await ok(lead2, "POST", `${sanctions}/${ban.id}/appeal/decision`, { decision: "upheld", note: "Nachweis eindeutig, Sperre bleibt." });
    // Widerruf nimmt die Sperre zurück: Der Spieler ist wieder einsatzfähig.
    await ok(lead, "POST", `${sanctions}/${ban.id}/revoke`, { reason: "Nach Rücksprache mit dem Team aufgehoben." });
    const free = await get(away, `/api/matches/${play.id}/page`);
    expect(free.checkin.roster.find((row) => row.id === banned.id).blocked).toBeFalsy();
    await done(away, player, lead, lead2);
  });

  test("Szenario 15: Default-Win wird mit maximalen Maps gewertet und als kampflos markiert", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    // Unabhängig vom Los (#2570): Der Spielplan wird jede Nacht neu gelost. Ein festes `round1[4]` traf etwa jede achte Nacht das
    // Co-Team mit dem Punktabzug aus Szenario 14 - der bleibt bis in den Endstand, der Verlierer stand dann bei -2 statt 0. Darum
    // ein offenes Spiel des ersten Spieltags ohne dieses Co-Team (round1[0] bis [2] sind gespielt, [3] trägt die Spielsperre).
    const play = world.round1.slice(4).find((row) => ![row.winner, row.loser].includes(world.deduction.registration_id));
    expect(play, "ein offenes Spiel am ersten Spieltag ohne Punktabzug").toBeTruthy();
    const shortNote = await api(lead, "POST", `/api/matches/${play.id}/forfeit`, { forfeit_registration_id: play.loser, note: "weg" });
    expect(shortNote.status).toBe(422);
    await ok(lead, "POST", `/api/matches/${play.id}/forfeit`, { forfeit_registration_id: play.loser, note: "Gegner nicht erschienen, Leitung hat geprüft" });
    const table = await standings(lead, world.tid);
    expect(table[play.winner]).toMatchObject({ points: 3, played: 1, forfeit_won: 1, score_for: 3, score_against: 0, deducted_points: 0 });
    expect(table[play.loser]).toMatchObject({ points: 0, played: 1, forfeit_lost: 1, score_for: 0, score_against: 3, deducted_points: 0 });
    await done(lead);
    const guest = await as(browser, testInfo, "anon", SMALL);
    await openPage(guest, `${leagueUrl()}/spieltage?staffel=${world.tid}&woche=1`);
    await expect(guest.page.getByTestId(`league-match-${play.id}`)).toHaveAttribute("data-done", "true");
    await shot(guest.page, "g1-kampflos-390.png");
    await done(guest);
  });

  test("Szenario 17: Season abschließen - Belohnungen, offene Spiele, Fristen, doppelter Abschluss, Endstand, Meister", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const lead2 = await as(browser, testInfo, "lead2", LARGE);

    // Belohnungen (F.4): Gold für Platz 1 (Team und Spieler), Emblem für 2 bis 3, Banner für alle im Kader.
    await ok(lead, "PUT", `${seasonAdmin()}/rewards`, { reward_players: "roster", items: [
      { kind: "medal", name: "Goldmedaille", places: { mode: "rank", rank: 1 }, recipients: ["team", "players"] },
      { kind: "emblem", name: "Podest-Emblem", places: { mode: "range", from: 2, to: 3 }, recipients: ["team"] },
      { kind: "banner", name: "Season-Banner", places: { mode: "all" }, recipients: ["players"] },
    ] });

    // Vorher: Der Abschluss nennt die offenen Spiele.
    let closing = await get(lead, `${seasonAdmin()}/closing`);
    let staffel = closing.staffeln.find((row) => row.tournament_id === world.tid);
    expect(staffel.can_close).toBe(false);
    expect(staffel.blockers.map((row) => row.code)).toContain("open_matches");
    const early = await api(lead, "POST", `${ADMIN}/staffeln/${world.tid}/close`, { confirm: true });
    expect(early.status).toBe(409);

    // Alle übrigen Spiele trägt die Leitung ein (wie nach einem gespielten Abend): 3:0 für das Co-Team mit dem kleineren Index.
    const open = (await staffelMatches(lead, world.tid)).filter((row) => !["completed", "forfeit"].includes(row.status)).map(sidesOf);
    expect(open.length).toBeGreaterThan(100);
    for (const play of open) {
      const winners = pattern("3:0", play.winner, play.loser);
      await ok(lead, "POST", `/api/matches/${play.id}/result`, {
        results: resultsOf(play.winner, play.loser, "3:0"), games: seriesGames(winners, play.home, play.away, { maps: world.maps }) });
    }

    // Die Protestfrist (48 h) läuft noch: Abschluss erst danach. Testzeit: Ergebnisse drei Tage zurück.
    closing = await get(lead, `${seasonAdmin()}/closing`);
    staffel = closing.staffeln.find((row) => row.tournament_id === world.tid);
    expect(staffel.blockers.map((row) => row.code)).toEqual(["deadlines"]);
    job("age", { tournament: world.tid, days: 3 });
    closing = await get(lead, `${seasonAdmin()}/closing`);
    staffel = closing.staffeln.find((row) => row.tournament_id === world.tid);
    expect(staffel.blockers).toEqual([]);
    expect(staffel.can_close).toBe(true);
    const table = await standings(lead, world.tid);
    const champion = Object.entries(world.index).find(([, index]) => index === 0)[0];
    expect(table[champion].rank).toBe(1);
    expect(table[champion].points).toBe(45);
    // Punktabzug wirkt bis in den Endstand: Index 10 gewinnt 5 Spiele (15 Punkte) minus 2.
    expect(table[world.deduction.registration_id].points).toBe(13);

    for (const viewport of WIDTHS) {
      const person = await as(browser, testInfo, "lead", viewport);
      await openPage(person, `/admin/leagues/seasons/${world.season.id}`);
      await shot(person.page, `g1-abschluss-bereit-${viewport.width}.png`);
      await done(person);
    }

    // Doppelter Abschluss: zwei Leitungen gleichzeitig - genau einer gilt.
    const [one, two] = await Promise.all([lead, lead2].map((person) => api(person, "POST", `${ADMIN}/staffeln/${world.tid}/close`, { confirm: true })));
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const closed = one.status === 200 ? one.body : two.body;
    expect(closed.season_status).toBe("completed");
    world.finalVersion = closed.version;
    world.finalTable = await get(lead, `${ADMIN}/staffeln/${world.tid}/final-tables/${closed.version}`);

    // Nach dem Abschluss ist die Staffel gesperrt: kein Ergebnis, keine Sanktion mehr.
    const locked = await api(lead, "POST", `/api/matches/${open[0].id}/result?force=true`, {
      results: resultsOf(open[0].winner, open[0].loser, "3:0"), games: seriesGames(pattern("3:0", open[0].winner, open[0].loser), open[0].home, open[0].away, { maps: world.maps }),
      reason: "Nachträgliche Änderung nach dem Abschluss." });
    expect(locked.status).toBe(409);
    const lateSanction = await api(lead, "POST", `${seasonAdmin()}/sanctions`, { kind: "point_deduction", target_type: "squad", registration_id: champion, points: 1,
      rule_ref: "Anlage C.4", reason: "Nach dem Abschluss nicht mehr möglich." });
    expect(lateSanction.status).toBe(409);
    await done(lead, lead2);

    // Belohnungen aus dem Endstand: Gold beim Meister-Captain, Banner bei einem Spieler des letzten Platzes, nichts doppelt.
    const captain = await as(browser, testInfo, "captain-0", LARGE);
    const awards = (await get(captain, "/api/me/awards")).awards.map((row) => row.reward?.name).filter(Boolean);
    expect(awards.filter((name) => name === "Goldmedaille")).toHaveLength(1);
    expect(awards.filter((name) => name === "Season-Banner")).toHaveLength(1);
    await done(captain);
    const last = await as(browser, testInfo, "member-15", LARGE);
    const lastAwards = (await get(last, "/api/me/awards")).awards.map((row) => row.reward?.name).filter(Boolean);
    expect(lastAwards).toEqual(["Season-Banner"]);
    await done(last);
  });

  test("Szenario 18: Neue Season aus der Vorgängerin - Teams übernommen, Vorgängerin unverändert", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const preview = await get(lead, `${seasonAdmin()}/successor`);
    expect(preview.can_create).toBe(true);
    const start = `${g1.viennaDay(60)}T00:00:00`;
    const missing = await api(lead, "POST", `${seasonAdmin()}/successor`, { start_date: start });
    expect(missing.status).toBe(422);
    const created = await ok(lead, "POST", `${seasonAdmin()}/successor`, { start_date: start, confirm: true });
    expect(created.replay).toBe(false);
    // Doppelklick: dieselbe Season, kein zweiter Nachfolger.
    const replay = await ok(lead, "POST", `${seasonAdmin()}/successor`, { start_date: start, confirm: true });
    expect(replay.replay).toBe(true);
    expect(replay.season.id).toBe(created.season.id);
    world.successor = created.season;

    const next = await get(lead, `${ADMIN}/seasons/${created.season.id}`);
    expect(next.season).toMatchObject({ best_of: 5, status: "draft", visibility: "off", number: world.season.number + 1 });
    expect(next.season.game_mode_order).toEqual(g1.MODE_ORDER);
    expect(next.season.veto_rules.steps.length).toBeGreaterThan(5);
    // Die Vorgängerin bleibt, wie sie war: derselbe Endstand.
    const finalTable = await get(lead, `${ADMIN}/staffeln/${world.tid}/final-tables/${world.finalVersion}`);
    expect(finalTable).toEqual(world.finalTable);
    expect((await get(lead, seasonAdmin())).season.status).toBe("completed");
    for (const viewport of WIDTHS) {
      const person = await as(browser, testInfo, "lead", viewport);
      await openPage(person, `/admin/leagues/seasons/${created.season.id}`);
      await shot(person.page, `g1-folgeseason-${viewport.width}.png`);
      await done(person);
    }
    await done(lead);

    // Die Teams sind für die Folge-Season vorgemerkt - der Captain sieht seinen Antrag als angenommen.
    const captain = await as(browser, testInfo, "captain-3", LARGE);
    const mine = (await get(captain, "/api/me/league-applications")).items;
    expect(mine.some((row) => row.season_id === created.season.id && row.status === "accepted")).toBe(true);
    await done(captain);
  });

  test("Gesamtwertung über Seasons und Profil: Meister vorn, Belohnungen an Team und Spieler sichtbar", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const overall = `${ADMIN}/${world.league.id}/overall`;
    const saved = await ok(lead, "PUT", overall, { periods: [{ name: "Abnahme-Jahr", season_ids: [world.season.id] }] });
    const period = saved.periods[0].id;
    const [one, two] = await Promise.all([lead, lead].map((person) => api(person, "POST", `${overall}/${period}/levels/1/close`, { confirm: true })));
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    await done(lead);

    const guest = await as(browser, testInfo, "anon", LARGE);
    const shown = await get(guest, `/api/leagues/${world.league.slug}/${world.season.slug}/overall`);
    const first = shown.levels[0].teams[0];
    expect(first.place).toBe(1);
    expect(first.name).toContain(state.teams[0].squad_name.split(" ")[0]);
    await done(guest);

    for (const viewport of WIDTHS) {
      const person = await as(browser, testInfo, "anon", viewport);
      await openPage(person, `${leagueUrl()}/gesamtwertung`);
      await shot(person.page, `g1-gesamtwertung-${viewport.width}.png`);
      await openPage(person, `/teams/${state.teams[0].team_id}`);
      // Seit #2425 (PR #2436) stehen Turnier-Pokale und Liga-Belohnungen im Reiter „Trophäen“, nicht mehr in der Übersicht.
      // Die Medaille des Meisters liegt dort genau einmal, als Gold.
      await person.page.getByTestId("team-tab-trophies").click();
      const cabinet = person.page.getByTestId("team-trophies");
      await expect(cabinet).toBeVisible();
      const gold = cabinet.locator('[data-testid^="trophy-card-"]').filter({ hasText: "Goldmedaille" });
      await expect(gold).toHaveCount(1);
      await expect(gold).toBeVisible();
      await expect(gold).toHaveAttribute("data-metal", "gold");
      await noSideScroll(person.page);
      await shot(person.page, `g1-teamprofil-${viewport.width}.png`);
      await done(person);
    }
    const captain = await as(browser, testInfo, "captain-0", SMALL);
    const me = await get(captain, "/api/auth/me");
    await openPage(captain, `/u/${me.username}`);
    // Saisonende-Moment (#1639, Fabian 26.11.): Der Meister sieht beim nächsten Besuch zuerst seinen Moment, die Goldmedaille kommt
    // als zweite Karte im selben Ablauf - nicht mehr als eigene Zeremonie daneben.
    const moment = captain.page.getByTestId("season-moment");
    await expect(moment).toBeVisible({ timeout: 20_000 });
    await expect(moment.getByTestId("season-moment-title")).toHaveText("Meister");
    await moment.getByTestId("season-moment-done").click();
    await expect(moment.getByTestId("season-moment-rewards")).toContainText("Goldmedaille");
    await shot(captain.page, "g1-spielerprofil-moment-390.png");
    await moment.getByTestId("season-moment-done").click();
    await expect(moment).toBeHidden();
    // Im Profil unter Trophäen - die Übersicht zeigt nur zwei, bei gleichem Datum in beliebiger Reihenfolge (unabhängig vom Los, #2570).
    await captain.page.getByTestId("profile-tab-awards").click();
    await expect(captain.page.getByText("Goldmedaille").first()).toBeVisible();
    await shot(captain.page, "g1-spielerprofil-390.png");
    await done(captain);
  });
});
