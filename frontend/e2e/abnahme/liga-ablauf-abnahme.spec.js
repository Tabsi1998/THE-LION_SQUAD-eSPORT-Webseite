const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Der Liga-Ablauf schreibend gegen den echten Server (#2200) - ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py: eigene „Liga-Probelauf“ mit Staffel A im Entwurf, fünf Co-Teams zugeteilt. Die Turnierleitung
// teilt das sechste zu und startet; danach bei 390 und 1440 px je ein eigenes Spiel: Terminvorschlag und Annahme durch zwei
// Captains, Melden mit Maps und Aufstellung, Bestätigen, Tabelle und Ligaseite; dann Einspruch und Korrektur der Leitung. Die
// Zeit-Jobs (Standardtermin, Erinnerung, 48-Stunden-Automatik) stößt die Spec gezielt für diese Staffel an, der Stand lässt sie
// sonst aus. Keine Konsolenfehler, keine Antwort 4xx/5xx, kein seitliches Scrollen.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const ROOT = path.join(__dirname, "..", "..", "..");
const ablauf = state?.ablauf;
const tid = ablauf?.tournament_id;
const leagueUrl = () => `/liga/${ablauf.league.slug}/${ablauf.season.slug}`;

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Einen Zeit-Job einmal im Backend-Container, nur für diese Staffel. Antwort: die Zahlen des Jobs. */
function runJob(job, hours = 0) {
  const output = execFileSync(process.env.PYTHON || "python3", [
    path.join(ROOT, "scripts", "seed_abnahme_liga.py"), "--job", job, "--tournament", tid, "--hours", String(hours),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(output.trim().split("\n").pop());
}

/** Ein eigener Browser-Kontext je Person: Turnierleitung und zwei Captains sind gleichzeitig angemeldet. */
async function as(browser, testInfo, role, viewport) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, locale: "de-AT", timezoneId: "Europe/Vienna" });
  const page = await context.newPage();
  await signIn(page, role);
  return { page, problems: watch(page), close: () => context.close() };
}

/** Das Spiel einer Runde mit den zwei Rollen der Captains, die laut Stand-Datei dazugehören. */
async function matchOfRound(page, round, skip = []) {
  const response = await page.request.get(`/api/tournaments/${tid}/matches-v2`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  const rows = (Array.isArray(body) ? body : body.matches || []).filter((row) => !row.is_preview);
  const match = rows.find((row) => Number(row.round) === round && !skip.includes(row.id) && row.status !== "completed");
  expect(match, `Spiel in Runde ${round}`).toBeTruthy();
  const [home, away] = match.slots.map((slot) => slot.registration_id);
  const registrations = await (await page.request.get(`/api/tournaments/${tid}/registrations`)).json();
  const captainOf = (id) => {
    const squadId = registrations.find((row) => row.id === id).squad_id;
    return `captain-${state.teams.findIndex((row) => row.squad_id === squadId)}`;
  };
  return { id: match.id, home, away, homeRole: captainOf(home), awayRole: captainOf(away) };
}

/** Datum und Uhrzeit für das Feld „Vorschlag“ - Wiener Wanduhr, die Spec läuft in Wiener Zeit. */
function localInput(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function proposeAndAccept(home, away, matchId, when) {
  await home.page.goto(`/matches/${matchId}`);
  await home.page.getByTestId("match-proposal-at").fill(localInput(when));
  await home.page.getByRole("button", { name: "Vorschlagen" }).click();
  await expect(home.page.getByTestId("match-scheduling")).toContainText("wartet auf die Gegenseite");

  await away.page.goto(`/matches/${matchId}`);
  const accept = away.page.locator('[data-testid^="match-proposal-accept-"]');
  await expect(accept).toHaveCount(1);
  await accept.click();
  await expect(away.page.locator('[data-testid^="match-proposal-status-"]').first()).toContainText("angenommen");
}

/** Melden im Web: je Map die erste Map aus dem Pool, der Sieger, die eigene Aufstellung (die nächste Map übernimmt sie). */
async function report(page, matchId, winner, maps) {
  await page.goto(`/matches/${matchId}`);
  await expect(page.getByTestId("match-report-form")).toBeVisible();
  for (const [index, mapId] of maps.entries()) {
    const position = index + 1;
    await page.getByTestId(`league-game-${position}-map-${mapId}`).click();
    await page.getByTestId(`league-game-${position}-winner-${winner}`).click();
    if (position === 1) {
      const chips = page.getByTestId("league-game-1-lineup").getByRole("button");
      for (let chip = 0; chip < 4; chip += 1) await chips.nth(chip).click();
    }
  }
  await expect(page.getByTestId("match-report-sentence")).toContainText("2:0");
  await noSideScroll(page);
  await page.getByTestId("match-report-submit").click();
  await expect(page.getByTestId("match-report-state")).toHaveAttribute("data-status", "waiting");
}

const MAPS_OF_SERIES = () => [ablauf.pool.stellung[0], ablauf.pool.suchen[1]];

test.describe("Abnahme: Liga-Ablauf gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Turnierleitung: Co-Team zuteilen, Liga starten, der Plan steht", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(`/admin/tournaments/${tid}`);
    await expect(lead.page.getByRole("heading", { level: 1 })).toContainText("Staffel A");
    await lead.page.getByTestId("admin-tr-tab-participants").click();

    // Zuteilen - oder schon zugeteilt, wenn ein abgebrochener Lauf bis hierher kam.
    const spare = state.teams[ablauf.assigned];
    const shown = lead.page.getByText(`${spare.name} · ${spare.squad_name}`).filter({ visible: true }).first();
    if (!await shown.isVisible()) {
      await lead.page.getByTestId("squad-assign-open").click();
      await lead.page.getByTestId(`squad-assign-team-${spare.team_id}`).click();
      await lead.page.getByTestId(`squad-assign-squad-${spare.squad_id}`).click();
      await lead.page.getByTestId("squad-assign-confirm").click();
      await expect(shown).toBeVisible();
    }
    await noSideScroll(lead.page);
    await shot(lead.page, "ablauf-zugeteilt-1440.png");

    await expect(lead.page.getByTestId("admin-tr-primary-action")).toContainText("Liga starten");
    await lead.page.getByTestId("admin-tr-primary-action").click();
    await expect(lead.page.getByTestId("admin-tr-status-select")).toHaveValue("live");

    // Sechs Teams, nur Hinrunde: 15 Spiele in fünf Runden, nichts doppelt.
    const rows = await (await lead.page.request.get(`/api/tournaments/${tid}/matches-v2`)).json();
    const matches = (Array.isArray(rows) ? rows : rows.matches).filter((row) => !row.is_preview);
    expect(matches).toHaveLength(15);
    expect(new Set(matches.map((row) => row.round)).size).toBe(5);

    // Standardtermin (Job matchday_schedule): Sonntag 20:00 Wiener Zeit - sichtbar auf der Ligaseite.
    const written = runJob("matchday_schedule");
    expect(written.written).toBe(15);
    await lead.page.goto(leagueUrl());
    const staffel = lead.page.getByTestId("league-staffel-A");
    await expect(staffel.locator('[data-testid^="league-team-"]')).toHaveCount(6);
    await expect(staffel.getByTestId("league-week-1")).toContainText("So");
    await expect(staffel.getByTestId("league-week-1")).toContainText("20:00");
    await noSideScroll(lead.page);
    await shot(lead.page, "ablauf-gestartet-1440.png");

    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  for (const [width, height] of WIDTHS) {
    const viewport = { width, height };
    const round = width === 390 ? 1 : 2;

    test(`Spiel (${width} px): Termin, Melden, Bestätigen, Tabelle und Ligaseite`, async ({ browser }, testInfo) => {
      const lead = await as(browser, testInfo, "lead", viewport);
      const match = await matchOfRound(lead.page, round);
      const home = await as(browser, testInfo, match.homeRole, viewport);
      const away = await as(browser, testInfo, match.awayRole, viewport);

      // Terminvorschlag und Annahme; in elf Minuten, damit gleich die Erinnerung dran ist (Job match_reminders).
      await proposeAndAccept(home, away, match.id, new Date(Date.now() + 11 * 60_000));
      await expect(away.page.getByTestId("match-schedule-headline")).toBeVisible();
      await noSideScroll(away.page);
      await shot(away.page, `ablauf-termin-${width}.png`);
      const reminded = runJob("match_reminders");
      expect(reminded.notifications).toBeGreaterThan(0);
      const inbox = await (await away.page.request.get("/api/admin/notifications")).json();
      expect(JSON.stringify(inbox)).toContain("Match startet in 10 Minuten");

      // Melden mit Maps und Aufstellung, die Gegenseite bestätigt mit ihrer Aufstellung.
      await report(home.page, match.id, match.home, MAPS_OF_SERIES());
      await shot(home.page, `ablauf-gemeldet-${width}.png`);
      await away.page.goto(`/matches/${match.id}`);
      await expect(away.page.getByTestId("match-report-state")).toHaveAttribute("data-status", "confirm");
      const firstLineup = away.page.getByTestId("league-confirm-lineup-1").getByRole("button");
      for (let chip = 0; chip < 4; chip += 1) await firstLineup.nth(chip).click();
      await noSideScroll(away.page);
      await away.page.getByTestId("match-report-confirm").click();
      await expect(away.page.getByTestId("match-outcome")).toBeVisible();
      await expect(away.page.getByTestId("league-games-2")).toBeVisible();
      await noSideScroll(away.page);
      await shot(away.page, `ablauf-bestaetigt-${width}.png`);

      // Tabelle und Ligaseite: drei Punkte für die Heimseite, das Spiel steht als gespielt da.
      const standings = await (await lead.page.request.get(`/api/tournaments/${tid}/standings`)).json();
      expect(standings.find((row) => row.registration_id === match.home).won).toBeGreaterThanOrEqual(1);
      const guest = await as(browser, testInfo, "anon", viewport);
      await guest.page.goto(leagueUrl());
      const staffel = guest.page.getByTestId("league-staffel-A");
      await expect(staffel).toBeVisible();
      const week = staffel.getByTestId(`league-week-${round}`);
      if (await week.getByRole("button").first().getAttribute("aria-expanded") !== "true") await week.getByRole("button").first().click();
      await expect(staffel.getByTestId(`league-match-${match.id}`)).toHaveAttribute("data-done", "true");
      await noSideScroll(guest.page);
      await shot(guest.page, `ablauf-ligaseite-${width}.png`);

      for (const person of [lead, home, away, guest]) {
        expect(person.problems).toEqual([]);
        await person.close();
      }
    });

    test(`Spiel (${width} px): Einspruch und Korrektur der Leitung`, async ({ browser }, testInfo) => {
      const lead = await as(browser, testInfo, "lead", viewport);
      const match = await matchOfRound(lead.page, round);
      const home = await as(browser, testInfo, match.homeRole, viewport);
      const away = await as(browser, testInfo, match.awayRole, viewport);

      // Die Heimseite meldet 2:0, die Gegenseite sagt „Stimmt nicht“.
      await report(home.page, match.id, match.home, MAPS_OF_SERIES());
      await away.page.goto(`/matches/${match.id}`);
      await away.page.getByTestId("match-report-wrong").click();
      await expect(away.page.getByTestId("match-dispute-reason-wrong_result")).toHaveAttribute("aria-pressed", "true");
      await away.page.getByTestId("match-dispute-input").fill("Wir haben beide Maps gewonnen, laut Aufzeichnung 2:0 für uns.");
      await noSideScroll(away.page);
      await away.page.getByTestId("match-dispute-btn").click();
      await expect(away.page.getByTestId("match-in-dispute")).toBeVisible();
      await shot(away.page, `ablauf-einspruch-${width}.png`);

      const rowsBefore = await (await lead.page.request.get(`/api/tournaments/${tid}/standings`)).json();
      const before = (id) => rowsBefore.find((row) => row.registration_id === id);

      // Die Leitung entscheidet: 2:0 für die Gäste.
      await lead.page.goto(`/matches/${match.id}`);
      await expect(lead.page.getByTestId("match-in-dispute")).toBeVisible();
      await lead.page.getByTestId("match-staff-result-open").click();
      const form = lead.page.getByTestId("result-window");
      await expect(form).toHaveAttribute("data-kind", "maps");
      for (const [index, mapId] of MAPS_OF_SERIES().entries()) {
        const position = index + 1;
        await form.getByTestId(`league-game-${position}-map-${mapId}`).click();
        await form.getByTestId(`league-game-${position}-winner-${match.away}`).click();
      }
      await expect(form.getByTestId("result-sentence")).toContainText("2:0");
      await noSideScroll(lead.page);
      await shot(lead.page, `ablauf-entscheidung-${width}.png`);
      await form.getByTestId("result-save").click();

      // Das Ergebnis geht nach zehn Sekunden „Rückgängig“ raus (Job result_holds läuft im Stand mit).
      const settled = (homeScore, awayScore) => expect(async () => {
        const row = (await (await lead.page.request.get(`/api/matches/${match.id}/page`)).json()).match;
        expect(row.status).toBe("completed");
        const score = (id) => row.results.find((result) => result.registration_id === id).score;
        expect([score(match.home), score(match.away)]).toEqual([homeScore, awayScore]);
      }).toPass({ timeout: 60_000 });
      await settled(0, 2);
      await away.page.goto(`/matches/${match.id}`);
      await expect(away.page.getByTestId("match-outcome")).toBeVisible();
      await expect(away.page.getByTestId("match-in-dispute")).toHaveCount(0);
      await noSideScroll(away.page);

      // Danach korrigiert sie auf 2:1 - das geht nur mit Grund.
      await lead.page.goto(`/matches/${match.id}`);
      await expect(lead.page.getByTestId("match-staff-result-open")).toContainText("Ergebnis korrigieren");
      await lead.page.getByTestId("match-staff-result-open").click();
      await form.getByTestId(`league-game-1-winner-${match.home}`).click();
      await form.getByTestId(`league-game-3-map-${ablauf.pool.kontrolle[0]}`).click();
      await form.getByTestId(`league-game-3-winner-${match.away}`).click();
      await expect(form.getByTestId("result-sentence")).toContainText("2:1");
      await form.getByTestId("result-save").click();
      await expect(form.getByTestId("result-error")).toContainText("Grund");
      await form.getByTestId("result-reason").fill("Laut Aufzeichnung ging Map 1 an die Heimseite");
      await noSideScroll(lead.page);
      await shot(lead.page, `ablauf-korrektur-${width}.png`);
      await form.getByTestId("result-save").click();
      await settled(1, 2);

      // Die Tabelle zählt das Spiel einmal, mit dem korrigierten Stand.
      const rowsAfter = await (await lead.page.request.get(`/api/tournaments/${tid}/standings`)).json();
      const after = (id) => rowsAfter.find((row) => row.registration_id === id);
      expect(after(match.away).points).toBe(before(match.away).points + 3);
      expect(after(match.home).points).toBe(before(match.home).points);
      expect(after(match.away).played).toBe(before(match.away).played + 1);
      expect(after(match.away).score_for).toBe(before(match.away).score_for + 2);
      expect(after(match.away).score_against).toBe(before(match.away).score_against + 1);

      for (const person of [lead, home, away]) {
        expect(person.problems).toEqual([]);
        await person.close();
      }
    });
  }

  test("Ohne Antwort: Die Meldung gilt nach 48 Stunden (Job match_deadlines)", async ({ browser }, testInfo) => {
    const viewport = { width: 1440, height: 900 };
    const lead = await as(browser, testInfo, "lead", viewport);
    const match = await matchOfRound(lead.page, 3);
    const home = await as(browser, testInfo, match.homeRole, viewport);
    await report(home.page, match.id, match.home, MAPS_OF_SERIES());

    expect(runJob("match_deadlines", 47).confirmed).toBe(0);
    expect(runJob("match_deadlines", 49).confirmed).toBe(1);

    await home.page.goto(`/matches/${match.id}`);
    await expect(home.page.getByTestId("match-outcome")).toBeVisible();
    const row = (await (await lead.page.request.get(`/api/matches/${match.id}/page`)).json()).match;
    expect(row.status).toBe("completed");
    for (const person of [lead, home]) {
      expect(person.problems).toEqual([]);
      await person.close();
    }
  });
});
