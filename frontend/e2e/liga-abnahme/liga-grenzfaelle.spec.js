const { test, expect } = require("@playwright/test");
const g1 = require("./g1");

const {
  ADMIN, LARGE, MINUTE, SMALL, WIDTHS, api, as, assign, buildLeague, checkIn, done, get, job, noSideScroll, ok, pattern,
  registrationIndex, resultsOf, seriesGames, shot, staffelMatches, standings, state,
} = g1;

// Liga-Gesamtabnahme G.1 (#1632, docs/liga/abnahme.md), zweiter Teil: was neben dem Hauptweg geprüft sein muss - Rechte (auch
// negativ und bei Befangenheit), gleichzeitige Aktionen, Fehleingaben, Abbrüche, Sperren, Gleichstand mehrerer Teams
// (Szenario 16) und Altdaten (Season ohne die neuen Felder). Eigene Ligen mit je vier Co-Teams aus der Testwelt, echte API,
// echtes MongoDB, Browser bei 390 und 1440 px. Keine Zeit in Echtzeit, alle Namen erfunden.

const edge = {};
const tie = {};
const legacy = {};
const unique = () => `${g1.RUN}-${Date.now().toString(36)}`;

/** Das Spiel zwischen zwei Indizes der Testwelt, mit Heim, Gast und Sieger (kleinerer Index). */
function matchOf(world, a, b) {
  const match = world.matches.find((row) => {
    const sides = row.slots.map((slot) => world.index[slot.registration_id]).sort();
    return sides[0] === Math.min(a, b) && sides[1] === Math.max(a, b);
  });
  const [home, away] = match.slots.map((slot) => slot.registration_id);
  const byIndex = Object.fromEntries(Object.entries(world.index).map(([reg, index]) => [index, reg]));
  return { id: match.id, home, away, homeIndex: world.index[home], awayIndex: world.index[away], winner: byIndex[Math.min(a, b)], loser: byIndex[Math.max(a, b)] };
}

async function timeNow(lead, matchId) {
  await ok(lead, "PATCH", `/api/matches/${matchId}`, { scheduled_at: new Date(Date.now() + 5 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin jetzt" });
}

async function start(lead, world) {
  await ok(lead, "POST", `/api/tournaments/${world.tid}/status`, { status: "live" });
  world.matches = await staffelMatches(lead, world.tid);
  world.index = await registrationIndex(lead, world.tid);
}

test.describe("Liga-Gesamtabnahme: Grenzfälle gegen echte API und MongoDB", () => {
  test.skip(!g1.READY, g1.SKIP_REASON);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Anmeldung: zwei Annahmen gleichzeitig auf den letzten Platz, Rückzug nach der Annahme, Rechte der Anmeldung", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    Object.assign(edge, await buildLeague(admin, lead, { name: `Grenzfall-Liga ${unique()}` }));
    const seasonAdmin = `${ADMIN}/seasons/${edge.season.id}`;
    await ok(lead, "PATCH", seasonAdmin, { visibility: "public" });
    await ok(lead, "PATCH", seasonAdmin, { application_slots: 2,
      application_opens_at: new Date(Date.now() - 60 * MINUTE).toISOString(), application_closes_at: new Date(Date.now() + 24 * 60 * MINUTE).toISOString() });
    const base = `/api/leagues/${edge.league.slug}/${edge.season.slug}`;
    const apps = {};
    for (const index of [0, 1, 2]) {
      const captain = await as(browser, testInfo, `captain-${index}`, LARGE);
      apps[index] = (await ok(captain, "POST", `${base}/applications`, { squad_id: state.teams[index].squad_id, rule_version_id: edge.rule.id, accept_rules: true, accept_privacy: true })).id;
      await captain.close();
    }
    // Rechte: ein Mitglied ohne Rolle und die Teamleitung reichen nicht ein; ohne Zustimmung geht es nicht.
    const member = await as(browser, testInfo, "member-3", LARGE);
    const byMember = await api(member, "POST", `${base}/applications`, { squad_id: state.teams[3].squad_id, rule_version_id: edge.rule.id, accept_rules: true, accept_privacy: true });
    expect(byMember.status).toBe(403);
    await member.close();
    const captain3 = await as(browser, testInfo, "captain-3", LARGE);
    const noConsent = await api(captain3, "POST", `${base}/applications`, { squad_id: state.teams[3].squad_id, rule_version_id: edge.rule.id, accept_rules: false, accept_privacy: true });
    expect(noConsent.status).toBe(422);
    await captain3.close();

    const inbox = `${seasonAdmin}/applications`;
    await ok(lead, "POST", `${inbox}/${apps[0]}/accept`, { tournament_id: edge.tid });
    // Der letzte Platz: zwei Annahmen im selben Moment - genau eine gilt.
    const [one, two] = await Promise.all([apps[1], apps[2]].map((id) => api(lead, "POST", `${inbox}/${id}/accept`, { tournament_id: edge.tid })));
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect((one.status === 409 ? one : two).text).toContain("Startplätze");
    const waiting = one.status === 409 ? 1 : 2;
    const admitted = waiting === 1 ? 2 : 1;
    await ok(lead, "POST", `${inbox}/${apps[waiting]}/waitlist`, {});
    // Rückzug nach der Annahme geht nur noch über die Leitung.
    const captain = await as(browser, testInfo, `captain-${admitted}`, LARGE);
    const late = await api(captain, "POST", `${base}/applications/${apps[admitted]}/withdraw`, {});
    expect(late.status).toBe(409);
    await captain.close();
    // Ablehnung braucht einen Grund.
    const shortReason = await api(lead, "POST", `${inbox}/${apps[waiting]}/reject`, { reason: "nö" });
    expect(shortReason.status).toBe(422);
    // Die Leitung teilt die übrigen zwei Co-Teams direkt zu (Admin-Weg bleibt).
    await ok(lead, "PATCH", seasonAdmin, { application_slots: 4 });
    await ok(lead, "POST", `${inbox}/${apps[waiting]}/accept`, { tournament_id: edge.tid });
    await assign(lead, edge.tid, 3);
    expect(await get(lead, `/api/tournaments/${edge.tid}/registrations`)).toHaveLength(4);
    await done(admin, lead);
  });

  test("Rechte: Turnierleitung ohne Bereich Ligen, Fremde, Mitglieder, Leitung im Veto, Befangenheit", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    await start(lead, edge);
    const seasonAdmin = `${ADMIN}/seasons/${edge.season.id}`;

    const tournament = await as(browser, testInfo, "tournament", LARGE);
    expect((await api(tournament, "GET", seasonAdmin)).status).toBe(403);
    expect((await api(tournament, "POST", `${seasonAdmin}/sanctions`, { kind: "warning", target_type: "squad", registration_id: Object.keys(edge.index)[0], rule_ref: "Anlage C.1", reason: "Ohne Recht nicht möglich." })).status).toBe(403);
    await tournament.close();
    const outsider = await as(browser, testInfo, "outsider", LARGE);
    expect((await api(outsider, "POST", ADMIN, { name: "Fremde Liga", game_id: state.game.id })).status).toBe(403);

    const play = matchOf(edge, 0, 1);
    edge.race = play;
    await timeNow(lead, play.id);
    expect((await api(outsider, "POST", `/api/matches/${play.id}/checkin`, { present: [] })).status).toBe(403);
    await outsider.close();
    const member = await as(browser, testInfo, `member-${play.homeIndex}`, LARGE);
    expect((await api(member, "POST", `/api/matches/${play.id}/schedule-proposals`, { scheduled_at: new Date(Date.now() + 60 * MINUTE).toISOString() })).status).toBe(403);
    expect((await api(member, "POST", `/api/matches/${play.id}/checkin`, { present: [] })).status).toBe(403);
    await member.close();

    // Befangenheit: Die Liga-Leitung, die selbst im Co-Team von Index 0 spielt, trägt bei diesem Spiel nichts ein und straft ihr Team nicht.
    const biased = await as(browser, testInfo, "biased", LARGE);
    const own = await api(biased, "POST", `/api/matches/${play.id}/result`, { results: resultsOf(play.winner, play.loser, "3:0"),
      games: seriesGames(pattern("3:0", play.winner, play.loser), play.home, play.away, { maps: edge.maps }) });
    expect(own.status).toBe(403);
    expect(own.text).toContain("beteiligt");
    const ownTeam = Object.entries(edge.index).find(([, index]) => index === 0)[0];
    const sanction = await api(biased, "POST", `${seasonAdmin}/sanctions`, { kind: "warning", target_type: "squad", registration_id: ownTeam, rule_ref: "Anlage C.1", reason: "Eigenes Team, darf nicht gehen." });
    expect(sanction.status).toBe(403);
    // Ein fremdes Spiel darf dieselbe Person entscheiden.
    const other = matchOf(edge, 2, 3);
    expect((await api(biased, "GET", `/api/matches/${other.id}/page`)).status).toBe(200);
    await biased.page.goto(`/matches/${play.id}`);
    await noSideScroll(biased.page);
    await shot(biased.page, "g1-befangen-1440.png");
    await done(biased, lead);
  });

  test("Gleichzeitig und Fehleingaben: Check-in beider Seiten, zwei Züge im selben Moment, falsche Meldungen, zwei gleiche Meldungen", async ({ browser }, testInfo) => {
    const play = edge.race;
    const lead = await as(browser, testInfo, "lead", LARGE);
    const homeCaptain = await as(browser, testInfo, `captain-${play.homeIndex}`, SMALL);
    const homeVice = await as(browser, testInfo, `vice-${play.homeIndex}`, LARGE);
    const away = await as(browser, testInfo, `captain-${play.awayIndex}`, LARGE);
    const awayVice = await as(browser, testInfo, `vice-${play.awayIndex}`, LARGE);
    const sides = { [play.home]: [homeCaptain, homeVice], [play.away]: [away, awayVice] };

    // Zu wenige Anwesende: 422. Dann beide Seiten im selben Moment.
    const one = await api(homeCaptain, "POST", `/api/matches/${play.id}/checkin`, { present: (await g1.presentOf(homeCaptain, play.id, 1)) });
    expect(one.status).toBe(422);
    const presentHome = await g1.presentOf(homeCaptain, play.id);
    const presentAway = await g1.presentOf(away, play.id);
    const both = await Promise.all([
      api(homeCaptain, "POST", `/api/matches/${play.id}/checkin`, { present: presentHome }),
      api(away, "POST", `/api/matches/${play.id}/checkin`, { present: presentAway }),
    ]);
    expect(both.map((row) => row.status)).toEqual([200, 200]);

    let block = (await get(lead, `/api/matches/${play.id}/veto`)).veto;
    expect(block.status).toBe("running");
    // Die Leitung zieht nie selbst, die falsche Seite ist nicht dran.
    expect((await api(lead, "POST", `/api/matches/${play.id}/veto/pick`, { map_id: block.options[0].map_id, version: block.version })).status).toBe(403);
    const wrongSide = sides[block.current.registration_id === play.home ? play.away : play.home][0];
    expect((await api(wrongSide, "POST", `/api/matches/${play.id}/veto/pick`, { map_id: block.options[0].map_id, version: block.version })).status).toBe(409);
    // Captain und Vertreter derselben Seite wählen im selben Moment verschiedene Maps - genau ein Zug zählt.
    const [captain, vice] = sides[block.current.registration_id];
    const [first, second] = block.options.filter((row) => row.allowed);
    const race = await Promise.all([
      api(captain, "POST", `/api/matches/${play.id}/veto/pick`, { map_id: first.map_id, version: block.version }),
      api(vice, "POST", `/api/matches/${play.id}/veto/pick`, { map_id: second.map_id, version: block.version }),
    ]);
    expect(race.map((row) => row.status).sort()).toEqual([200, 409]);
    const after = (await get(lead, `/api/matches/${play.id}/veto`)).veto;
    expect(after.history).toHaveLength(1);
    // Abbruch und Wiederaufnahme durch die Leitung: pausiert nimmt der Server keinen Zug an.
    await ok(lead, "POST", `/api/matches/${play.id}/veto/lead`, { action: "pause", reason: "Verbindung eines Teams weg", version: after.version });
    block = (await get(lead, `/api/matches/${play.id}/veto`)).veto;
    expect(block.status).toBe("paused");
    const paused = await api(sides[block.current.registration_id][0], "POST", `/api/matches/${play.id}/veto/pick`, { map_id: block.options.find((row) => row.allowed)?.map_id || first.map_id, version: block.version });
    expect(paused.status).toBe(409);
    await ok(lead, "POST", `/api/matches/${play.id}/veto/lead`, { action: "resume", reason: "Verbindung wieder da", version: block.version });
    block = await g1.playVeto({ [play.home]: homeCaptain, [play.away]: away }, play.id);

    // Fehleingaben beim Melden: Stand passt nicht zu den Maps, Map nicht laut Veto, Punkte fehlen, Ziel nicht erreicht.
    const winners = pattern("3:1", play.winner, play.loser);
    const games = seriesGames(winners, play.home, play.away, { planned: block.planned_games });
    const reporter = sides[play.winner][0];
    const lineup = await g1.presentOf(reporter, play.id, 3);
    // Eine Map aus dem Stellung-Pool, die das Veto nicht für Map 1 vorsieht.
    const otherMap = g1.POOL.stellung.map((name) => edge.maps[name].id).find((id) => id !== block.planned_games[0].map_id);
    const cases = [
      [{ results: resultsOf(play.winner, play.loser, "3:0"), games }, "laut Maps"],
      [{ results: resultsOf(play.winner, play.loser, "3:1"), games: games.map((row, index) => (index === 0 ? { ...row, map_id: otherMap } : row)) }, "Veto"],
      [{ results: resultsOf(play.winner, play.loser, "3:1"), games: games.map(({ scores, ...row }) => row) }, "Pflicht"],
      [{ results: resultsOf(play.winner, play.loser, "3:1"), games: games.map((row) => ({ ...row, scores: { [play.winner]: 5, [play.loser]: 2 } })) }, ""],
    ];
    for (const [body, hint] of cases) {
      const refused = await api(reporter, "POST", `/api/matches/${play.id}/report`, { ...body, lineup });
      expect(refused.status, refused.text).toBe(422);
      if (hint) expect(refused.text).toContain(hint);
    }
    // Erst melden, dann bestätigen beide Seiten im selben Moment mit derselben Meldung: gezählt wird einmal.
    const results = resultsOf(play.winner, play.loser, "3:1");
    await ok(reporter, "POST", `/api/matches/${play.id}/report`, { results, games, lineup });
    const confirmers = sides[play.loser];
    const confirmLineup = await g1.presentOf(confirmers[0], play.id, 3);
    const confirms = await Promise.all(confirmers.map((person) => api(person, "POST", `/api/matches/${play.id}/report`, { results, games, lineup: confirmLineup })));
    expect(confirms.some((row) => row.status === 200)).toBe(true);
    expect(confirms.every((row) => [200, 409].includes(row.status))).toBe(true);
    const table = await standings(lead, edge.tid);
    expect(table[play.winner]).toMatchObject({ played: 1, points: 3, score_for: 3, score_against: 1 });
    expect(table[play.loser]).toMatchObject({ played: 1, points: 0 });
    await homeCaptain.page.goto(`/matches/${play.id}`);
    await expect(homeCaptain.page.getByTestId("match-outcome")).toBeVisible();
    await noSideScroll(homeCaptain.page);
    await done(homeCaptain, homeVice, away, awayVice, lead);
  });

  test("Abbrüche und Sperren: Terminänderung macht den Check-in ungültig, Einwand zurückgezogen, gesperrtes Konto, gesperrte Staffel", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const admin = await as(browser, testInfo, "admin", LARGE);
    const play = matchOf(edge, 2, 3);
    const home = await as(browser, testInfo, `captain-${play.homeIndex}`, LARGE);
    const away = await as(browser, testInfo, `captain-${play.awayIndex}`, SMALL);

    await timeNow(lead, play.id);
    await checkIn(home, play.id);
    let page = await get(home, `/api/matches/${play.id}/page`);
    expect(page.checkin.sides.find((row) => row.own).checked_in).toBe(true);
    // Neuer Termin der Leitung: Der Check-in gehört zum alten Termin und zählt nicht mehr.
    await ok(lead, "PATCH", `/api/matches/${play.id}`, { scheduled_at: new Date(Date.now() + 8 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin verlegt" });
    page = await get(home, `/api/matches/${play.id}/page`);
    expect(page.checkin.sides.find((row) => row.own).checked_in).toBe(false);

    // Gesperrtes Konto (Moderation, D-4): Der Spieler steht nicht mehr zur Wahl, der Check-in mit ihm geht nicht.
    const bannedId = state.accounts[`member-${play.awayIndex}`].id;
    await ok(admin, "POST", `/api/users/${bannedId}/ban`, { reason: "Abnahme: Konto gesperrt" });
    page = await get(away, `/api/matches/${play.id}/page`);
    expect(page.checkin.roster.find((row) => row.id === bannedId).blocked).toBeTruthy();
    const withBanned = await api(away, "POST", `/api/matches/${play.id}/checkin`, { present: page.checkin.roster.map((row) => row.id).slice(0, 4) });
    expect(withBanned.status).toBe(422);
    await ok(admin, "POST", `/api/users/${bannedId}/unban`, {});
    await checkIn(home, play.id);
    await checkIn(away, play.id);
    const block = await g1.playVeto({ [play.home]: home, [play.away]: away }, play.id);

    // Einwand vor der Bestätigung - und zurückgezogen: Das Spiel geht in den Stand davor, die Gegenseite kann bestätigen.
    const winners = pattern("3:2", play.winner, play.loser);
    const games = seriesGames(winners, play.home, play.away, { planned: block.planned_games });
    const results = resultsOf(play.winner, play.loser, "3:2");
    const reporter = play.winner === play.home ? home : away;
    const other = reporter === home ? away : home;
    await ok(reporter, "POST", `/api/matches/${play.id}/report`, { results, games, lineup: await g1.presentOf(reporter, play.id, 3) });
    const objection = await ok(other, "POST", `/api/matches/${play.id}/dispute`, { reason: "Wir prüfen die Aufzeichnung der Map 5 noch.", reason_key: "other" });
    expect((await get(lead, `/api/matches/${play.id}/page`)).match.status).toBe("disputed");
    await ok(other, "POST", `/api/matches/${play.id}/procedures/${objection.procedure_id}/withdraw`, {});
    expect((await get(lead, `/api/matches/${play.id}/page`)).match.status).not.toBe("disputed");
    await ok(other, "POST", `/api/matches/${play.id}/report`, { results, games, lineup: await g1.presentOf(other, play.id, 3) });
    expect((await get(lead, `/api/matches/${play.id}/page`)).match.status).toBe("completed");
    await done(home, away);

    // Die restlichen Spiele der Staffel trägt die Leitung ein, Fristen sind in der Testzeit vorbei: Abschluss, danach ist alles gesperrt.
    for (const row of edge.matches.filter((match) => ![edge.race.id, play.id].includes(match.id))) {
      const [rHome, rAway] = row.slots.map((slot) => slot.registration_id);
      const [winner, loser] = edge.index[rHome] < edge.index[rAway] ? [rHome, rAway] : [rAway, rHome];
      await ok(lead, "POST", `/api/matches/${row.id}/result`, { results: resultsOf(winner, loser, "3:0"), games: seriesGames(pattern("3:0", winner, loser), rHome, rAway, { maps: edge.maps }) });
    }
    job("age", { tournament: edge.tid, days: 3 });
    await ok(lead, "POST", `${ADMIN}/staffeln/${edge.tid}/close`, { confirm: true });
    const again = await api(lead, "POST", `${ADMIN}/staffeln/${edge.tid}/close`, { confirm: true });
    expect(again.status).toBe(409);
    const forfeit = await api(lead, "POST", `/api/matches/${play.id}/forfeit?force=true`, { forfeit_registration_id: play.loser, note: "Nach dem Abschluss nicht mehr" });
    expect(forfeit.status).toBe(409);
    // Wieder öffnen nur durch eine zweite Person.
    const selfReopen = await api(lead, "POST", `${ADMIN}/staffeln/${edge.tid}/reopen`, { reason: "Korrektur nötig, Ergebnis falsch" });
    expect(selfReopen.status).toBe(403);
    await done(lead, admin);
  });

  /** Ergebnisse nach Plan eintragen: [Index A, Index B, Index des Siegers, Stand]. */
  async function playPlan(lead, world, plan) {
    const byIndex = Object.fromEntries(Object.entries(world.index).map(([reg, index]) => [index, reg]));
    for (const [a, b, winnerIndex, score] of plan) {
      const play = matchOf(world, a, b);
      const winner = byIndex[winnerIndex];
      const loser = winner === play.home ? play.away : play.home;
      await ok(lead, "POST", `/api/matches/${play.id}/result`, { results: resultsOf(winner, loser, score), games: seriesGames(pattern(score, winner, loser), play.home, play.away, { maps: world.maps }) });
    }
    return byIndex;
  }

  async function tieLeague(admin, lead, world, name, indices) {
    Object.assign(world, await buildLeague(admin, lead, { name: `${name} ${unique()}` }));
    await ok(lead, "PATCH", `${ADMIN}/seasons/${world.season.id}`, { visibility: "public" });
    for (const index of indices) await assign(lead, world.tid, index);
    await start(lead, world);
  }

  test("Szenario 16: Gleichstand dreier Teams - Mini-Tabelle, und ein echter Gleichstand, den die Leitung entscheidet", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    // A (4) schlägt B (5) 3:0, B schlägt C (6) 3:1, C schlägt A 3:2; alle drei schlagen D (7) - je 6 Punkte. Mini-Tabelle nach
    // Punkten, Map-Differenz, gewonnenen Maps (docs/LIGA.md, E.1): alle 3 Punkte; Differenz A +2, B -1, C -1; gewonnene Maps
    // untereinander C 4, B 3. Reihenfolge A, C, B, D - alle drei über den direkten Vergleich.
    await tieLeague(admin, lead, tie, "Gleichstand-Liga", [4, 5, 6, 7]);
    await playPlan(lead, tie, [[4, 5, 4, "3:0"], [5, 6, 5, "3:1"], [4, 6, 6, "3:2"], [4, 7, 4, "3:0"], [5, 7, 5, "3:0"], [6, 7, 6, "3:0"]]);
    const rows = (await get(lead, `/api/tournaments/${tie.tid}/standings`)).sort((x, y) => x.rank - y.rank);
    expect(rows.map((row) => tie.index[row.registration_id])).toEqual([4, 6, 5, 7]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.slice(0, 3).map((row) => row.points)).toEqual([6, 6, 6]);
    expect(rows.slice(0, 3).every((row) => row.tiebreak === "head_to_head")).toBe(true);
    expect((await get(lead, `${ADMIN}/staffeln/${tie.tid}/table`)).ties).toEqual([]);

    // Echter Gleichstand: drei Teams gewinnen im Kreis je 3:1 und schlagen D 3:0 - gleich in allem. Sie teilen sich Platz 1, bis
    // die Leitung entscheidet (letzte Stufe, Platz 1 der obersten Liga nur mit Verfahren).
    const patt = {};
    await tieLeague(admin, lead, patt, "Patt-Liga", [12, 13, 14, 15]);
    const byIndex = await playPlan(lead, patt, [[12, 13, 12, "3:1"], [13, 14, 13, "3:1"], [12, 14, 14, "3:1"], [12, 15, 12, "3:0"], [13, 15, 13, "3:0"], [14, 15, 14, "3:0"]]);
    let shared = (await get(lead, `/api/tournaments/${patt.tid}/standings`)).sort((x, y) => x.rank - y.rank);
    expect(shared.map((row) => row.rank)).toEqual([1, 1, 1, 4]);
    const table = await get(lead, `${ADMIN}/staffeln/${patt.tid}/table`);
    expect(table.ties).toHaveLength(1);
    expect(table.ties[0].registration_ids.sort()).toEqual([byIndex[12], byIndex[13], byIndex[14]].sort());
    const decision = `${ADMIN}/staffeln/${patt.tid}/table-decision`;
    const order = [byIndex[13], byIndex[14], byIndex[12]];
    const noMethod = await api(lead, "PUT", decision, { registration_ids: order, reason: "Losentscheid der Leitung vor beiden Teams" });
    expect(noMethod.status).toBe(422);
    await ok(lead, "PUT", decision, { registration_ids: order, reason: "Losentscheid der Leitung vor allen drei Teams", method: "lot" });
    shared = (await get(lead, `/api/tournaments/${patt.tid}/standings`)).sort((x, y) => x.rank - y.rank);
    expect(shared.map((row) => patt.index[row.registration_id])).toEqual([13, 14, 12, 15]);
    expect(shared.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(shared.slice(0, 3).every((row) => row.tiebreak === "lead_decision")).toBe(true);

    for (const viewport of WIDTHS) {
      const guest = await as(browser, testInfo, "anon", viewport);
      for (const world of [tie, patt]) {
        await guest.page.goto(`/liga/${world.league.slug}/${world.season.slug}`);
        await expect(guest.page.getByTestId("league-staffel-A")).toBeVisible();
        await noSideScroll(guest.page);
      }
      await shot(guest.page, `g1-gleichstand-${viewport.width}.png`);
      await done(guest);
    }
    await done(admin, lead);
  });

  test("Altdaten: Season ohne die neuen Felder - Melden ohne Check-in und Veto, Tabelle 3/1/0, Seiten fehlerfrei", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    Object.assign(legacy, await buildLeague(admin, lead, { name: `Altbestand-Liga ${unique()}` }));
    for (const index of [8, 9, 10, 11]) await assign(lead, legacy.tid, index);
    // Eine Season, die schon vor dem Liga-Masterplan öffentlich war - danach ohne Check-in-, Veto-, Ergebnis-, Tabellen-,
    // Protest- und Kaderfelder, wie der Altbestand in der Datenbank aussieht.
    await ok(lead, "PATCH", `${ADMIN}/seasons/${legacy.season.id}`, { visibility: "public" });
    const stripped = job("legacy", { season: legacy.season.id });
    expect(stripped.season).toBe(1);
    await start(lead, legacy);
    const play = matchOf(legacy, 8, 9);
    const home = await as(browser, testInfo, `captain-${play.homeIndex}`, LARGE);
    const away = await as(browser, testInfo, `captain-${play.awayIndex}`, SMALL);
    const page = await get(home, `/api/matches/${play.id}/page`);
    expect(page.checkin?.veto?.status || "none").not.toBe("running");
    // Alte Meldung: Aufstellung je Map, keine Punkte nötig.
    const rosterOf = (index) => state.teams[index].members.slice(0, 4);
    const winners = pattern("3:1", play.winner, play.loser);
    const gamesFor = (index) => winners.map((winner, position) => ({ position: position + 1, mode: g1.MODE_ORDER[position],
      map_id: legacy.maps[g1.POOL[g1.MODE_ORDER[position]][position % g1.POOL[g1.MODE_ORDER[position]].length]].id, winner_registration_id: winner, lineup: rosterOf(index) }));
    const results = resultsOf(play.winner, play.loser, "3:1");
    const first = play.winner === play.home ? home : away;
    const second = first === home ? away : home;
    const firstIndex = legacy.index[play.winner];
    await ok(first, "POST", `/api/matches/${play.id}/report`, { results, games: gamesFor(firstIndex) });
    await ok(second, "POST", `/api/matches/${play.id}/report`, { results, games: gamesFor(legacy.index[play.loser]) });
    expect((await get(lead, `/api/matches/${play.id}/page`)).match.status).toBe("completed");
    const table = await standings(lead, legacy.tid);
    expect(table[play.winner]).toMatchObject({ points: 3, score_for: 3, score_against: 1 });
    const settings = await get(lead, `${ADMIN}/seasons/${legacy.season.id}/protest-settings`);
    expect(settings.active).toBe(false);
    for (const [person, viewport] of [[home, LARGE], [away, SMALL]]) {
      await person.page.goto(`/matches/${play.id}`);
      await expect(person.page.getByTestId("match-outcome")).toBeVisible();
      await noSideScroll(person.page);
      await shot(person.page, `g1-altdaten-${viewport.width}.png`);
    }
    await done(home, away);
    for (const viewport of WIDTHS) {
      const guest = await as(browser, testInfo, "anon", viewport);
      await guest.page.goto(`/liga/${legacy.league.slug}/${legacy.season.slug}`);
      await expect(guest.page.getByTestId("league-staffel-A")).toBeVisible();
      await noSideScroll(guest.page);
      await done(guest);
    }
    await done(admin, lead);
  });
});
