const { test, expect } = require("@playwright/test");
const g1 = require("./g1");

const {
  ADMIN, LARGE, SMALL, api, as, assign, buildLeague, done, get, job, noSideScroll, ok, pattern, registrationIndex, resultsOf,
  seriesGames, shot, staffelMatches, standings, state,
} = g1;

// Liga-Gesamtabnahme, Erweiterung zur Betriebsfreigabe (#1632, docs/liga/abnahme.md, „Saisonende“): alles, was nach G.1 dazukam -
// Playoffs und Relegation (#2404, LIGA.md F.6), der Saisonende-Moment (#1639, F.8) und die Startrechte der Folge-Season (#1627, F.2a) -
// an einer Liga mit zwei Liga N gegen das echte Backend und ein echtes MongoDB.
//
// Unabhängig vom Los (#2570): Spielplan und Setzliste werden gelost bzw. gerechnet. Die Spec greift nie auf einen Platz im Spielplan zu,
// sondern immer auf ein Co-Team über seinen Index der Testwelt. Es gewinnt das Co-Team mit dem kleineren Index - Tabelle, Setzliste,
// Relegation und Folge-Season stehen damit vorher fest. Ausnahmen sind ausdrücklich gewählt (Finale, Relegation, Korrektur).
//
// Liga 1: Index 0 bis 5 (Playoffs der besten vier, Platz 5 spielt Relegation, Platz 6 steigt ab). Liga 2: Index 6 bis 11 (Platz 1
// steigt auf, Platz 2 spielt Relegation, keine Playoffs). Alle Namen sind erfunden.

const STAFFELN = `${ADMIN}/staffeln`;
const UPPER = [0, 1, 2, 3, 4, 5];
const LOWER = [6, 7, 8, 9, 10, 11];
const MOMENTS = "/api/me/league-moments/unseen";
const world = {};
const unique = () => `${g1.RUN}-${Date.now().toString(36)}`;
const seasonAdmin = () => `${ADMIN}/seasons/${world.season.id}`;
const successorAdmin = () => `${ADMIN}/seasons/${world.successor.id}`;

/** Die Anmeldung eines Co-Teams (Index der Testwelt) in einer Staffel. */
function regOf(index, tid) {
  return Object.entries(world.index[tid]).find(([, value]) => value === index)?.[0];
}

/** Ein Spiel mit Heim, Gast und Sieger nach der Rangfolge (kleinerer Index) - oder dem gewählten Sieger. */
function sidesOf(match, tid, winnerIndex = null) {
  const [home, away] = match.slots.map((slot) => slot.registration_id);
  const homeIndex = world.index[tid][home];
  const awayIndex = world.index[tid][away];
  const lowerWins = winnerIndex === null ? homeIndex < awayIndex : homeIndex === winnerIndex;
  const [winner, loser] = lowerWins ? [home, away] : [away, home];
  return { id: match.id, home, away, homeIndex, awayIndex, winner, loser };
}

/** Ergebnis der Leitung (3:0) über die echte Route: Maps aus dem Pool, Punkte nach Ergebnisregel. */
async function enter(lead, play, score = "3:0") {
  const winners = pattern(score, play.winner, play.loser);
  await ok(lead, "POST", `/api/matches/${play.id}/result`, {
    results: resultsOf(play.winner, play.loser, score), games: seriesGames(winners, play.home, play.away, { maps: world.maps }) });
}

/** Alle offenen Spiele einer Staffel mit zwei Seiten: Es gewinnt der kleinere Index. */
async function playOpen(lead, tid) {
  const open = (await staffelMatches(lead, tid))
    .filter((row) => !["completed", "forfeit", "cancelled"].includes(row.status) && row.slots.filter((slot) => slot.registration_id).length === 2);
  for (const match of open) await enter(lead, sidesOf(match, tid));
  return open.length;
}

/** Abschließen nach der Protestfrist (Testzeit: Ergebnisse drei Tage zurück). */
async function close(lead, tid) {
  job("age", { tournament: tid, days: 3 });
  return ok(lead, "POST", `${STAFFELN}/${tid}/close`, { confirm: true });
}

async function cockpit(lead) {
  const view = await get(lead, `${seasonAdmin()}/postseason`);
  return (level) => view.divisions.find((row) => row.level === level);
}

/** Saisonende-Momente der Person in dieser Season (andere Specs desselben Laufs haben eigene Seasons). */
async function momentsOf(person, seasonId = world.season.id) {
  return (await get(person, MOMENTS)).moments.filter((row) => row.season_id === seasonId);
}

/** Nachrichten in der Glocke der Person zu dieser Season. */
async function bell(person, reason, seasonId = world.season.id) {
  const rows = await get(person, "/api/admin/notifications");
  return rows.filter((row) => (row.meta || {}).reason === reason && (row.meta || {}).season_id === seasonId);
}

/** Index der Testwelt zu einem Anzeigenamen (Setzliste und Paarungen nennen Namen, keine Kennungen). */
function indexOfName(name) {
  return Number(Object.entries(world.names).find(([, value]) => value === name)?.[0]);
}

/** Der übernommene Antrag eines Co-Teams in der Folge-Season, aus Sicht seines Captains. */
async function ownApplication(person, index) {
  const body = await get(person, "/api/me/league-applications");
  return body.items.find((row) => row.season_id === world.successor.id && row.squad_id === state.teams[index].squad_id);
}

async function overview(lead) {
  return get(lead, `${successorAdmin()}/start-rights`);
}

function rowOf(view, index) {
  return view.rows.find((row) => row.squad_id === state.teams[index].squad_id);
}

test.describe("Liga-Gesamtabnahme: Saisonende mit Playoffs, Relegation, Moment und Startrechten", () => {
  test.skip(!g1.READY, g1.SKIP_REASON);
  test.describe.configure({ mode: "serial", timeout: 360_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Saisonende 1: zwei Liga N mit Zonen, Playoffs, Relegation und Startrechten - die reguläre Season nach der Rangfolge", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    Object.assign(world, await buildLeague(admin, lead, { name: `Saisonende-Liga ${unique()}` }));
    world.upper = world.tid;
    // Liga 1: Platz 5 spielt Relegation, Platz 6 steigt ab. Liga 2: Platz 1 steigt auf, Platz 2 spielt Relegation.
    await ok(lead, "PATCH", `${ADMIN}/divisions/${world.division.id}`, { zones: { promote: 0, relegate: 1, playoff_promote: 0, playoff_relegate: 1 } });
    world.lower_division = await ok(lead, "POST", `${seasonAdmin()}/divisions`, { zones: { promote: 1, relegate: 0, playoff_promote: 1, playoff_relegate: 0 } });
    world.lower = (await ok(lead, "POST", `${ADMIN}/divisions/${world.lower_division.id}/staffeln`, {})).tournament_id;
    // Vorlage der Season (F.6): Playoffs der besten vier, Meister aus den Playoffs, Relegation an. Liga 2 spielt keine Playoffs (Nr. 218).
    await ok(lead, "PUT", `${seasonAdmin()}/postseason`, {
      playoffs: { enabled: true, per_staffel: 4 }, champion_source: "playoffs", relegation: { enabled: true } });
    await ok(lead, "PUT", `${ADMIN}/divisions/${world.lower_division.id}/postseason`, { playoffs: { enabled: false } });
    // Startrechte (F.2a) schon an der laufenden Season: die Folge-Season übernimmt die Einstellung (Nr. 161).
    await ok(lead, "PUT", `${seasonAdmin()}/start-rights`, { active: true, mode: "accept", accept_days: 10, successor: "next" });
    await ok(lead, "PATCH", seasonAdmin(), { visibility: "public" });

    for (const index of UPPER) await assign(lead, world.upper, index);
    for (const index of LOWER) await assign(lead, world.lower, index);
    world.index = {};
    world.names = {};
    for (const tid of [world.upper, world.lower]) {
      await ok(lead, "POST", `/api/tournaments/${tid}/status`, { status: "live" });
      world.index[tid] = await registrationIndex(lead, tid);
      for (const row of await get(lead, `/api/tournaments/${tid}/registrations`)) world.names[world.index[tid][row.id]] = row.display_name;
      expect(await playOpen(lead, tid)).toBe(15);
    }
    // Die Tabelle steht nach der Rangfolge, das Kennzeichen „Playoff-Platz“ trägt Platz 1 bis 4.
    const table = await standings(lead, world.upper);
    expect(UPPER.map((index) => table[regOf(index, world.upper)].rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(UPPER.map((index) => Boolean(table[regOf(index, world.upper)].playoff))).toEqual([true, true, true, true, false, false]);

    // Solange die reguläre Staffel offen ist, gibt es keine Setzliste - nur den Sperrgrund.
    let division = await cockpit(lead);
    expect(division(1).playoffs.state).toBe("waiting");
    expect(division(1).playoffs.blockers.map((row) => row.code)).toContain("regular_open");
    expect(division(2).playoffs).toBeNull();
    expect(division(2).relegation).toBeNull();
    for (const tid of [world.upper, world.lower]) await close(lead, tid);
    // Meister aus den Playoffs: Platz 1 ist nur Staffelsieger - noch kein Meister, noch kein Moment, die Season läuft weiter.
    const closing = await get(lead, `${seasonAdmin()}/closing`);
    expect(closing.season.closed).toBe(false);
    const leader = await as(browser, testInfo, "captain-0", SMALL);
    expect(await momentsOf(leader)).toEqual([]);
    division = await cockpit(lead);
    expect(division(1).playoffs.state).toBe("ready");
    expect(division(1).playoffs.seeds.map((row) => [row.seed, indexOfName(row.display_name)])).toEqual([[1, 0], [2, 1], [3, 2], [4, 3]]);
    expect(division(1).playoffs.pairings.map((pair) => [pair.a.seed, pair.b.seed])).toEqual([[1, 4], [2, 3]]);
    expect(division(1).relegation.state).toBe("ready");
    expect(division(1).relegation.pairs.map((pair) => [indexOfName(pair.upper.display_name), indexOfName(pair.lower.display_name)])).toEqual([[4, 7]]);
    await done(admin, lead, leader);
  });

  test("Saisonende 2: Playoffs aus dem Endstand - Doppelklick legt einmal an, das Finale macht den Meister, der Moment kommt sofort", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const division = await cockpit(lead);
    const body = { division_id: world.division.id, stamp: division(1).playoffs.stamp, confirm: true };
    const url = `${seasonAdmin()}/postseason/playoffs`;
    const answers = await Promise.all([api(lead, "POST", url, body), api(lead, "POST", url, body)]);
    expect(answers.map((row) => row.status).sort()).toEqual(expect.arrayContaining([200]));
    const created = answers.find((row) => row.status === 200).body;
    world.playoffs = created.tournament.tournament_id;
    const again = await ok(lead, "POST", url, { ...body, stamp: "veraltet" });
    expect(again.replay).toBe(true);
    expect(again.tournament.tournament_id).toBe(world.playoffs);
    world.index[world.playoffs] = await registrationIndex(lead, world.playoffs);
    expect(Object.values(world.index[world.playoffs]).sort()).toEqual([0, 1, 2, 3]);
    let matches = await staffelMatches(lead, world.playoffs);
    expect(matches).toHaveLength(3);
    // Halbfinale: 1 gegen 4, 2 gegen 3 - der besser Gesetzte ist Heimteam (Nr. 209).
    const semis = matches.filter((row) => Number(row.round) === 1).map((row) => sidesOf(row, world.playoffs));
    expect(semis.map((play) => [play.homeIndex, play.awayIndex]).sort()).toEqual([[0, 3], [1, 2]]);
    for (const play of semis) await enter(lead, play);
    // Finale: Der Zweite der Tabelle schlägt den Ersten - Meister ist der Sieger des Finales, nicht der Staffelsieger (Nr. 211).
    matches = await staffelMatches(lead, world.playoffs);
    const final = sidesOf(matches.find((row) => Number(row.round) === 2), world.playoffs, 1);
    expect([final.homeIndex, final.awayIndex]).toEqual([0, 1]);
    await enter(lead, final, "3:2");
    const closed = await close(lead, world.playoffs);
    expect(closed.champion).toBe(world.names[1]);
    const table = await standings(lead, world.playoffs);
    expect([0, 1, 2, 3].map((index) => table[regOf(index, world.playoffs)].rank)).toEqual([2, 1, 3, 3]);
    // Meister sofort (Fabian 26.11.): Liga 1 ist samt Playoffs fertig - der Moment kommt, obwohl die Relegation noch offen ist.
    const closing = await get(lead, `${seasonAdmin()}/closing`);
    expect(closing.season.closed).toBe(false);
    const champion = await as(browser, testInfo, "captain-1", SMALL);
    const own = await momentsOf(champion);
    expect(own.map((row) => row.outcome)).toEqual(["champion"]);
    // Auf- und Abstieg warten auf den Endstand der ganzen Season.
    for (const role of ["captain-0", "captain-6", "captain-5"]) {
      const person = await as(browser, testInfo, role, SMALL);
      expect(await momentsOf(person), role).toEqual([]);
      await done(person);
    }
    expect((await bell(champion, "league_moment")).map((row) => row.title)).toEqual([`Meister: ${world.names[1]}`]);
    await done(lead, champion);
  });

  test("Saisonende 3: Relegation - „beide nicht erschienen“ setzt einmal neu an, dann steigt der Untere auf; Auf- und Abstieg als Moment, einmal", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const division = await cockpit(lead);
    const created = await ok(lead, "POST", `${seasonAdmin()}/postseason/relegation`, {
      division_id: world.division.id, stamp: division(1).relegation.stamp, confirm: true });
    world.relegation = created.tournament.tournament_id;
    world.index[world.relegation] = await registrationIndex(lead, world.relegation);
    const [match] = await staffelMatches(lead, world.relegation);
    // Heimrecht hat das Team der oberen Liga N (Nr. 212).
    const play = sidesOf(match, world.relegation, 7);
    expect([play.homeIndex, play.awayIndex]).toEqual([4, 7]);
    // Beide nicht erschienen (Nr. 217, 245): beim ersten Mal einmal neu ansetzen - nichts gewertet, beide zählen als „nicht erschienen“.
    const short = await api(lead, "POST", `${STAFFELN}/${world.relegation}/matches/${play.id}/double-no-show`, { note: "weg" });
    expect(short.status).toBe(422);
    const retry = await ok(lead, "POST", `${STAFFELN}/${world.relegation}/matches/${play.id}/double-no-show`, { note: "Beide Seiten nicht erschienen, Leitung hat geprüft" });
    expect(retry.no_show_step).toBe("retry");
    const stored = (await get(lead, `/api/matches/${play.id}/page`)).match;
    expect(stored.status).not.toBe("forfeit");
    expect(stored.no_show_retry).toMatchObject({ counted: true });
    // Neu angesetzt gewinnt der Zweite der Liga 2: Er steigt auf, der Fünfte der Liga 1 steigt ab (Nr. 213).
    await enter(lead, play);
    const closed = await close(lead, world.relegation);
    expect(closed.season_status).toBe("completed");

    // Folge-Season (F.2): Die Relegation wirkt - Liga 1 mit den besten vier, dem Aufsteiger und dem Sieger der Relegation.
    const preview = await get(lead, `${seasonAdmin()}/successor`);
    expect(preview.can_create).toBe(true);
    const levels = Object.fromEntries(preview.divisions.map((row) => [row.level, row.teams.map((team) => state.teams.findIndex((item) => item.squad_id === team.squad_id)).sort((a, b) => a - b)]));
    expect(levels).toEqual({ 1: [0, 1, 2, 3, 6, 7], 2: [4, 5, 8, 9, 10, 11] });
    const via = Object.fromEntries(preview.divisions.flatMap((row) => row.teams).map((team) => [state.teams.findIndex((item) => item.squad_id === team.squad_id), team.via || null]));
    expect([via[7], via[4], via[6], via[5]]).toEqual(["relegation", "relegation", null, null]);

    // Saisonende-Moment je Person (F.8): Auf- und Abstieg jetzt, der Meister bleibt einer.
    const expected = { "captain-6": "up", "vice-6": "up", "captain-7": "up", "captain-5": "down", "captain-4": "down", "captain-1": "champion" };
    for (const [role, outcome] of Object.entries(expected)) {
      const person = await as(browser, testInfo, role, SMALL);
      expect((await momentsOf(person)).map((row) => row.outcome), role).toEqual([outcome]);
      await done(person);
    }
    for (const role of ["captain-0", "captain-8"]) {
      const person = await as(browser, testInfo, role, SMALL);
      expect(await momentsOf(person), role).toEqual([]);
      await done(person);
    }

    // Im Browser (390 px): Der Moment kommt beim nächsten Besuch einmal - ein zweites Gerät zeigt ihn nicht noch einmal.
    const climber = await as(browser, testInfo, "captain-7", SMALL);
    await climber.page.goto("/");
    const moment = climber.page.getByTestId("season-moment");
    await expect(moment).toBeVisible({ timeout: 20_000 });
    await expect(moment.getByTestId("season-moment-kicker")).toHaveText("Aufstieg");
    await noSideScroll(climber.page);
    await shot(climber.page, "g1-saisonende-moment-390.png");
    await moment.getByTestId("season-moment-close").click();
    await expect(moment).toHaveCount(0);
    expect(await momentsOf(climber)).toEqual([]);
    const second = await as(browser, testInfo, "captain-7", LARGE);
    await second.page.goto("/");
    await expect(second.page.locator("main").first()).toBeVisible();
    await second.page.waitForTimeout(1500);
    await expect(second.page.getByTestId("season-moment")).toHaveCount(0);
    // Eine Nachricht je Person: Captain und Vertreter erfahren den Aufstieg aus „Aufstieg bestätigt“ der Startrechte (F.2a) - der
    // Moment schickt ihnen keine zweite. Spieler bekommen die Nachricht zum Moment.
    expect(await bell(climber, "league_moment")).toEqual([]);
    expect((await bell(climber, "league_start_right")).map((row) => row.title)).toEqual(["Aufstieg bestätigt"]);
    const player = await as(browser, testInfo, "member-7", SMALL);
    expect((await bell(player, "league_moment")).map((row) => row.title)).toEqual(["Aufstieg in Liga 1"]);
    expect(await bell(player, "league_start_right")).toEqual([]);
    await done(lead, climber, second, player);
  });

  test("Saisonende 4: Folge-Season mit Startrechten - Zusage einmal, Pause beim Wiederöffnen, Korrektur der Relegation, Neuberechnen", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const lead2 = await as(browser, testInfo, "lead2", LARGE);
    const start = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const created = await ok(lead, "POST", `${seasonAdmin()}/successor`, { start_date: `${start}T00:00:00`, confirm: true });
    world.successor = created.season;
    let view = await overview(lead);
    expect(view.rows).toHaveLength(12);
    expect(view.rows.every((row) => row.state === "offered")).toBe(true);

    // Zusage (F.2a): Captain und Vertreter des Aufsteigers gleichzeitig - zählt einmal.
    const captain6 = await as(browser, testInfo, "captain-6", SMALL);
    const vice6 = await as(browser, testInfo, "vice-6", LARGE);
    const application6 = await ownApplication(captain6, 6);
    expect(application6.carry_over.start_right).toMatchObject({ state: "offered", can_accept: true });
    const both = await Promise.all([captain6, vice6].map((person) => ok(person, "POST", `/api/me/league-applications/${application6.id}/start-right`, { action: "accept" })));
    expect(both.filter((row) => row.replay).length).toBe(1);
    // Weitere Zusagen: alle außer Index 3 (Liga 1), 4 und 7 (die Relegation) sowie 8 (Liga 2).
    for (const index of [0, 1, 2, 5, 9, 10, 11]) {
      const person = await as(browser, testInfo, `captain-${index}`, SMALL);
      const own = await ownApplication(person, index);
      await ok(person, "POST", `/api/me/league-applications/${own.id}/start-right`, { action: "accept" });
      await done(person);
    }
    view = await overview(lead);
    expect([0, 1, 2, 5, 6, 9, 10, 11].map((index) => rowOf(view, index).state)).toEqual(Array(8).fill("accepted"));

    // Pause (Entscheidung 26.11.): Die zweite Leitung öffnet die Relegation wieder - die Fristen ruhen, Zusagen bleibt möglich.
    await ok(lead2, "POST", `${STAFFELN}/${world.relegation}/reopen`, { reason: "Ergebnis der Relegation vertauscht eingetragen" });
    view = await overview(lead);
    expect(view.paused).toBe(true);
    const captain8 = await as(browser, testInfo, "captain-8", SMALL);
    const paused = await ownApplication(captain8, 8);
    expect(paused.carry_over.start_right).toMatchObject({ state: "offered", paused: true, accept_until: null, can_accept: true });
    // Korrektur mit Grund: Der Obere hat die Relegation gewonnen - alle bleiben in ihrer Liga N.
    const [match] = await staffelMatches(lead, world.relegation);
    const corrected = sidesOf(match, world.relegation, 4);
    const winners = pattern("3:1", corrected.winner, corrected.loser);
    await ok(lead, "POST", `/api/matches/${corrected.id}/result?force=true`, {
      results: resultsOf(corrected.winner, corrected.loser, "3:1"), games: seriesGames(winners, corrected.home, corrected.away, { maps: world.maps }),
      reason: "Laut Aufzeichnung hat das Team der Liga 1 gewonnen." });
    await close(lead, world.relegation);
    view = await overview(lead);
    expect(view.paused).toBe(false);

    // Korrektur B (F.8): Der Moment des alten Aufsteigers fällt weg, wer davon erfuhr, liest einmal „Endstand korrigiert“; ein neuer
    // Moment entsteht nicht (er bleibt). Captain und Vertreter sagt es die Nachricht der Startrechte, Spielern die zum Moment.
    const climber = await as(browser, testInfo, "captain-7", SMALL);
    expect(await momentsOf(climber)).toEqual([]);
    expect((await bell(climber, "league_start_right")).map((row) => row.title).sort()).toEqual(["Aufstieg bestätigt", "Endstand korrigiert"]);
    const player = await as(browser, testInfo, "member-7", SMALL);
    expect((await bell(player, "league_moment")).map((row) => row.title).sort()).toEqual(["Aufstieg in Liga 1", "Endstand korrigiert"]);
    await done(player);

    // Übernahme neu berechnen (Nr. 162): Index 4 bleibt in Liga 1, Index 7 in Liga 2 - jeweils mit neuer Zusage.
    const recompute = await get(lead, `${successorAdmin()}/successor/recompute`);
    expect(recompute.can_run).toBe(true);
    await ok(lead, "POST", `${successorAdmin()}/successor/recompute`, { confirm: true, stamp: recompute.stamp });
    const captain4 = await as(browser, testInfo, "captain-4", SMALL);
    const own4 = await ownApplication(captain4, 4);
    expect(own4.carry_over.division_label).toMatch(/^Liga 1/);
    expect(own4.carry_over.start_right.state).toBe("offered");
    const own7 = await ownApplication(climber, 7);
    expect(own7.carry_over.division_label).toMatch(/^Liga 2/);
    expect(own7.carry_over.start_right.state).toBe("offered");
    await done(lead, lead2, captain6, vice6, captain8, climber, captain4);
  });

  test("Saisonende 5: Startrechte - Absage mit Nachrücker, Verfall nach der Frist, Startdatum: die Leitung entscheidet", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    // Absage (Abmelden): Index 4 gibt seinen Platz in Liga 1 auf. Er blieb dort - es rückt der beste Absteiger nach (Index 5).
    const captain4 = await as(browser, testInfo, "captain-4", SMALL);
    const own4 = await ownApplication(captain4, 4);
    await ok(captain4, "POST", `/api/me/league-applications/${own4.id}/withdraw`);
    const captain5 = await as(browser, testInfo, "captain-5", SMALL);
    const fill = await ownApplication(captain5, 5);
    expect(fill.carry_over.division_label).toMatch(/^Liga 1/);
    expect(fill.carry_over.start_right).toMatchObject({ state: "offered", can_accept: true });
    expect(fill.carry_over.start_right.fills.from_label).toMatch(/^Liga 2/);
    await ok(captain5, "POST", `/api/me/league-applications/${fill.id}/start-right`, { action: "accept" });
    let view = await overview(lead);
    expect(rowOf(view, 4)).toMatchObject({ state: "declined" });
    expect(rowOf(view, 5)).toMatchObject({ state: "accepted" });

    // Frist (zehn Tage): Der Job „in elf Tagen“ lässt die Schweigenden verfallen (3, 7, 8) und vergibt den freien Platz in Liga 1
    // an den besten Nicht-Aufsteiger der Liga 2, der noch im Rennen ist (Index 9). In Liga 2 rückt niemand nach (unterste Liga N).
    const swept = job("start_rights", { season: world.successor.id, days: 11 });
    expect(swept).toMatchObject({ expired: 3, filled: 1 });
    expect(job("start_rights", { season: world.successor.id, days: 0 })).toMatchObject({ expired: 0, filled: 0, restored: 0 });
    view = await overview(lead);
    expect([3, 7, 8].map((index) => rowOf(view, index).state)).toEqual(["expired", "expired", "expired"]);
    const captain9 = await as(browser, testInfo, "captain-9", SMALL);
    const offer9 = await ownApplication(captain9, 9);
    expect(offer9.carry_over.division_label).toMatch(/^Liga 1/);
    expect(offer9.carry_over.start_right.state).toBe("offered");

    // Startdatum erreicht (Nr. 253, auch im Entwurf): nichts verfällt mehr von selbst, das Team sagt nicht mehr selbst zu - die Leitung entscheidet.
    await ok(lead, "PATCH", successorAdmin(), { start_date: `${g1.viennaDay(-1)}T00:00:00` });
    expect(job("start_rights", { season: world.successor.id, days: 30 })).toMatchObject({ expired: 0, filled: 0, restored: 0, reminded: 0 });
    const late = await api(captain9, "POST", `/api/me/league-applications/${offer9.id}/start-right`, { action: "accept" });
    expect(late.status).toBe(409);
    view = await overview(lead);
    expect(view.started).toBe(true);
    expect(rowOf(view, 9)).toMatchObject({ state: "offered", waits_for_lead: true });
    const accepted = await ok(lead, "POST", `${successorAdmin()}/start-rights/${offer9.id}/accept`, { reason: "Zusage per Nachricht an die Leitung" });
    expect(accepted).toMatchObject({ state: "accepted", accepted_via: "lead" });

    // Verwaltung (1440 px) und das eigene Team (390 px) ohne Fehler.
    await lead.page.goto(`/admin/leagues/seasons/${world.successor.id}#startrechte`);
    await expect(lead.page.locator("main").first()).toBeVisible();
    await noSideScroll(lead.page);
    await shot(lead.page, "g1-startrechte-verwaltung-1440.png");
    await captain9.page.goto(`/liga/${world.league.slug}/${world.successor.slug}`);
    await expect(captain9.page.locator("main").first()).toBeVisible();
    await noSideScroll(captain9.page);
    await shot(captain9.page, "g1-startrechte-team-390.png");
    await done(lead, captain4, captain5, captain9);
  });
});
