const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Tabelle der Liga-Staffel (E.1, #1625) schreibend gegen den echten Server - ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py: „Liga-Probelauf“ mit Staffel A im Entwurf und fünf Co-Teams; die neue Season trägt die
// Vorgaben neuer Liga-Seasons (direkter Vergleich, Entscheid der Leitung, alle Spiele für die Gegner). Die Leitung startet die
// Staffel und trägt Spieltag 1 so ein, dass zwei Sieger in allem gleich stehen: geteilter Platz, dann Entscheid der Leitung mit
// Grund in der Season-Verwaltung. Danach Austritt eines Teams (alle Spiele für die Gegner, Tabellenende) und „beide nicht
// erschienen“ mit „Neu ansetzen“ auf der Matchseite. Ligaseite als Gast bei 390 und 1440 px, ohne seitliches Scrollen, ohne
// Konsolenfehler. Läuft nicht zusammen mit liga-ablauf-abnahme auf derselben Staffel (die nächtliche Abnahme seedet vor jeder
// Spec neu).

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const ablauf = state?.ablauf;
const tid = ablauf?.tournament_id;
const leagueUrl = () => `/liga/${ablauf.league.slug}/${ablauf.season.slug}`;
const REASON = "Losentscheid vor beiden Captains (Abnahme)";

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function as(browser, testInfo, role, viewport) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, locale: "de-AT", timezoneId: "Europe/Vienna" });
  const page = await context.newPage();
  await signIn(page, role);
  return { page, problems: watch(page), close: () => context.close() };
}

async function matches(page) {
  const response = await page.request.get(`/api/tournaments/${tid}/matches-v2`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  return (Array.isArray(body) ? body : body.matches || []).filter((row) => !row.is_preview);
}

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function post(page, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

const sides = (match) => (match.slots || []).map((slot) => slot.registration_id).filter(Boolean);

async function standings(page) {
  const response = await page.request.get(`/api/tournaments/${tid}/standings`);
  expect(response.status()).toBe(200);
  return response.json();
}

/** Ergebnis als Leitung: 2:1 für die erste Seite. Der Server hält es zehn Sekunden für „Rückgängig“, dann gilt es. */
async function result(page, match) {
  const [home, away] = sides(match);
  const response = await post(page, `/api/matches/${match.id}/result`, { results: [
    { registration_id: home, rank: 1, score: 2 }, { registration_id: away, rank: 2, score: 1 }] });
  expect(response.status(), await response.text()).toBe(200);
  return { home, away };
}

async function waitDone(page, ids) {
  await expect.poll(async () => (await matches(page)).filter((row) => ids.includes(row.id) && row.status === "completed").length,
    { timeout: 60_000, intervals: [2_000] }).toBe(ids.length);
}

const shared = {};

test.describe("Abnahme: Tabelle der Liga-Staffel gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Gleichstand: geteilter Platz, Entscheid der Leitung mit Grund", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    const started = await post(lead.page, `/api/tournaments/${tid}/status`, { status: "live" });
    expect(started.status(), await started.text()).toBe(200);
    const first = (await matches(lead.page)).filter((row) => Number(row.round) === 1 && sides(row).length === 2);
    expect(first.length).toBe(2);
    const played = [];
    for (const match of first) played.push(await result(lead.page, match));
    await waitDone(lead.page, first.map((row) => row.id));
    const winners = played.map((row) => row.home);
    shared.winners = winners;
    shared.losers = played.map((row) => row.away);

    // Zwei Sieger 2:1 ohne Spiel gegeneinander: nach allen Kriterien gleich - geteilter Platz 1.
    const rows = await standings(lead.page);
    expect(rows.filter((row) => winners.includes(row.registration_id)).map((row) => row.rank)).toEqual([1, 1]);

    await lead.page.goto(`/admin/leagues/seasons/${ablauf.season.id}#tabelle`);
    const panel = lead.page.getByTestId("season-table-panel");
    const tie = panel.getByTestId(`season-tie-${tid}-1`);
    await expect(tie).toBeVisible();
    await tie.getByRole("button", { name: "Reihenfolge festlegen" }).click();
    const sheet = lead.page.getByTestId("table-decision-sheet");
    await sheet.getByTestId("table-decision-down-0").click();
    await sheet.getByTestId("table-decision-reason").fill(REASON);
    await sheet.getByTestId("table-decision-save").click();
    await expect(panel.getByText("Gilt", { exact: true })).toBeVisible();
    const decided = await standings(lead.page);
    const top = decided.slice(0, 2);
    expect(top.map((row) => row.rank)).toEqual([1, 2]);
    expect(top.every((row) => row.tiebreak === "lead_decision" && row.lead_decision?.reason === REASON)).toBe(true);
    shared.first = top[0].registration_id;
    expect(lead.problems).toEqual([]);
    await lead.close();

    for (const [width, height] of WIDTHS) {
      const guest = await as(browser, testInfo, "anon", { width, height });
      await guest.page.goto(leagueUrl());
      const staffel = guest.page.getByTestId("league-staffel-A");
      await expect(staffel.getByTestId(`standing-notes-${shared.first}`)).toContainText(`Platz durch Entscheid der Leitung: ${REASON}`);
      await expect(staffel.getByTestId("league-tiebreak-order-A")).toContainText("Direkter Vergleich");
      await noSideScroll(guest.page);
      await shot(guest.page, `liga-tabelle-entscheid-${width}.png`);
      expect(guest.problems).toEqual([]);
      await guest.close();
    }
  });

  test("Austritt: alle Spiele zählen für die Gegner, Team am Tabellenende, echtes Ergebnis bleibt", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    const leaver = shared.first;
    const beaten = shared.losers[shared.winners.indexOf(leaver)];
    const proposed = await post(lead.page, `/api/tournaments/${tid}/registrations/${leaver}/removal`, { kind: "withdrawn", reason: "Team aufgelöst" });
    expect(proposed.status(), await proposed.text()).toBe(200);
    const plan = (await proposed.json()).plan;
    expect(plan.mode).toBe("opponents");
    const confirmed = await post(lead.page, `/api/tournaments/${tid}/registrations/${leaver}/removal`, { kind: "withdrawn", plan_id: plan.id });
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    const rows = await standings(lead.page);
    const last = rows[rows.length - 1];
    expect(last.registration_id).toBe(leaver);
    expect(last.exit.kind).toBe("withdrawn");
    const opponent = rows.find((row) => row.registration_id === beaten);
    expect(opponent.forfeit_won).toBe(1);
    expect(opponent.points).toBe(3);
    expect(lead.problems).toEqual([]);
    await lead.close();

    for (const [width, height] of WIDTHS) {
      const guest = await as(browser, testInfo, "anon", { width, height });
      await guest.page.goto(leagueUrl());
      const staffel = guest.page.getByTestId("league-staffel-A");
      await expect(staffel.getByTestId(`standing-notes-${leaver}`)).toContainText("Ausgetreten");
      await expect(staffel.getByTestId(`standing-notes-${beaten}`)).toContainText("kampflos gewonnen");
      // Das echte Ergebnis bleibt im Spielplan - mit dem Namen des ausgeschiedenen Teams.
      const page = await (await guest.page.request.get(`/api/leagues/${ablauf.league.slug}/${ablauf.season.slug}/staffeln/${tid}`)).json();
      const real = page.weeks.flatMap((week) => week.matches || []).find((row) => row.winner_registration_id === leaver);
      expect(real, "Spiel des ausgeschiedenen Teams im Spielplan").toBeTruthy();
      expect([real.home, real.away].find((side) => side.registration_id === leaver).name).not.toBe("Team");
      await noSideScroll(guest.page);
      await shot(guest.page, `liga-tabelle-austritt-${width}.png`);
      expect(guest.problems).toEqual([]);
      await guest.close();
    }
  });

  test("Beide nicht erschienen: beide verlieren, die Leitung setzt neu an", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    const open = (await matches(lead.page)).find((row) => sides(row).length === 2 && !sides(row).includes(shared.first)
      && !["completed", "forfeit", "cancelled"].includes(row.status));
    expect(open, "offenes Spiel ohne ausgeschiedenes Team").toBeTruthy();
    await lead.page.goto(`/matches/${open.id}`);
    await lead.page.getByTestId("match-double-no-show").click();
    await lead.page.getByTestId("match-double-no-show-text").fill("Beide Teams nicht in der Lobby (Abnahme)");
    await lead.page.getByTestId("match-double-no-show-save").click();
    await expect(lead.page.getByTestId("match-double-no-show-undo")).toBeVisible();
    const rows = await standings(lead.page);
    for (const side of sides(open)) expect(rows.find((row) => row.registration_id === side).forfeit_lost).toBeGreaterThanOrEqual(1);
    await noSideScroll(lead.page);
    await lead.page.getByTestId("match-double-no-show-undo").click();
    await lead.page.getByTestId("match-double-no-show-text").fill("Neuer Termin vereinbart (Abnahme)");
    await lead.page.getByTestId("match-double-no-show-save").click();
    await expect(lead.page.getByTestId("match-double-no-show")).toBeVisible();
    const again = (await matches(lead.page)).find((row) => row.id === open.id);
    expect(again.status).not.toBe("forfeit");
    expect(lead.problems).toEqual([]);
    await lead.close();
  });
});
