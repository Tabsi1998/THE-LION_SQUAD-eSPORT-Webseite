const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Liga-Veto (#1618, docs/LIGA.md D.3) schreibend gegen den echten Server - ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (Staffel „Liga-Probelauf“ im Entwurf, fünf Co-Teams). Die Leitung speichert Check-in und Veto der Season
// (Vorschlag aus Modusfolge und Pools, bei 1440 px), startet die Staffel und legt den Termin auf jetzt. Dann checken zwei Captains in zwei
// Browser-Kontexten ein (390 px), das Veto beginnt von selbst, beide ziehen abwechselnd bis zum Ende - ein Zug der falschen Seite und
// eine gesperrte Map lehnt der Server ab -, die Spielreihenfolge steht, der Start-Knopf kommt. Keine Konsolenfehler, keine Antwort
// 4xx/5xx im Browser (außer den erwarteten Absagen über die API), kein seitliches Scrollen.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const ablauf = state?.ablauf;
const tid = ablauf?.tournament_id;
const MINUTE = 60 * 1000;

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

/** Schreibende Aufrufe außerhalb des Browsers (mit CSRF-Kopf) - die Wache zählt sie nicht, so lassen sich Absagen prüfen. */
async function api(page, method, url, data) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token")?.value || "";
  return page.request.fetch(url, { method, headers: { "X-CSRF-Token": decodeURIComponent(csrf) }, data });
}

async function consent(person, squadId) {
  const rules = await (await person.page.request.get(`/api/league-rules/seasons/${ablauf.league.slug}/${ablauf.season.slug}`)).json();
  if (!rules.consent?.open) return;
  const given = await api(person.page, "POST", "/api/league-rules/consents", { version_id: rules.consent.version_id, season_id: ablauf.season.id, squad_id: squadId });
  expect(given.status(), await given.text()).toBe(200);
}

let shared = null;

test.describe("Abnahme: Liga-Veto gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Leitung bei 1440 px: Check-in und Veto der Season (Vorschlag), Staffel starten, Termin jetzt", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(`/admin/leagues/seasons/${ablauf.season.id}#checkin`);
    await expect(lead.page.getByTestId("season-checkin-rules")).toBeVisible();
    await lead.page.getByTestId("checkin-rules-save").click();
    await expect(lead.page.getByTestId("checkin-rules-inactive")).toHaveCount(0);

    // Der Kasten „Veto“ steht im Reiter Spielbetrieb unter „Serie“ (#2267), Sprungmarke #veto.
    await lead.page.goto(`/admin/leagues/seasons/${ablauf.season.id}#veto`);
    await expect(lead.page.getByTestId("season-tab-spielbetrieb")).toHaveAttribute("aria-selected", "true");
    const panel = lead.page.getByTestId("season-veto-rules");
    await expect(panel).toBeVisible();
    await lead.page.getByTestId("veto-rules-propose").click();
    await expect(lead.page.getByTestId("veto-rules-ok")).toBeVisible();
    const steps = await lead.page.getByTestId("veto-rules-steps").locator("li").count();
    expect(steps).toBeGreaterThanOrEqual(3);
    await noSideScroll(lead.page);
    await panel.scrollIntoViewIfNeeded();
    await shot(lead.page, "veto-verwaltung-1440.png");
    await lead.page.getByTestId("veto-rules-save").click();
    await expect(lead.page.getByTestId("veto-rules-error")).toHaveCount(0);
    const rules = await (await lead.page.request.get(`/api/admin/leagues/seasons/${ablauf.season.id}/veto-rules`)).json();
    expect(rules.active).toBe(true);
    expect(rules.problems).toEqual([]);

    await lead.page.goto(`/admin/tournaments/${tid}`);
    await expect(lead.page.getByTestId("admin-tr-primary-action")).toContainText("Liga starten");
    await lead.page.getByTestId("admin-tr-primary-action").click();
    const anyway = lead.page.getByRole("button", { name: "Trotzdem live" });
    if (await anyway.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) await anyway.click();
    await expect(lead.page.getByTestId("admin-tr-status-select")).toHaveValue("live");

    const rows = await (await lead.page.request.get(`/api/tournaments/${tid}/matches-v2`)).json();
    const match = (Array.isArray(rows) ? rows : rows.matches)
      .filter((row) => !row.is_preview && Number(row.round) === 1 && row.slots.every((slot) => slot.registration_id))[0];
    expect(match, "ein Spiel an Spieltag 1").toBeTruthy();
    const registrations = await (await lead.page.request.get(`/api/tournaments/${tid}/registrations`)).json();
    const squadOf = (id) => registrations.find((reg) => reg.id === id).squad_id;
    const captainOf = (id) => `captain-${state.teams.findIndex((row) => row.squad_id === squadOf(id))}`;
    const moved = await api(lead.page, "PATCH", `/api/matches/${match.id}`, { scheduled_at: new Date(Date.now() + 5 * MINUTE).toISOString(), schedule_reason: "Abnahme: Termin jetzt" });
    expect(moved.status(), await moved.text()).toBe(200);
    const [home, away] = match.slots.map((slot) => slot.registration_id);
    shared = { id: match.id, home, away, homeRole: captainOf(home), awayRole: captainOf(away), homeSquad: squadOf(home), awaySquad: squadOf(away), steps: rules.veto_rules.steps };
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  test("Captains bei 390 px: einchecken, das Veto läuft, abwechselnd ziehen bis die Spielreihenfolge steht", async ({ browser }, testInfo) => {
    const viewport = { width: 390, height: 844 };
    const play = shared;
    const home = await as(browser, testInfo, play.homeRole, viewport);
    const away = await as(browser, testInfo, play.awayRole, viewport);
    const people = { [play.home]: home, [play.away]: away };
    await consent(home, play.homeSquad);
    await consent(away, play.awaySquad);

    for (const person of [home, away]) {
      await person.page.goto(`/matches/${play.id}`);
      await expect(person.page.getByTestId("checkin-headline")).toHaveText("Check-in offen");
      const roster = (await (await person.page.request.get(`/api/matches/${play.id}/page`)).json()).checkin.roster.filter((row) => !row.blocked);
      for (const row of roster.slice(0, 3)) await person.page.getByTestId(`checkin-roster-${row.id}`).check();
      await person.page.getByTestId("checkin-submit").click();
    }
    await expect(away.page.getByTestId("checkin-headline")).toHaveText("Veto läuft");
    await expect(away.page.getByTestId("veto-panel")).toHaveAttribute("data-status", "running");
    await home.page.goto(`/matches/${play.id}`);
    await expect(home.page.getByTestId("veto-panel")).toHaveAttribute("data-status", "running");
    await noSideScroll(home.page);
    await shot(home.page, "veto-laeuft-390.png");

    // Ein Zug der falschen Seite und eine gesperrte Map lehnt der Server ab (über die API, damit die Wache sie nicht zählt).
    let block = (await (await home.page.request.get(`/api/matches/${play.id}/page`)).json()).checkin.veto;
    const other = block.current.registration_id === play.home ? away : home;
    const wrong = await api(other.page, "POST", `/api/matches/${play.id}/veto/pick`, { map_id: block.options[0].map_id, version: block.version });
    expect(wrong.status()).toBe(409);
    expect((await wrong.json()).detail).toContain("am Zug");

    let banned = null;
    for (let guard = 0; guard < 40 && block.status === "running"; guard += 1) {
      const actor = people[block.current.registration_id];
      await actor.page.goto(`/matches/${play.id}`);
      await expect(actor.page.getByTestId("veto-panel")).toHaveAttribute("data-own-turn", "true");
      if (banned) {
        const refused = await api(actor.page, "POST", `/api/matches/${play.id}/veto/pick`, { map_id: banned, version: block.version });
        if (block.current.mode === banned.mode) expect(refused.status()).toBe(422);
        banned = null;
      }
      const option = block.options.find((row) => row.allowed);
      expect(option, `Schritt ${block.current.number}: eine wählbare Map`).toBeTruthy();
      if (guard === 0) {
        await noSideScroll(actor.page);
        await shot(actor.page, "veto-am-zug-390.png");
      }
      await actor.page.getByTestId(`veto-option-${option.map_id}`).click();
      await expect.poll(async () => (await (await actor.page.request.get(`/api/matches/${play.id}/page`)).json()).checkin.veto.version).toBeGreaterThan(block.version);
      if (block.current.kind === "ban") banned = { ...option, mode: block.current.mode }.map_id;
      block = (await (await actor.page.request.get(`/api/matches/${play.id}/page`)).json()).checkin.veto;
    }
    expect(block.status).toBe("done");
    expect(block.planned_games.map((row) => row.position)).toEqual(block.planned_games.map((_, index) => index + 1));

    await home.page.goto(`/matches/${play.id}`);
    await expect(home.page.getByTestId("checkin-headline")).toHaveText("Spielbereit");
    await expect(home.page.getByTestId("veto-headline")).toHaveText("Spielreihenfolge steht");
    await expect(home.page.getByTestId("veto-planned").locator("li")).toHaveCount(block.planned_games.length);
    await expect(home.page.getByTestId("checkin-start-button")).toBeVisible();
    await noSideScroll(home.page);
    await shot(home.page, "veto-fertig-390.png");
    const stored = await (await home.page.request.get(`/api/matches/${play.id}/page`)).json();
    expect(stored.match.planned_games.length).toBe(block.planned_games.length);
    expect(stored.league.planned_games.length).toBe(block.planned_games.length);

    for (const person of [home, away]) {
      expect(person.problems).toEqual([]);
      await person.close();
    }
  });

  test("Start bei 1440 px: das Meldeformular zeigt die Maps laut Veto fest", async ({ browser }, testInfo) => {
    const play = shared;
    const home = await as(browser, testInfo, play.homeRole, { width: 1440, height: 900 });
    await home.page.goto(`/matches/${play.id}`);
    await home.page.getByTestId("checkin-start-button").click();
    await expect(home.page.getByTestId("checkin-headline")).toHaveText("Spiel läuft");
    await expect(home.page.getByTestId("match-report-form")).toBeVisible();
    await expect(home.page.getByTestId("league-game-1-planned")).toContainText("laut Veto");
    await noSideScroll(home.page);
    await shot(home.page, "veto-meldeformular-1440.png");
    expect(home.problems).toEqual([]);
    await home.close();
  });
});
