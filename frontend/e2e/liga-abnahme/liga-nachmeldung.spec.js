const { test, expect } = require("@playwright/test");
const g1 = require("./g1");

const { ADMIN, LARGE, MINUTE, SMALL, api, as, assign, buildLeague, done, get, noSideScroll, ok, shot, staffelMatches, standings, state, viennaDay } = g1;

// Liga-Gesamtabnahme G.1 (#1632, docs/liga/abnahme.md), Szenario „Nachmeldung“ (#2422, Entscheidungen Nr. 180, 183, 184): Das
// Anmeldefenster läuft über den Season-Start, ein Co-Team kommt in Woche 2 in die laufende Staffel. Die Leitung trägt seine Spiele nach
// Vorschau nur in den offenen Wochen nach, Gespieltes bleibt, die Tabelle sagt „Nachgemeldet ab Woche 3“, und nach der Frist ist die
// Anmeldung zu. Eigene Liga mit drei Co-Teams aus der Testwelt (Index 4 bis 6), dazu Index 7 als Nachrücker. Erfundene Namen.

const DAY = 24 * 60 * MINUTE;
const unique = () => `${g1.RUN}-${Date.now().toString(36)}`;

/** Ein Spiel ohne Zeitstempel - was „unverändert“ heißen muss: Woche, Seiten, Stand, Termin. */
const frozen = (match) => ({ id: match.id, round: match.round, sides: match.slots.map((slot) => slot.registration_id), status: match.status,
  scheduled_at: match.scheduled_at || null });

test.describe("Liga-Gesamtabnahme: Nachmeldung nach dem Season-Start", () => {
  test.skip(!g1.READY, g1.SKIP_REASON);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Nachmeldung: Fenster über den Start, Zuteilung in Woche 2, offene Spiele angelegt, Tabelle mit Hinweis, Frist-Ende greift", async ({ browser }, testInfo) => {
    const admin = await as(browser, testInfo, "admin", LARGE);
    const lead = await as(browser, testInfo, "lead", LARGE);
    // Die Season begann vor acht Tagen: Woche 1 ist vorbei, Woche 2 läuft. Vier Wochen, Platz für vier Teams.
    const world = await buildLeague(admin, lead, { name: `Nachmelde-Liga ${unique()}`, season: { start_date: `${viennaDay(-8)}T00:00:00`, weeks_total: 4, max_staffel_size: 4 } });
    const seasonAdmin = `${ADMIN}/seasons/${world.season.id}`;
    await ok(lead, "PATCH", seasonAdmin, { visibility: "public",
      application_opens_at: new Date(Date.now() - 60 * MINUTE).toISOString(), application_closes_at: new Date(Date.now() + 30 * DAY).toISOString() });
    const readiness = await get(lead, `${seasonAdmin}/readiness`);
    expect(readiness.warnings.map((row) => row.code)).toEqual(expect.arrayContaining(["application_after_start", "application_late_cap"]));
    const late = (await get(lead, seasonAdmin)).late_registration;
    expect(late.days).toBe(14);
    expect(new Date(late.effective_closes_at).getTime()).toBe(new Date(world.season.start_date).getTime() + 14 * DAY);

    for (const index of [4, 5, 6]) await assign(lead, world.tid, index);
    await ok(lead, "POST", `/api/tournaments/${world.tid}/status`, { status: "live" });
    const before = (await staffelMatches(lead, world.tid)).map(frozen);
    expect(before).toHaveLength(3);

    // Der Nachrücker meldet am Handy an: Die Ligaseite nennt das wirksame Ende (Start + 14 Tage), nicht das Ende des Fensters.
    const base = `/api/leagues/${world.league.slug}/${world.season.slug}`;
    const captain = await as(browser, testInfo, "captain-7", SMALL);
    await captain.page.goto(`/liga/${world.league.slug}/${world.season.slug}`);
    const end = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(late.effective_closes_at));
    await expect(captain.page.getByTestId("league-application-after-start")).toContainText(`Anmeldung läuft nach Season-Start weiter (bis ${end}`);
    await noSideScroll(captain.page);
    const application = await ok(captain, "POST", `${base}/applications`, { squad_id: state.teams[7].squad_id, rule_version_id: world.rule.id, accept_rules: true, accept_privacy: true });
    await done(captain);
    const accepted = await ok(lead, "POST", `${seasonAdmin}/applications/${application.id}/accept`, { tournament_id: world.tid });
    const lateId = accepted.assignment.registration_id;
    // Das Zuteilen legt keine Spiele an - keine stille Änderung.
    expect((await staffelMatches(lead, world.tid)).map(frozen)).toEqual(before);

    // Die Leitung sieht die Vorschau und legt die Spiele an (1440 px).
    await lead.page.goto(`/admin/leagues/seasons/${world.season.id}#nachmeldungen`);
    await expect(lead.page.getByTestId(`late-entry-${lateId}`)).toContainText("ab Woche 3");
    await lead.page.getByTestId(`late-entry-open-${lateId}`).click();
    const pairings = lead.page.getByTestId("late-entry-pairings");
    await expect(pairings).toContainText("Woche 3");
    await expect(pairings).toContainText("Woche 4");
    await expect(lead.page.getByTestId("late-entry-missing")).toContainText("kein Spiel mehr möglich.");
    await noSideScroll(lead.page);
    await shot(lead.page, "nachmeldung-vorschau-1440.png");
    await lead.page.getByTestId("late-entry-confirm").click();
    await expect(lead.page.getByTestId(`late-entry-${lateId}`)).toContainText("2 Spiele nachgetragen");

    const after = await staffelMatches(lead, world.tid);
    const created = after.filter((match) => match.slots.some((slot) => slot.registration_id === lateId));
    expect(created.map((match) => Number(match.round)).sort()).toEqual([3, 4]);
    // Gespieltes und Geplantes bleibt: dieselben drei Spiele, Woche, Seiten und Termin unverändert.
    expect(after.filter((match) => !created.includes(match)).map(frozen)).toEqual(before);
    const again = await api(lead, "POST", `${ADMIN}/staffeln/${world.tid}/late-entries/${lateId}`, { fingerprint: "noch einmal" });
    expect(again.status).toBe(409);

    // Tabelle mit Hinweis - öffentlich am Handy.
    const guest = await as(browser, testInfo, "anon", SMALL);
    const table = await standings(guest, world.tid);
    expect(table[lateId]).toMatchObject({ late_entry: true, late_from_week: 3, played: 0 });
    await guest.page.goto(`/liga/${world.league.slug}/${world.season.slug}`);
    await expect(guest.page.getByTestId(`standing-notes-${lateId}`)).toContainText("Nachgemeldet ab Woche 3");
    await noSideScroll(guest.page);
    await guest.page.getByTestId(`standing-notes-${lateId}`).scrollIntoViewIfNeeded();
    await shot(guest.page, "tabelle-nachgemeldet-390.png");
    await done(guest);

    // Frist-Ende: Mit einem Tag Frist ist die Anmeldung zu, obwohl das Fenster noch 30 Tage läuft. Verlängern nur mit Grund.
    await ok(lead, "PATCH", seasonAdmin, { late_registration_days: 1 });
    const outside = await as(browser, testInfo, "captain-8", LARGE);
    expect((await get(outside, base)).application.state).toBe("closed");
    const refused = await api(outside, "POST", `${base}/applications`, { squad_id: state.teams[8].squad_id, rule_version_id: world.rule.id, accept_rules: true, accept_privacy: true });
    expect(refused.status).toBe(409);
    expect(refused.text).toContain("Die Anmeldung ist vorbei");
    const noReason = await api(lead, "POST", `${seasonAdmin}/application-extension`, { until: new Date(Date.now() + 2 * DAY).toISOString(), reason: "" });
    expect(noReason.status).toBe(422);
    await ok(lead, "POST", `${seasonAdmin}/application-extension`, { until: new Date(Date.now() + 2 * DAY).toISOString(), reason: "Nachrücker aus der Warteliste" });
    expect((await get(outside, base)).application.state).toBe("open");
    await done(outside, admin, lead);
  });
});
