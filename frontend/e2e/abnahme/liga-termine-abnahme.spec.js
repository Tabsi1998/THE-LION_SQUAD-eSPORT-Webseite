const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Liga-Termine (#2194, docs/LIGA.md D.1) schreibend gegen den echten Server - ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (Staffel „Liga-Probelauf“ im Entwurf, fünf Co-Teams). Die Leitung speichert die Terminregeln der
// Season und startet die Staffel; dann einigen sich zwei Captains, verschieben zweimal (390 und 1440 px), die dritte Verschiebung
// lehnt der Server ab, und die Leitung legt den Termin mit Grund fest. Keine Konsolenfehler, keine Antwort 4xx/5xx im Browser,
// kein seitliches Scrollen.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const ablauf = state?.ablauf;
const tid = ablauf?.tournament_id;
const DAY = 24 * 60 * 60 * 1000;

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

/** Datum und Uhrzeit für ein Feld - Wiener Wanduhr. */
function localInput(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** 20:00 Wiener Zeit, so viele Tage nach dem Beginn der Spielwoche (Wiener Mitternacht laut Server, im November ohne Umstellung). */
function dayAt(weekStart, days) {
  return new Date(new Date(weekStart).getTime() + days * DAY + 20 * 60 * 60 * 1000);
}

let shared = null;

test.describe("Abnahme: Liga-Termine gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Leitung: Terminregeln der Season speichern und die Staffel starten", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(`/admin/leagues/seasons/${ablauf.season.id}`);
    const panel = lead.page.getByTestId("season-schedule-rules");
    await expect(panel).toBeVisible();
    await expect(lead.page.getByTestId("schedule-rules-max")).toHaveValue("2");
    await expect(lead.page.getByTestId("schedule-rules-notice")).toHaveValue("24");
    await lead.page.getByTestId("schedule-rules-save").click();
    await expect(lead.page.getByTestId("schedule-rules-inactive")).toHaveCount(0);
    await noSideScroll(lead.page);
    await panel.scrollIntoViewIfNeeded();
    await shot(lead.page, "termine-regeln-1440.png");

    await lead.page.goto(`/admin/tournaments/${tid}`);
    await expect(lead.page.getByTestId("admin-tr-primary-action")).toContainText("Liga starten");
    await lead.page.getByTestId("admin-tr-primary-action").click();
    await expect(lead.page.getByTestId("admin-tr-status-select")).toHaveValue("live");

    const rows = await (await lead.page.request.get(`/api/tournaments/${tid}/matches-v2`)).json();
    const match = (Array.isArray(rows) ? rows : rows.matches).find((row) => !row.is_preview && Number(row.round) === 1 && row.slots.every((slot) => slot.registration_id));
    expect(match, "Spiel an Spieltag 1").toBeTruthy();
    const registrations = await (await lead.page.request.get(`/api/tournaments/${tid}/registrations`)).json();
    const captainOf = (id) => `captain-${state.teams.findIndex((row) => row.squad_id === registrations.find((reg) => reg.id === id).squad_id)}`;
    const [home, away] = match.slots.map((slot) => slot.registration_id);
    // Die Spielwoche sagt der Server (Block der Matchseite für die Leitung) - die Termine liegen darin.
    const page = await (await lead.page.request.get(`/api/matches/${match.id}/page`)).json();
    expect(page.schedule_block?.rules?.reschedule_max).toBe(2);
    shared = { id: match.id, homeRole: captainOf(home), awayRole: captainOf(away), start: page.schedule_block.window.start };
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  test("Einigung und erste Verschiebung bei 390 px", async ({ browser }, testInfo) => {
    const viewport = { width: 390, height: 844 };
    const home = await as(browser, testInfo, shared.homeRole, viewport);
    const away = await as(browser, testInfo, shared.awayRole, viewport);

    await home.page.goto(`/matches/${shared.id}`);
    await home.page.getByTestId("match-proposal-at").fill(localInput(dayAt(shared.start, 2)));
    await home.page.getByRole("button", { name: "Vorschlagen" }).click();
    await expect(home.page.getByTestId("match-scheduling")).toContainText("wartet auf die Gegenseite");
    await expect(home.page.getByTestId("schedule-home-rule")).toContainText("Ohne Antwort gilt der Vorschlag der Heimseite ab");

    await away.page.goto(`/matches/${shared.id}`);
    await away.page.locator('[data-testid^="match-proposal-accept-"]').click();
    await expect(away.page.getByTestId("schedule-limit")).toContainText("Noch 2 Verschiebungen möglich");
    await expect(away.page.getByTestId("match-proposal-at")).toHaveCount(0);
    await expect(away.page.getByTestId("schedule-history-agreement")).toBeVisible();

    await home.page.goto(`/matches/${shared.id}`);
    await home.page.getByTestId("reschedule-form-at").fill(localInput(dayAt(shared.start, 3)));
    await home.page.getByTestId("reschedule-form-reason").fill("Zwei Spieler haben Spätdienst");
    await home.page.getByTestId("reschedule-form-submit").click();
    await expect(home.page.locator('[data-testid^="reschedule-status-"]').first()).toContainText("wartet auf die Gegenseite");
    await noSideScroll(home.page);
    await shot(home.page, "termine-antrag-390.png");

    await away.page.goto(`/matches/${shared.id}`);
    await away.page.locator('[data-testid^="reschedule-accept-"]').click();
    await expect(away.page.getByTestId("schedule-limit")).toContainText("Noch 1 Verschiebung möglich");
    await expect(away.page.getByTestId("schedule-history-reschedule")).toContainText("Zwei Spieler haben Spätdienst");
    await noSideScroll(away.page);
    await shot(away.page, "termine-verschoben-390.png");

    for (const person of [home, away]) {
      expect(person.problems).toEqual([]);
      await person.close();
    }
  });

  test("Zweite Verschiebung bei 1440 px, die dritte geht an die Leitung", async ({ browser }, testInfo) => {
    const viewport = { width: 1440, height: 900 };
    const home = await as(browser, testInfo, shared.homeRole, viewport);
    const away = await as(browser, testInfo, shared.awayRole, viewport);

    await away.page.goto(`/matches/${shared.id}`);
    await away.page.getByTestId("reschedule-form-at").fill(localInput(dayAt(shared.start, 4)));
    await away.page.getByTestId("reschedule-form-reason").fill("Server-Wartung beim Anbieter");
    await away.page.getByTestId("reschedule-form-submit").click();
    await expect(away.page.locator('[data-testid^="reschedule-withdraw-"]')).toBeVisible();

    await home.page.goto(`/matches/${shared.id}`);
    await home.page.locator('[data-testid^="reschedule-accept-"]').click();
    await expect(home.page.getByTestId("schedule-limit")).toContainText("Keine Verschiebung mehr möglich");
    await expect(home.page.getByTestId("reschedule-hint")).toContainText("2-mal verschoben");
    await expect(home.page.getByTestId("reschedule-form")).toHaveCount(0);
    await noSideScroll(home.page);
    await shot(home.page, "termine-aufgebraucht-1440.png");

    // Die dritte über die API: der Server lehnt sie ab (außerhalb des Browsers, damit die Wache sie nicht als Fehler zählt).
    const third = await home.page.request.post(`/api/matches/${shared.id}/reschedule`, {
      data: { scheduled_at: dayAt(shared.start, 5).toISOString(), reason: "Noch einmal verschieben" } });
    expect(third.status()).toBe(409);
    expect((await third.json()).detail).toContain("Liga-Leitung");

    for (const person of [home, away]) {
      expect(person.problems).toEqual([]);
      await person.close();
    }
  });

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Leitung legt den Termin mit Grund fest bei ${width} px`, async ({ browser }, testInfo) => {
      const lead = await as(browser, testInfo, "lead", { width, height });
      await lead.page.goto(`/matches/${shared.id}`);
      const when = dayAt(shared.start, width === 390 ? 5 : 6);
      await lead.page.getByTestId("lead-schedule-form-at").fill(localInput(when));
      await lead.page.getByTestId("lead-schedule-form-reason").fill("Dritte Verschiebung, Leitung entscheidet");
      await lead.page.getByTestId("lead-schedule-form-submit").click();
      await expect(lead.page.getByTestId("schedule-history").locator('[data-testid="schedule-history-lead"]').first())
        .toContainText("Dritte Verschiebung, Leitung entscheidet");
      const page = await (await lead.page.request.get(`/api/matches/${shared.id}/page`)).json();
      expect(new Date(page.match.scheduled_at).getTime()).toBe(when.getTime());
      expect(page.match.schedule_source).toBe("manual");
      await noSideScroll(lead.page);
      await shot(lead.page, `termine-leitung-${width}.png`);
      expect(lead.problems).toEqual([]);
      await lead.close();
    });
  }
});
