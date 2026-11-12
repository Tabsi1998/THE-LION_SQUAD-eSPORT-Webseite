const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");
const { bild } = require("./anleitungBilder");

// Strafen im Wettbewerb (E.3, docs/LIGA.md „E.3 Strafen“) schreibend gegen den echten Server - ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py: „Liga-Probelauf“ mit Staffel A im Entwurf. Die Leitung startet die Staffel, trägt Spieltag 1 ein und
// verhängt im Reiter „Strafen“ der Season bei 390 px einen Punktabzug und bei 1440 px eine vorläufige Spielsperre, die sie danach
// bestätigt. Ein Gast liest den Abzug in der Tabelle der Ligaseite (ohne Grund). Der Captain sieht die Teamstrafe unter „Meine
// Strafen“ und legt Einspruch ein, die gesperrte Person sieht ihre Sperre und ist nicht spielberechtigt. Über den Einspruch
// entscheidet nicht die Person, die die Strafe verhängt hat - eine zweite hebt sie auf, die Tabelle rechnet zurück. Je Ansicht
// ohne seitliches Scrollen und ohne Konsolenfehler. Braucht wie liga-tabelle-abnahme eine Staffel im Entwurf, also den Seed davor.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const ablauf = state?.ablauf;
const tid = ablauf?.tournament_id;
const seasonUrl = () => `/admin/leagues/seasons/${ablauf.season.id}#strafen`;
const leagueUrl = () => `/liga/${ablauf.league.slug}/${ablauf.season.slug}`;
const DEDUCTION_REASON = "Einsatz eines nicht gemeldeten Spielers an Spieltag 1 (Abnahme)";
const BAN_REASON = "Clip zeigt ein Makro, der Fall wird geprüft (Abnahme)";
const APPEAL = "Der Spieler war gemeldet, die Meldung liegt der Leitung vor (Abnahme).";

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Ganz oben und ohne Fokus: sonst liegen die klebende Kopfzeile und „Zum Inhalt springen“ mitten im Bild.
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true, animations: "disabled", style: "[data-sonner-toaster] { display: none !important; }" });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function as(browser, testInfo, role, viewport) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, locale: "de-AT", timezoneId: "Europe/Vienna", reducedMotion: "reduce" });
  const page = await context.newPage();
  await signIn(page, role);
  return { page, problems: watch(page), close: () => context.close() };
}

/** Schreiben wie die Website: mit dem CSRF-Kopf aus dem Cookie der Sitzung. */
async function post(page, url, data) {
  const cookies = await page.context().cookies();
  const csrf = decodeURIComponent(cookies.find((cookie) => cookie.name === "csrf_token")?.value || "");
  return page.request.post(url, { data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
}

async function matches(page) {
  const response = await page.request.get(`/api/tournaments/${tid}/matches-v2`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  return (Array.isArray(body) ? body : body.matches || []).filter((row) => !row.is_preview);
}

const sides = (match) => (match.slots || []).map((slot) => slot.registration_id).filter(Boolean);

async function standings(page) {
  const response = await page.request.get(`/api/tournaments/${tid}/standings`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function sanctions(page) {
  const response = await page.request.get(`/api/admin/leagues/seasons/${ablauf.season.id}/sanctions`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function openTab(page) {
  await page.goto(seasonUrl());
  await expect(page.getByTestId("season-sanctions")).toBeVisible();
}

const shared = {};

test.describe("Abnahme: Strafen der Liga gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Leitung verhängt Punktabzug (390 px) und vorläufige Spielsperre (1440 px) und bestätigt sie", async ({ browser }, testInfo) => {
    const setup = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    const started = await post(setup.page, `/api/tournaments/${tid}/status`, { status: "live" });
    expect(started.status(), await started.text()).toBe(200);
    const first = (await matches(setup.page)).filter((row) => Number(row.round) === 1 && sides(row).length === 2);
    for (const match of first) {
      const [home, away] = sides(match);
      const done = await post(setup.page, `/api/matches/${match.id}/result`, { results: [
        { registration_id: home, rank: 1, score: 2 }, { registration_id: away, rank: 2, score: 1 }] });
      expect(done.status(), await done.text()).toBe(200);
    }
    await expect.poll(async () => (await matches(setup.page)).filter((row) => first.some((match) => match.id === row.id) && row.status === "completed").length,
      { timeout: 60_000, intervals: [2_000] }).toBe(first.length);
    // Das erste Co-Team des Seeds: sein Captain und ein Mitglied haben eigene Zugänge.
    const target = (await sanctions(setup.page)).targets.find((row) => row.tournament_id === tid);
    const squad = target.squads.find((row) => row.squad_id === state.teams[0].squad_id);
    expect(squad, "erstes Co-Team in der Staffel").toBeTruthy();
    shared.registration = squad.registration_id;
    shared.before = (await standings(setup.page)).find((row) => row.registration_id === shared.registration).points;
    await setup.close();

    const member = await as(browser, testInfo, "member", { width: 1440, height: 900 });
    shared.member = (await (await member.page.request.get("/api/auth/me")).json()).id;
    await member.close();

    // 390 px: Punktabzug über das geführte Formular.
    const phone = await as(browser, testInfo, "lead", { width: 390, height: 844 });
    await openTab(phone.page);
    await expect(phone.page.getByTestId("season-sanctions-empty")).toBeVisible();
    await phone.page.getByTestId("sanction-add").click();
    const form = phone.page.getByTestId("sanction-form");
    await expect(form.getByTestId("sanction-submit")).toBeDisabled();
    await form.getByTestId("sanction-kind").selectOption("point_deduction");
    await form.getByTestId("sanction-staffel").selectOption(tid);
    await form.getByTestId("sanction-squad").selectOption(shared.registration);
    await form.getByTestId("sanction-points").fill("2");
    await form.getByTestId("sanction-rule").fill("Anlage C.4, Einsatz eines unberechtigten Spielers");
    await expect(form.getByTestId("sanction-form-hint")).toContainText("begründen");
    await form.getByTestId("sanction-reason").fill(DEDUCTION_REASON);
    await expect(form.getByTestId("sanction-form-hint")).toHaveCount(0);
    await noSideScroll(phone.page);
    await shot(phone.page, "e3-verwaltung-formular-390.png");
    await bild(phone.page, "e3-handbuch-strafe-verhaengen-390", form);
    await form.getByTestId("sanction-submit").click();
    await expect(phone.page.getByTestId("season-sanctions-list")).toContainText("Punktabzug");
    await expect(phone.page.getByTestId("season-sanctions-list")).toContainText("2 Punkte Abzug");
    await noSideScroll(phone.page);
    await shot(phone.page, "e3-verwaltung-liste-390.png");
    expect(phone.problems).toEqual([]);
    await phone.close();

    // 1440 px: vorläufige Spielsperre aus dem Katalog, danach bestätigt mit einem Liga-Spiel.
    const desk = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await openTab(desk.page);
    await desk.page.getByTestId("sanction-add").click();
    const wide = desk.page.getByTestId("sanction-form");
    await wide.getByTestId("sanction-catalog").selectOption("cheating");
    await expect(wide.getByTestId("sanction-kind")).toHaveValue("player_ban");
    await wide.getByTestId("sanction-staffel").selectOption(tid);
    await wide.getByTestId("sanction-squad").selectOption(shared.registration);
    await wide.getByTestId("sanction-player").selectOption(shared.member);
    await wide.getByTestId("sanction-reason").fill(BAN_REASON);
    await wide.getByTestId("sanction-provisional").check();
    await noSideScroll(desk.page);
    await shot(desk.page, "e3-verwaltung-formular-1440.png");
    await wide.getByTestId("sanction-submit").click();
    const list = desk.page.getByTestId("season-sanctions-list");
    await expect(list).toContainText("Spielsperre");
    const ban = (await sanctions(desk.page)).items.find((row) => row.kind === "player_ban");
    shared.ban = ban.id;
    shared.deduction = (await sanctions(desk.page)).items.find((row) => row.kind === "point_deduction").id;
    await expect(desk.page.getByTestId(`sanction-status-${ban.id}`)).toHaveText("Vorläufig");
    await desk.page.getByTestId(`sanction-confirm-${ban.id}`).click();
    await desk.page.getByTestId(`sanction-confirm-${ban.id}-matches`).fill("1");
    await desk.page.getByTestId(`sanction-action-run-${ban.id}`).click();
    await expect(desk.page.getByTestId(`sanction-status-${ban.id}`)).toHaveText("Gilt");
    await expect(desk.page.getByTestId(`sanction-period-${ban.id}`)).toContainText("1 Liga-Spiel, noch 1");
    await noSideScroll(desk.page);
    await shot(desk.page, "e3-verwaltung-liste-1440.png");
    await bild(desk.page, "e3-handbuch-strafen-reiter-1440", desk.page.getByTestId("season-sanctions"));
    expect(desk.problems).toEqual([]);
    await desk.close();
  });

  test("Tabelle zeigt den Abzug ohne Grund, Betroffene sehen ihre Strafe und der Captain legt Einspruch ein", async ({ browser }, testInfo) => {
    for (const [width, height] of WIDTHS) {
      const guest = await as(browser, testInfo, "anon", { width, height });
      await guest.page.goto(leagueUrl());
      const notes = guest.page.getByTestId("league-staffel-A").getByTestId(`standing-notes-${shared.registration}`);
      await expect(notes).toContainText("−2 Punkte Abzug");
      await expect(guest.page.getByTestId("league-staffel-A")).not.toContainText("nicht gemeldeten Spielers");
      const row = (await standings(guest.page)).find((item) => item.registration_id === shared.registration);
      expect(row.points).toBe(shared.before - 2);
      await noSideScroll(guest.page);
      if (width === 390) await bild(guest.page, "e3-handbuch-tabelle-abzug-390", notes.locator("xpath=ancestor::*[self::tr or self::li][1]"));
      expect(guest.problems).toEqual([]);
      await guest.close();
    }

    // Captain am Handy: die Teamstrafe mit Frist, Einspruch in zwei Schritten.
    const captain = await as(browser, testInfo, "captain-0", { width: 390, height: 844 });
    await captain.page.goto("/my/penalties");
    const card = captain.page.getByTestId(`penalty-card-${shared.deduction}`);
    await expect(card).toContainText("Punktabzug");
    await expect(card).toContainText("gegen das Co-Team");
    await expect(card).toContainText(DEDUCTION_REASON);
    await expect(captain.page.getByTestId(`sanction-deadline-${shared.deduction}`)).toContainText("Einspruch möglich bis");
    await expect(captain.page.getByTestId(`penalty-card-${shared.ban}`)).toHaveCount(0);
    await noSideScroll(captain.page);
    await shot(captain.page, "e3-betroffene-390.png");
    await bild(captain.page, "e3-handbuch-meine-strafen-390", card);
    await captain.page.getByTestId(`sanction-appeal-open-${shared.deduction}`).click();
    await expect(captain.page.getByTestId(`sanction-appeal-submit-${shared.deduction}`)).toBeDisabled();
    await captain.page.getByTestId(`sanction-appeal-text-${shared.deduction}`).fill(APPEAL);
    await captain.page.getByTestId(`sanction-appeal-submit-${shared.deduction}`).click();
    await expect(captain.page.getByTestId(`sanction-appeal-${shared.deduction}`)).toContainText("Einspruch offen");
    await expect(captain.page.getByTestId(`sanction-appeal-${shared.deduction}`)).toContainText("gilt die Strafe weiter");
    await noSideScroll(captain.page);
    await shot(captain.page, "e3-betroffene-einspruch-390.png");
    expect(captain.problems).toEqual([]);
    await captain.close();

    // Die gesperrte Person am PC: ihre Sperre, und die Spielberechtigung sagt es ohne Verstoß.
    const member = await as(browser, testInfo, "member", { width: 1440, height: 900 });
    await member.page.goto("/my/penalties");
    const own = member.page.getByTestId(`penalty-card-${shared.ban}`);
    await expect(own).toContainText("Spielsperre");
    await expect(own).toContainText("gegen dich");
    await expect(member.page.getByTestId(`sanction-period-${shared.ban}`)).toContainText("1 Liga-Spiel, noch 1");
    await expect(member.page.getByTestId(`penalty-card-${shared.deduction}`)).toHaveCount(0);
    const eligibility = await (await member.page.request.get("/api/me/league-eligibility")).json();
    const here = (eligibility.items || eligibility).find((row) => row.season_id === ablauf.season.id);
    expect(here.state).toBe("sanctioned");
    expect(here.reason).toContain("Gesperrt durch die Liga-Leitung");
    expect(here.reason).not.toContain("Makro");
    await noSideScroll(member.page);
    await shot(member.page, "e3-betroffene-1440.png");
    expect(member.problems).toEqual([]);
    await member.close();
  });

  test("Einspruch: nicht die Ausgangsperson - eine zweite hebt die Strafe auf, die Tabelle rechnet zurück", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await openTab(lead.page);
    await expect(lead.page.getByTestId("season-sanctions-count")).toContainText("1 Einspruch wartet");
    await expect(lead.page.getByTestId(`sanction-own-decision-${shared.deduction}`)).toContainText("entscheidet eine andere Person");
    await expect(lead.page.getByTestId(`sanction-appeal-grant-${shared.deduction}`)).toHaveCount(0);
    const refused = await post(lead.page, `/api/admin/leagues/seasons/${ablauf.season.id}/sanctions/${shared.deduction}/appeal/decision`,
      { decision: "granted", note: "Ich nehme es selbst zurück (Abnahme)" });
    expect(refused.status()).toBe(403);
    await shot(lead.page, "e3-verwaltung-einspruch-1440.png");
    await lead.close();

    const admin = await as(browser, testInfo, "admin", { width: 390, height: 844 });
    await openTab(admin.page);
    await admin.page.getByTestId(`sanction-appeal-grant-${shared.deduction}`).click();
    await admin.page.getByTestId(`sanction-action-text-${shared.deduction}`).fill("Die Meldung lag vor, der Abzug war ein Irrtum (Abnahme).");
    await admin.page.getByTestId(`sanction-action-run-${shared.deduction}`).click();
    await admin.page.getByTestId("sanction-filter-all").click();
    await expect(admin.page.getByTestId(`sanction-status-${shared.deduction}`)).toHaveText("Widerrufen");
    const row = (await standings(admin.page)).find((item) => item.registration_id === shared.registration);
    expect(row.points).toBe(shared.before);
    expect(row.deducted_points).toBe(0);
    await noSideScroll(admin.page);
    expect(admin.problems).toEqual([]);
    await admin.close();

    const captain = await as(browser, testInfo, "captain-0", { width: 1440, height: 900 });
    await captain.page.goto("/my/penalties");
    await expect(captain.page.getByTestId(`sanction-appeal-${shared.deduction}`)).toContainText("Einspruch stattgegeben");
    await expect(captain.page.getByTestId(`sanction-status-${shared.deduction}`)).toHaveText("Widerrufen");
    expect(captain.problems).toEqual([]);
    await captain.close();
  });
});
