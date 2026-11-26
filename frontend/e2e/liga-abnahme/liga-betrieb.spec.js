const { test, expect } = require("@playwright/test");
const g1 = require("./g1");

const {
  ADMIN, LARGE, MINUTE, SMALL, api, as, assign, buildLeague, checkIn, done, get, job, noSideScroll, ok, pattern, playVeto, presentOf,
  registrationIndex, resultsOf, seriesGames, shot, staffelMatches, standings,
} = g1;

// Liga-Gesamtabnahme, Erweiterung zur Betriebsfreigabe (#1632, docs/liga/abnahme.md, „Betrieb“): Vorfälle im Spiel (D.5), der Leitstand
// mit Protokoll und Rundnachricht (E.4) und die Erinnerungen (E.5) - gegen das echte Backend und ein echtes MongoDB, Versand gesperrt.
//
// Unabhängig vom Los (#2570): Die Spec nimmt nie einen Platz im gelosten Spielplan, sondern das Spiel zweier Co-Teams über ihre Indizes
// der Testwelt (12 bis 15). Alle Namen sind erfunden.

const world = {};
const unique = () => `${g1.RUN}-${Date.now().toString(36)}`;
const seasonAdmin = () => `${ADMIN}/seasons/${world.season.id}`;
const TEAMS = [12, 13, 14, 15];

/** Das Spiel zweier Co-Teams (Index der Testwelt), mit Heim, Gast und Sieger (kleinerer Index). */
function matchOf(a, b) {
  const match = world.matches.find((row) => {
    const sides = row.slots.map((slot) => world.index[slot.registration_id]).sort((x, y) => x - y);
    return sides[0] === Math.min(a, b) && sides[1] === Math.max(a, b);
  });
  const [home, away] = match.slots.map((slot) => slot.registration_id);
  const byIndex = Object.fromEntries(Object.entries(world.index).map(([reg, index]) => [index, reg]));
  return { id: match.id, home, away, homeIndex: world.index[home], awayIndex: world.index[away], winner: byIndex[Math.min(a, b)], loser: byIndex[Math.max(a, b)] };
}

async function bell(person, test) {
  return (await get(person, "/api/admin/notifications")).filter(test);
}

test.describe("Liga-Gesamtabnahme: Betrieb mit Vorfällen, Leitstand, Rundnachricht und Erinnerungen", () => {
  test.skip(!g1.READY, g1.SKIP_REASON);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Betrieb 1: Vorfälle im Spiel - Zustimmung, Ablehnung mit Entscheid der Leitung, der Leitstand zeigt den offenen Fall", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    Object.assign(world, await buildLeague(admin, lead, { name: `Betrieb-Liga ${unique()}` }));
    await ok(lead, "PATCH", seasonAdmin(), { visibility: "public" });
    for (const index of TEAMS) await assign(lead, world.tid, index);
    await ok(lead, "POST", `/api/tournaments/${world.tid}/status`, { status: "live" });
    world.matches = await staffelMatches(lead, world.tid);
    world.index = await registrationIndex(lead, world.tid);
    expect(world.matches).toHaveLength(6);

    // Index 12 gegen 13: Termin jetzt, Check-in beider Seiten, Veto.
    const play = matchOf(12, 13);
    world.play = play;
    const home = await as(browser, testInfo, `captain-${play.homeIndex}`, SMALL);
    const away = await as(browser, testInfo, `captain-${play.awayIndex}`, LARGE);
    const people = { [play.home]: home, [play.away]: away };
    await ok(lead, "PATCH", `/api/matches/${play.id}`, { scheduled_at: new Date(Date.now() + 5 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin jetzt" });
    await checkIn(home, play.id);
    await checkIn(away, play.id);
    const block = await playVeto(people, play.id);

    // Vorfall auf Map 1 (D.5): Verbindung weg, Vorschlag „beim Stand fortsetzen“ - die Gegenseite stimmt zu.
    const reporter = people[play.winner];
    const other = people[play.loser];
    const url = `/api/matches/${play.id}/incidents`;
    const first = await ok(reporter, "POST", url, { position: 1, kind: "disconnect", proposal: "continue_at_score",
      score: { [play.winner]: 120, [play.loser]: 90 }, note: "Verbindung eines Spielers weg, Neustart der Lobby" });
    const agreed = await ok(other, "POST", `${url}/${first.incident_id}/answer`, { accept: true });
    expect(agreed.state).toBe("agreed");
    // Vorfall auf Map 3: Rehost - die Gegenseite lehnt ab, der Fall geht an die Leitung (in Klärung).
    const second = await ok(reporter, "POST", url, { position: 3, kind: "rehost", proposal: "rehost",
      score: { [play.winner]: 2, [play.loser]: 1 }, round: 3, note: "Server abgestürzt, Rehost beim Stand verlangt" });
    const rejected = await ok(other, "POST", `${url}/${second.incident_id}/answer`, { accept: false, note: "Der Absturz kam erst nach Rundenende" });
    expect(rejected.state).toBe("in_review");
    const page = await get(lead, `/api/matches/${play.id}/page`);
    expect(page.league.map_state.find((row) => row.position === 3).state).toBe("in_clarification");

    // Leitstand (E.4): Der offene Fall steht unter „Vorfälle“ mit Weg zur Matchseite.
    const desk = await get(lead, `${seasonAdmin()}/desk`);
    const incidents = desk.groups.find((group) => group.key === "incidents");
    expect(incidents.items.map((item) => item.url)).toContainEqual(expect.stringContaining(`/matches/${play.id}`));
    expect(desk.can_broadcast).toBe(true);

    // Entscheid der Leitung mit Grund, die Serie gleich festgestellt (nichts mehr zu spielen): kein Eingriff in die Map.
    const short = await api(lead, "POST", `${url}/${second.incident_id}/decision`, { outcome: "no_action", reason: "kurz" });
    expect(short.status).toBe(422);
    const decided = await ok(lead, "POST", `${url}/${second.incident_id}/decision`, { outcome: "no_action", reason: "Nachweise geprüft, die Map lief regulär zu Ende",
      settle: { missing_positions: [], surplus_positions: [], reason: "Serie vollständig, keine Map fehlt" } });
    expect(decided.state).toBe("decided");
    const after = await get(lead, `${seasonAdmin()}/desk`);
    expect((after.groups.find((group) => group.key === "incidents")?.items || []).filter((item) => (item.url || "").includes(play.id))).toEqual([]);

    // Danach melden beide Seiten 3:1 - das Ergebnis gilt, die Tabelle zählt es einmal.
    const winners = pattern("3:1", play.winner, play.loser);
    const games = seriesGames(winners, play.home, play.away, { planned: block.planned_games });
    const results = resultsOf(play.winner, play.loser, "3:1");
    await ok(reporter, "POST", `/api/matches/${play.id}/report`, { results, games, lineup: await presentOf(reporter, play.id, 3) });
    await ok(other, "POST", `/api/matches/${play.id}/report`, { results, games, lineup: await presentOf(other, play.id, 3) });
    expect((await get(lead, `/api/matches/${play.id}/page`)).match.status).toBe("completed");
    const table = await standings(lead, world.tid);
    expect(table[play.winner]).toMatchObject({ points: 3, played: 1, score_for: 3, score_against: 1 });

    // Die Matchseite zeigt beide Vorfälle (390 px), ohne Fehler.
    await home.page.goto(`/matches/${play.id}#vorfaelle`);
    await expect(home.page.locator("main").first()).toBeVisible();
    await noSideScroll(home.page);
    await shot(home.page, "g1-vorfaelle-390.png");
    await done(admin, lead, home, away);
  });

  test("Betrieb 2: Leitstand mit Protokoll und Rundnachricht - an Captains und Vertreter, einmal je Kennung", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    // Protokoll: neueste zuerst, nur Bezeichnung und Verweise - nie Gründe oder Texte aus den Daten.
    const log = await get(lead, `${seasonAdmin()}/desk/log`);
    // Der Entscheid aus Betrieb 1 steht darin - mit Bezeichnung, handelnder Person und Spiel, ohne den Grund.
    const decided = log.items.filter((item) => item.action === "match.incident.decide" && item.match_id === world.play.id);
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({ label: "Vorfall · entschieden", actor: "Abnahme Ligaleitung" });
    expect(JSON.stringify(log)).not.toContain("Nachweise geprüft");

    const broadcast = `${seasonAdmin()}/broadcast`;
    const preview = await ok(lead, "POST", `${broadcast}/preview`, {});
    expect(preview.recipients).toBe(8);
    const players = await ok(lead, "POST", `${broadcast}/preview`, { audience: "players", scope: "staffel", scope_id: world.tid });
    expect(players.recipients).toBeGreaterThan(preview.recipients);
    const tooShort = await api(lead, "POST", broadcast, { request_id: `abnahme-${unique()}`, title: "Hi", text: "kurz" });
    expect(tooShort.status).toBe(422);
    const requestId = `abnahme-${unique()}`;
    const body = { request_id: requestId, title: "Spielwoche 2", text: "Bitte denkt an den Check-in 15 Minuten vor dem Termin." };
    const sent = await ok(lead, "POST", broadcast, body);
    expect(sent.replay).toBe(false);
    await expect.poll(async () => (await get(lead, `${broadcast}/${requestId}`)).state, { timeout: 30_000 }).toBe("sent");
    const again = await ok(lead, "POST", broadcast, body);
    expect(again.replay).toBe(true);

    // Captain und Vertreter bekommen sie genau einmal (Glocke, Versand gesperrt), ein Spieler ohne Rolle nicht.
    const isBroadcast = (row) => row.kind === "league_broadcast" && String(row.title).endsWith(": Spielwoche 2");
    for (const role of ["captain-14", "vice-14", "captain-15"]) {
      const person = await as(browser, testInfo, role, SMALL);
      expect(await bell(person, isBroadcast), role).toHaveLength(1);
      await done(person);
    }
    const member = await as(browser, testInfo, "member-14", SMALL);
    expect(await bell(member, isBroadcast)).toEqual([]);

    // Der Reiter Leitstand (1440 px) und die Glocke am Handy ohne Fehler.
    await lead.page.goto(`/admin/leagues/seasons/${world.season.id}#leitstand`);
    await expect(lead.page.locator("main").first()).toBeVisible();
    await noSideScroll(lead.page);
    await shot(lead.page, "g1-leitstand-1440.png");
    await done(lead, member);
  });

  test("Betrieb 3: Erinnerungen - „Spiel steht an“ an beide Seiten einmal, ohne Discord, ein zweiter Lauf schickt nichts", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    const rules = await get(lead, `${seasonAdmin()}/reminder-rules`);
    expect(rules.defaults).toMatchObject({ upcoming: true, upcoming_early_hours: 24, discord: false });
    await ok(lead, "PUT", `${seasonAdmin()}/reminder-rules`, { upcoming: true, upcoming_early_hours: 24, upcoming_late_minutes: 60, discord: false });

    // Index 14 gegen 15, Termin in gut einem Tag. Der Fristen-Job „in einer Stunde“ liegt 24 Stunden davor.
    const play = matchOf(14, 15);
    const when = new Date(Date.now() + 25 * 60 * MINUTE);
    await ok(lead, "PATCH", `/api/matches/${play.id}`, { scheduled_at: when.toISOString(), schedule_reason: "Abnahme: Termin morgen" });
    const isReminder = (row) => String((row.meta || {}).dedupe_key || "").startsWith(`league-upcoming:${play.id}:`);
    const captain = await as(browser, testInfo, "captain-14", SMALL);
    expect(await bell(captain, isReminder)).toEqual([]);
    job("deadlines", { tournament: world.tid, minutes: 61 });
    for (const role of ["captain-14", "captain-15"]) {
      const person = await as(browser, testInfo, role, SMALL);
      const rows = await bell(person, isReminder);
      expect(rows.map((row) => row.title), role).toEqual(["Liga-Spiel in 24 Stunden"]);
      expect(rows[0].meta).toMatchObject({ unique_dedupe: true, no_discord: true });
      await done(person);
    }
    job("deadlines", { tournament: world.tid, minutes: 62 });
    expect(await bell(captain, isReminder)).toHaveLength(1);
    // Ein neuer Termin ist ein neuer Anlass: wieder genau eine Erinnerung.
    await ok(lead, "PATCH", `/api/matches/${play.id}`, { scheduled_at: new Date(when.getTime() + 2 * 60 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin verschoben" });
    job("deadlines", { tournament: world.tid, minutes: 3 * 60 + 1 });
    expect(await bell(captain, isReminder)).toHaveLength(2);
    await done(lead, captain);
  });
});
