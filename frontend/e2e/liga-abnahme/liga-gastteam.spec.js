const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const g1 = require("./g1");

const {
  ADMIN, LARGE, MINUTE, SMALL, api, as, assign, buildLeague, checkIn, done, get, noSideScroll, ok, pattern, playVeto, presentOf,
  registrationIndex, resultsOf, seriesGames, staffelMatches, standings, state,
} = g1;

// Liga-Gesamtabnahme (#1632, docs/liga/abnahme.md), Szenario „Gastteam“ (#1665, Entscheidung Nr. 286): Der Captain (Konto ohne
// Mitgliedschaft) meldet an und sieht den Platzhalter beim Datenschutz, danach gibt die Teamleitung eine Schule ohne Freigabe des Namens an
// (erst ab dem Liga-Antrag, Entscheidung C), die Liga-Leitung nimmt an und bestätigt das Kennzeichen. Öffentlich steht erst „Gast“, mit Freigabe „Gast · Schule“, am TV nur „Gast“.
// Das Gastteam spielt und meldet sein Ergebnis wie jedes Team; in die Verwaltung kommt es nicht. Eigene Liga mit zwei Co-Teams der
// Testwelt (Index 14 als Gastteam, 15 als Gegner) - los-fest: Mit zwei Teams gibt es genau ein Spiel. Am Ende fallen Kennzeichen und
// Angabe wieder weg, die anderen Specs sehen die Testwelt unverändert. Erfundene Namen.

/** Bild nur vom Gezeigten: die Tabelle als Element - die ganze Seite zeigte eine noch leere, gestaffelt aufbauende Tabelle. */
async function shotOf(page, target, name) {
  const folder = process.env.ABNAHME_SHOTS || "";
  if (!folder) return;
  fs.mkdirSync(folder, { recursive: true });
  await page.waitForTimeout(1200);
  await target.screenshot({ path: path.join(folder, name), animations: "disabled" });
}

const GUEST = 14;
const OTHER = 15;
const PLACEHOLDER = "Für die Anmeldung speichert der Verein die Angaben deines Co-Teams.";
const unique = () => `${g1.RUN}-${Date.now().toString(36)}`;

test.describe("Liga-Gesamtabnahme: Gastteam einer Schule", () => {
  test.skip(!g1.READY, g1.SKIP_REASON);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  const team = () => state.teams[GUEST];
  const school = `Abnahme-Schule am Probeberg ${g1.RUN}`;
  let cleanup = null;

  test.afterAll(async () => {
    if (cleanup) await cleanup();
  });

  test("Gast 1: Schule angeben, anmelden, Kennzeichen bestätigen, Plakette öffentlich, Spiel melden, keine Verwaltung", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    const leader = await as(browser, testInfo, `leader-${GUEST}`, SMALL);
    const captain = await as(browser, testInfo, `captain-${GUEST}`, SMALL);
    const other = await as(browser, testInfo, `captain-${OTHER}`, LARGE);
    const markUrl = `/api/admin/leagues/teams/${team().team_id}/guest-team`;
    const orgUrl = `/api/teams/${team().team_id}/guest-team`;
    cleanup = async () => {
      await api(lead, "PUT", markUrl, { confirmed: false });
      await api(leader, "PUT", orgUrl, { kind: null, name: null, school_name_public: false });
    };

    const world = await buildLeague(admin, lead, { name: `Gast-Liga ${unique()}` });
    const seasonAdmin = `${ADMIN}/seasons/${world.season.id}`;
    await ok(lead, "PATCH", seasonAdmin, { visibility: "public", application_privacy_text: "Hinweis der Abnahme-Liga zum Datenschutz (erfunden).",
      application_opens_at: new Date(Date.now() - 60 * MINUTE).toISOString(), application_closes_at: new Date(Date.now() + 24 * 60 * MINUTE).toISOString() });
    const base = `/api/leagues/${world.league.slug}/${world.season.slug}`;

    // Captain ohne Mitgliedschaft: Datenschutz noch nicht für Gäste freigegeben - der Platzhalter. Anmelden wie jedes Team.
    const view = await get(captain, `${base}/application`);
    expect(view.privacy.text).toContain(PLACEHOLDER);
    const application = await ok(captain, "POST", `${base}/applications`, { squad_id: team().squad_id, rule_version_id: world.rule.id,
      accept_rules: true, accept_privacy: true });

    // Teamleitung: Schule ohne Freigabe - noch kein Kennzeichen, die Angabe wartet auf die Liga-Leitung.
    const given = await ok(leader, "PUT", orgUrl, { kind: "school", name: school, school_name_public: false });
    expect(given.guest_badge).toBeNull();
    expect(given.guest_team.pending).toBe(true);
    // Das Kennzeichen setzt nie das Team selbst.
    expect((await api(leader, "PUT", markUrl, { confirmed: true })).status).toBe(403);

    // Liga-Leitung: Eingang mit der Angabe (auch dem Namen ohne Freigabe), annehmen, Kennzeichen bestätigen.
    const inbox = await get(lead, `${seasonAdmin}/applications`);
    const item = inbox.items.find((row) => row.id === application.id);
    expect(item.guest_team).toMatchObject({ kind: "school", name: school, pending: true, confirmed: false });
    await ok(lead, "POST", `${seasonAdmin}/applications/${application.id}/accept`, { tournament_id: world.tid });
    const marked = await ok(lead, "PUT", markUrl, { confirmed: true, season_id: world.season.id });
    expect(marked.guest_badge).toEqual({ label: "Gast", org: null });
    await assign(lead, world.tid, OTHER);
    await ok(lead, "POST", `/api/tournaments/${world.tid}/status`, { status: "live" });

    // Öffentlich: ohne Freigabe nur „Gast“ - nirgends der Schulname.
    const anon = await as(browser, testInfo, "anon", LARGE);
    const index = await registrationIndex(lead, world.tid);
    const guestReg = Object.entries(index).find(([, value]) => value === GUEST)[0];
    const hidden = await api(anon, "GET", `/api/tournaments/${world.tid}/standings`);
    expect(hidden.body.find((row) => row.registration_id === guestReg).guest_badge).toEqual({ label: "Gast", org: null });
    expect(hidden.text).not.toContain(school);
    // Mit Freigabe der Teamleitung: „Gast · Schule“ - am TV weiter nur „Gast“.
    await ok(leader, "PUT", orgUrl, { kind: "school", name: school, school_name_public: true });
    expect((await standings(lead, world.tid))[guestReg].guest_badge).toEqual({ label: "Gast", org: school });
    const tv = await api(lead, "GET", `/api/tournaments/${world.tid}/bracket/display?table=1`);
    expect(tv.body.standings.find((row) => row.registration_id === guestReg).guest_badge).toEqual({ label: "Gast" });
    expect(tv.text).not.toContain(school);

    // Das Gastteam spielt wie jedes Team: Termin jetzt, Check-in, Veto, Meldung beider Seiten.
    const [match] = await staffelMatches(lead, world.tid);
    const [home, away] = match.slots.map((slot) => slot.registration_id);
    const people = { [guestReg]: captain, [home === guestReg ? away : home]: other };
    await ok(lead, "PATCH", `/api/matches/${match.id}`, { scheduled_at: new Date(Date.now() + 5 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin jetzt" });
    await checkIn(captain, match.id);
    await checkIn(other, match.id);
    const block = await playVeto(people, match.id);
    const loser = home === guestReg ? away : home;
    const results = resultsOf(guestReg, loser, "3:1");
    const games = seriesGames(pattern("3:1", guestReg, loser), home, away, { planned: block.planned_games });
    await ok(captain, "POST", `/api/matches/${match.id}/report`, { results, games, lineup: await presentOf(captain, match.id, 3) });
    await ok(other, "POST", `/api/matches/${match.id}/report`, { results, games, lineup: await presentOf(other, match.id, 3) });
    expect((await standings(lead, world.tid))[guestReg]).toMatchObject({ rank: 1, points: 3, guest_badge: { label: "Gast", org: school } });

    // In die Verwaltung kommt das Gastteam nicht - auch nicht ans eigene Kennzeichen.
    for (const url of [`${seasonAdmin}/desk`, `${seasonAdmin}/applications`, `${seasonAdmin}/roster`]) {
      expect((await api(captain, "GET", url)).status).toBe(403);
    }
    expect((await api(captain, "PUT", markUrl, { confirmed: false })).status).toBe(403);

    // Bilder: Tabelle (als Ausschnitt, nicht die ganze Seite) und Matchseite mit Gast bei 390 und 1440 px, ohne seitliches Scrollen.
    for (const person of [captain, anon]) {
      await person.page.goto(`/liga/${world.league.slug}/${world.season.slug}`);
      const badge = person.page.getByTestId(`standing-guest-${guestReg}`).first();
      await expect(badge).toContainText(school);
      await noSideScroll(person.page);
      const table = badge.locator("xpath=ancestor::table[1]");
      await table.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await expect(person.page.getByTestId(`standing-row-${guestReg}`).first()).toBeVisible();
      await shotOf(person.page, table, `g1-gast-tabelle-${person === captain ? 390 : 1440}.png`);
      await person.page.goto(`/matches/${match.id}`);
      await expect(person.page.getByTestId(`match-guest-${guestReg}`)).toContainText(school);
      await noSideScroll(person.page);
    }

    await cleanup();
    cleanup = null;
    expect((await get(anon, `/api/teams/${team().team_id}`)).guest_badge).toBeUndefined();
    await done(admin, lead, leader, captain, other, anon);
  });
});
