const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Die Selbstanmeldung schreibend gegen den echten Server (docs/LIGA.md, B.4, #2205) - ohne nachgestellte API. Stand aus scripts/seed_abnahme_liga.py: eigene „Liga-Anmeldung“,
// je Seed eine neue öffentliche Season mit gültigem Regelwerk, Liga 1 und leerer Staffel A. Die Leitung setzt Fenster und Startplätze; Captains reichen bei 390 und 1440 px ein und ziehen
// zurück; zwei Anträge gehen gleichzeitig auf den letzten Platz; die Leitung nimmt an, setzt auf die Warteliste, lehnt ab und teilt zu. Keine Konsolenfehler, keine Antwort 4xx/5xx,
// kein seitliches Scrollen. Erfundene Namen.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const run = state?.anmeldung;
const adminUrl = () => `/admin/leagues/seasons/${run.season.id}`;
const seasonUrl = () => `/liga/${run.league.slug}/${run.season.slug}`;
const inboxApi = () => `/api/admin/leagues/seasons/${run.season.id}/applications`;
const ignoreGuest = (response) => response.url().includes("/api/auth/");
const SMALL = { width: 390, height: 844 };
const LARGE = { width: 1440, height: 900 };

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
  return { page, problems: watch(page, { allow: role === "anon" ? ignoreGuest : () => false }), close: () => context.close() };
}

function localInput(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Der ganze Weg eines Captains im Browser. */
async function apply(person, index, width) {
  const page = person.page;
  const squadId = state.teams[index].squad_id;
  await page.goto(seasonUrl());
  await page.getByTestId("league-application-start").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mit Co-Team anmelden");
  await expect(page.getByTestId(`apply-squad-${squadId}`)).toBeChecked();
  await noSideScroll(page);
  await page.getByTestId("apply-next").click();
  await expect(page.getByTestId("apply-check-ok")).toBeVisible();
  await noSideScroll(page);
  if (width) await shot(page, `anmeldung-pruefung-${width}.png`);
  await page.getByTestId("apply-next").click();
  await expect(page.getByTestId("apply-next")).toBeDisabled();
  await expect(page.getByTestId("apply-rules-version")).toContainText("Version 1");
  await page.getByTestId("apply-accept-rules").check();
  await page.getByTestId("apply-accept-privacy").check();
  await noSideScroll(page);
  if (width) await shot(page, `anmeldung-zustimmen-${width}.png`);
  await page.getByTestId("apply-next").click();
  await expect(page.getByTestId("apply-summary")).toContainText(state.teams[index].squad_name);
  await page.getByTestId("apply-submit").click();
  await expect(page.getByTestId(`league-application-row-${squadId}`)).toContainText("Eingereicht");
  await noSideScroll(page);
}

async function csrfHeaders(page) {
  const cookie = (await page.context().cookies()).find((row) => row.name === "csrf_token");
  return cookie ? { "X-CSRF-Token": decodeURIComponent(cookie.value) } : {};
}

test.describe("Abnahme: Selbstanmeldung gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !run, `Kein Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Ohne Fenster keine Selbstanmeldung, die Leitung setzt Fenster und Startplätze", async ({ browser }, testInfo) => {
    const guest = await as(browser, testInfo, "anon", LARGE);
    await guest.page.goto(seasonUrl());
    await expect(guest.page.getByRole("heading", { level: 1 })).toContainText("Liga-Anmeldung");
    await expect(guest.page.getByTestId("league-application")).toHaveCount(0);
    expect(guest.problems).toEqual([]);
    await guest.close();

    const lead = await as(browser, testInfo, "lead", LARGE);
    // Reiter „Anmeldung und Kader“ (#2267).
    await lead.page.goto(`${adminUrl()}#selbstanmeldung`);
    await expect(lead.page.getByTestId("season-applications")).toHaveCount(0);
    await lead.page.getByTestId("season-form-application-opens").fill(localInput(new Date(Date.now() - 60 * 60 * 1000)));
    await lead.page.getByTestId("season-form-application-closes").fill(localInput(new Date(Date.now() + 48 * 60 * 60 * 1000)));
    await lead.page.getByTestId("season-form-application-slots").fill("3");
    await lead.page.getByTestId("season-form-application-waitlist-note").fill("Wird ein Platz frei, entscheidet die Leitung nach dem Eingang.");
    await lead.page.getByTestId("season-save-anmeldung").click();
    await expect(lead.page.getByTestId("season-applications-stats")).toContainText("0 von 3 Startplätzen belegt");
    await noSideScroll(lead.page);
    await shot(lead.page, "anmeldung-einstellungen-1440.png");
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Gast (${width} px): Fenster und freie Plätze, keine Personen`, async ({ browser }, testInfo) => {
      const guest = await as(browser, testInfo, "anon", { width, height });
      await guest.page.goto(seasonUrl());
      await expect(guest.page.getByTestId("league-application-window")).toContainText("Offen bis");
      await expect(guest.page.getByTestId("league-application-seats")).toHaveText("3 von 3 Startplätzen frei");
      await expect(guest.page.getByTestId("league-application-waitlist-note")).toContainText("nach dem Eingang");
      await expect(guest.page.getByTestId("league-application-login")).toBeVisible();
      await expect(guest.page.getByTestId("league-application-start")).toHaveCount(0);
      await noSideScroll(guest.page);
      await shot(guest.page, `anmeldung-gast-${width}.png`);
      expect(guest.problems).toEqual([]);
      await guest.close();
    });
  }

  test("Mitglied ohne Rolle: Stand ja, Knopf nein", async ({ browser }, testInfo) => {
    const member = await as(browser, testInfo, "member", SMALL);
    await member.page.goto(seasonUrl());
    await expect(member.page.getByTestId("league-application-squads")).toContainText("Anmeldung offen");
    await expect(member.page.getByTestId("league-application-start")).toHaveCount(0);
    expect(member.problems).toEqual([]);
    await member.close();
  });

  test("Captains reichen ein, einer zieht zurück und reicht neu ein", async ({ browser }, testInfo) => {
    const small = await as(browser, testInfo, "captain-6", SMALL);
    await apply(small, 6, 390);
    await shot(small.page, "anmeldung-status-390.png");
    expect(small.problems).toEqual([]);
    await small.close();

    const large = await as(browser, testInfo, "captain-7", LARGE);
    await apply(large, 7, 1440);
    await large.page.getByTestId(`league-application-withdraw-${state.teams[7].squad_id}`).click();
    await large.page.getByTestId("confirm-dialog-confirm").click();
    await expect(large.page.getByTestId(`league-application-row-${state.teams[7].squad_id}`)).toContainText("Zurückgezogen");
    await apply(large, 7);
    expect(large.problems).toEqual([]);
    await large.close();

    for (const index of [5, 4, 3]) {
      const person = await as(browser, testInfo, `captain-${index}`, index === 3 ? SMALL : LARGE);
      await apply(person, index);
      expect(person.problems).toEqual([]);
      await person.close();
    }
  });

  test("Leitung: annehmen mit und ohne Staffel, zwei gleichzeitig auf den letzten Platz, Warteliste, ablehnen, zuteilen", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", LARGE);
    await lead.page.goto(`${adminUrl()}#anmeldungen`);
    await expect(lead.page.getByTestId("season-applications-stats")).toContainText("5 offen");
    const items = (await (await lead.page.request.get(inboxApi())).json()).items;
    const appOf = (index) => items.find((row) => row.squad_id === state.teams[index].squad_id && row.status === "submitted").id;
    const [first, second, racerA, racerB, rejected] = [appOf(6), appOf(7), appOf(5), appOf(4), appOf(3)];
    expect(JSON.stringify(items)).not.toContain("birth");

    await lead.page.getByTestId(`application-staffel-${first}`).selectOption(run.tournament_id);
    await lead.page.getByTestId(`application-accept-${first}`).click();
    // Die Auswahl der Staffel nennt denselben Namen: Erst der Link zur Verwaltung zeigt, dass zugeteilt ist.
    await expect(lead.page.getByTestId(`application-open-staffel-${first}`)).toBeVisible();
    await lead.page.getByTestId(`application-accept-${second}`).click();
    await expect(lead.page.getByTestId(`application-assign-${second}`)).toBeVisible();

    // Der letzte Platz: Zwei Annahmen im selben Moment gegen den echten Server und die echte Datenbank.
    const headers = await csrfHeaders(lead.page);
    const [one, two] = await Promise.all([racerA, racerB].map((id) => lead.page.request.post(`${inboxApi()}/${id}/accept`, { headers, data: {} })));
    expect([one.status(), two.status()].sort()).toEqual([200, 409]);
    const loser = one.status() === 409 ? racerA : racerB;
    expect((await (one.status() === 409 ? one : two).json()).detail).toContain("Startplätze");

    await lead.page.reload();
    await expect(lead.page.getByTestId("season-applications-stats")).toContainText("3 von 3 Startplätzen belegt");
    await lead.page.getByTestId(`application-waitlist-${loser}`).click();
    await expect(lead.page.getByTestId(`application-${loser}`)).toContainText("Warteliste");

    await lead.page.getByTestId(`application-staffel-${second}`).selectOption(run.tournament_id);
    await lead.page.getByTestId(`application-assign-${second}`).click();
    await expect(lead.page.getByTestId(`application-open-staffel-${second}`)).toBeVisible();
    await noSideScroll(lead.page);
    await shot(lead.page, "anmeldung-eingang-1440.png");
    expect(lead.problems).toEqual([]);

    const registrations = await (await lead.page.request.get(`/api/tournaments/${run.tournament_id}/registrations`)).json();
    expect(registrations.map((row) => row.squad_id).sort()).toEqual([state.teams[6].squad_id, state.teams[7].squad_id].sort());
    await lead.close();

    const small = await as(browser, testInfo, "lead", SMALL);
    await small.page.goto(`${adminUrl()}#anmeldungen`);
    await small.page.getByTestId(`application-reject-open-${rejected}`).click();
    await expect(small.page.getByTestId(`application-reject-send-${rejected}`)).toBeDisabled();
    await small.page.getByTestId(`application-reason-${rejected}`).fill("Für diese Season ist der Kader zu neu.");
    await small.page.getByTestId(`application-reject-send-${rejected}`).click();
    await expect(small.page.getByTestId("season-applications-closed")).toContainText("Abgeschlossen (1)");
    await noSideScroll(small.page);
    await shot(small.page, "anmeldung-eingang-390.png");
    expect(small.problems).toEqual([]);
    await small.close();
  });

  test("Teams sehen ihren Stand, Gäste die vollen Plätze", async ({ browser }, testInfo) => {
    const accepted = await as(browser, testInfo, "captain-6", SMALL);
    await accepted.page.goto(seasonUrl());
    const row = accepted.page.getByTestId(`league-application-row-${state.teams[6].squad_id}`);
    await expect(row).toContainText("Angenommen");
    await expect(row).toContainText("Liga 1 · Staffel A");
    await expect(accepted.page.getByTestId(`league-application-withdraw-${state.teams[6].squad_id}`)).toHaveCount(0);
    await accepted.page.goto(`/teams?team=${state.teams[6].team_id}`);
    await expect(accepted.page.locator('[data-testid^="squad-application-"]').first()).toContainText("Angenommen");
    await noSideScroll(accepted.page);
    expect(accepted.problems).toEqual([]);
    await accepted.close();

    const refused = await as(browser, testInfo, "captain-3", LARGE);
    await refused.page.goto(seasonUrl());
    await expect(refused.page.getByTestId(`league-application-row-${state.teams[3].squad_id}`)).toContainText("der Kader zu neu");
    await expect(refused.page.getByTestId("league-application-start")).toBeVisible();
    expect(refused.problems).toEqual([]);
    await refused.close();

    for (const viewport of [SMALL, LARGE]) {
      const guest = await as(browser, testInfo, "anon", viewport);
      await guest.page.goto(seasonUrl());
      await expect(guest.page.getByTestId("league-application-seats")).toHaveText("Alle 3 Startplätze vergeben, die Warteliste ist offen");
      await expect(guest.page.getByTestId("league-application")).not.toContainText(state.teams[6].squad_name);
      await noSideScroll(guest.page);
      expect(guest.problems).toEqual([]);
      await guest.close();
    }
  });
});
