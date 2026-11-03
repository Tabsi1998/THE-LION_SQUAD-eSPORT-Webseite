const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Liga-Check-in (#1652, docs/LIGA.md D.2) schreibend gegen den echten Server - ohne nachgestellte API. Stand aus
// scripts/seed_abnahme_liga.py (Staffel „Liga-Probelauf“ im Entwurf, fünf Co-Teams). Die Leitung speichert den Check-in der Season,
// veröffentlicht ein Regelwerk mit Zustimmungspflicht und startet die Staffel. Dann: Regelwerks-Sperre, zwei Captains checken in zwei
// Browser-Kontexten ein (390 px), zu wenige Anwesende lehnt der Server ab, Start bei 1440 px genau einmal; am zweiten Spiel läuft das
// Fenster ab - der Fristen-Job legt nur den Vorschlag an, die Leitung entscheidet in Mein Dienst und der Leitungsansicht. Keine
// Konsolenfehler, keine Antwort 4xx/5xx im Browser, kein seitliches Scrollen.

const ROOT = path.join(__dirname, "..", "..", "..");
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

/** Einen Zeit-Job einmal im Backend-Container, nur für diese Staffel. Antwort: die Zahlen des Jobs. */
function runJob(job, hours = 0) {
  const output = execFileSync(process.env.PYTHON || "python3", [
    path.join(ROOT, "scripts", "seed_abnahme_liga.py"), "--job", job, "--tournament", tid, "--hours", String(hours),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(output.trim().split("\n").pop());
}

async function consent(person, squadId) {
  const rules = await (await person.page.request.get(`/api/league-rules/seasons/${ablauf.league.slug}/${ablauf.season.slug}`)).json();
  const given = await api(person.page, "POST", "/api/league-rules/consents", { version_id: rules.consent.version_id, season_id: ablauf.season.id, squad_id: squadId });
  expect(given.status(), await given.text()).toBe(200);
}

function viennaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

let shared = null;

test.describe("Abnahme: Liga-Check-in gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Leitung: Check-in der Season speichern, Regelwerk mit Zustimmungspflicht, Staffel starten", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(`/admin/leagues/seasons/${ablauf.season.id}`);
    const panel = lead.page.getByTestId("season-checkin-rules");
    await expect(panel).toBeVisible();
    await expect(lead.page.getByTestId("checkin-rules-min")).toHaveValue("3");
    await expect(lead.page.getByTestId("checkin-rules-opens")).toHaveValue("15");
    await lead.page.getByTestId("checkin-rules-save").click();
    await expect(lead.page.getByTestId("checkin-rules-inactive")).toHaveCount(0);
    await noSideScroll(lead.page);
    await panel.scrollIntoViewIfNeeded();
    await shot(lead.page, "checkin-regeln-1440.png");

    // Regelwerk mit Zustimmungspflicht (Obmann 03.11.): ohne Zustimmung kein Check-in.
    const scope = `/api/admin/league-rules/league_season/${ablauf.season.id}`;
    const draft = await api(lead.page, "PUT", `${scope}/draft`, { title: "Regelwerk Check-in", body_md: "# Fairplay\n\nCheck-in nach § 8. Platzhalter der Abnahme, erfunden.\n", annexes: [] });
    expect(draft.status(), await draft.text()).toBe(200);
    const published = await api(lead.page, "POST", `${scope}/publish`, {
      revision: (await draft.json()).revision, valid_from: viennaToday(), change_reason: "Fassung für die Abnahme des Check-ins", requires_consent: true });
    expect(published.status(), await published.text()).toBe(200);

    await lead.page.goto(`/admin/tournaments/${tid}`);
    await expect(lead.page.getByTestId("admin-tr-primary-action")).toContainText("Liga starten");
    await lead.page.getByTestId("admin-tr-primary-action").click();
    const anyway = lead.page.getByRole("button", { name: "Trotzdem live" });
    if (await anyway.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) await anyway.click();
    await expect(lead.page.getByTestId("admin-tr-status-select")).toHaveValue("live");

    const rows = await (await lead.page.request.get(`/api/tournaments/${tid}/matches-v2`)).json();
    const matches = (Array.isArray(rows) ? rows : rows.matches)
      .filter((row) => !row.is_preview && Number(row.round) === 1 && row.slots.every((slot) => slot.registration_id));
    expect(matches.length, "zwei Spiele an Spieltag 1").toBeGreaterThanOrEqual(2);
    const registrations = await (await lead.page.request.get(`/api/tournaments/${tid}/registrations`)).json();
    const squadOf = (id) => registrations.find((reg) => reg.id === id).squad_id;
    const captainOf = (id) => `captain-${state.teams.findIndex((row) => row.squad_id === squadOf(id))}`;
    // Termin in sechs Minuten: das Fenster (15 davor bis 15 danach) ist damit für beide Spiele offen.
    const at = new Date(Date.now() + 6 * MINUTE).toISOString();
    shared = {};
    for (const [key, match] of [["play", matches[0]], ["expire", matches[1]]]) {
      const moved = await api(lead.page, "PATCH", `/api/matches/${match.id}`, { scheduled_at: at, schedule_reason: "Abnahme: Termin jetzt" });
      expect(moved.status(), await moved.text()).toBe(200);
      const [home, away] = match.slots.map((slot) => slot.registration_id);
      const page = await (await lead.page.request.get(`/api/matches/${match.id}/page`)).json();
      expect(page.checkin?.state).toBe("open");
      shared[key] = { id: match.id, home, away, homeRole: captainOf(home), awayRole: captainOf(away), homeSquad: squadOf(home), awaySquad: squadOf(away) };
    }
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  test("Captains bei 390 px: erst zustimmen, dann einchecken - zu wenige lehnt der Server ab", async ({ browser }, testInfo) => {
    const viewport = { width: 390, height: 844 };
    const play = shared.play;
    const home = await as(browser, testInfo, play.homeRole, viewport);
    const away = await as(browser, testInfo, play.awayRole, viewport);

    await home.page.goto(`/matches/${play.id}`);
    await expect(home.page.getByTestId("checkin-headline")).toHaveText("Check-in offen");
    await expect(home.page.getByTestId("checkin-hint")).toContainText("Das Regelwerk hat sich geändert");
    await expect(home.page.getByTestId("checkin-rules-link")).toHaveAttribute("href", `/liga/${ablauf.league.slug}/${ablauf.season.slug}/regeln`);
    await expect(home.page.getByTestId("checkin-submit")).toHaveCount(0);
    // Erst einchecken, dann melden (Codex zu D.2): statt des Meldeformulars steht der Satz, wer fehlt.
    await expect(home.page.getByTestId("match-report-hint")).toContainText("eure Seite hat noch nicht eingecheckt");
    await expect(home.page.getByTestId("match-report-form")).toHaveCount(0);
    await noSideScroll(home.page);
    await shot(home.page, "checkin-regelwerk-390.png");
    const refused = await api(home.page, "POST", `/api/matches/${play.id}/checkin`, { present: [] });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).detail).toContain("Regelwerk");

    await consent(home, play.homeSquad);
    await home.page.goto(`/matches/${play.id}`);
    await expect(home.page.getByTestId("checkin-submit")).toBeDisabled();
    const roster = (await (await home.page.request.get(`/api/matches/${play.id}/page`)).json()).checkin.roster.filter((row) => !row.blocked);
    expect(roster.length).toBeGreaterThanOrEqual(3);
    for (const person of roster.slice(0, 2)) await home.page.getByTestId(`checkin-roster-${person.id}`).check();
    await expect(home.page.getByTestId("checkin-roster-count")).toContainText("noch eine Person");
    await expect(home.page.getByTestId("checkin-submit")).toBeDisabled();
    const few = await api(home.page, "POST", `/api/matches/${play.id}/checkin`, { present: roster.slice(0, 2).map((row) => row.id) });
    expect(few.status()).toBe(422);
    expect((await few.json()).detail).toContain("mindestens 3");
    await home.page.getByTestId(`checkin-roster-${roster[2].id}`).check();
    await home.page.getByTestId("checkin-submit").click();
    await expect(home.page.getByTestId(`checkin-side-${play.home}`)).toHaveAttribute("data-checked", "true");
    await expect(home.page.getByTestId("checkin-waiting")).toBeVisible();
    await noSideScroll(home.page);
    await shot(home.page, "checkin-eingecheckt-390.png");

    await consent(away, play.awaySquad);
    await away.page.goto(`/matches/${play.id}`);
    await expect(away.page.getByTestId(`checkin-side-status-${play.home}`)).toContainText("3 Spieler");
    const theirs = (await (await away.page.request.get(`/api/matches/${play.id}/page`)).json()).checkin.roster.filter((row) => !row.blocked);
    for (const person of theirs.slice(0, 3)) await away.page.getByTestId(`checkin-roster-${person.id}`).check();
    await away.page.getByTestId("checkin-submit").click();
    await expect(away.page.getByTestId("checkin-headline")).toHaveText("Spielbereit");
    await expect(away.page.getByTestId("checkin-start-button")).toBeVisible();
    await noSideScroll(away.page);
    await shot(away.page, "checkin-bereit-390.png");

    for (const person of [home, away]) {
      expect(person.problems).toEqual([]);
      await person.close();
    }
  });

  test("Start bei 1440 px: eine Seite startet, beide sehen „läuft“, der zweite Start ist eine Wiederholung", async ({ browser }, testInfo) => {
    const viewport = { width: 1440, height: 900 };
    const play = shared.play;
    const home = await as(browser, testInfo, play.homeRole, viewport);
    const away = await as(browser, testInfo, play.awayRole, viewport);

    await away.page.goto(`/matches/${play.id}`);
    await away.page.getByTestId("checkin-start-button").click();
    await expect(away.page.getByTestId("checkin-headline")).toHaveText("Spiel läuft");
    await noSideScroll(away.page);
    await shot(away.page, "checkin-laeuft-1440.png");

    await home.page.goto(`/matches/${play.id}`);
    await expect(home.page.getByTestId("checkin-headline")).toHaveText("Spiel läuft");
    await expect(home.page.getByTestId("checkin-own")).toHaveCount(0);
    // Beide eingecheckt und gestartet: jetzt steht das Meldeformular da.
    await expect(home.page.getByTestId("match-report-form")).toBeVisible();
    await expect(home.page.getByTestId("match-report-hint")).toHaveCount(0);
    const page = await (await home.page.request.get(`/api/matches/${play.id}/page`)).json();
    expect(page.match.status).toBe("in_progress");
    expect(page.match.started_at).toBeTruthy();
    const again = await api(home.page, "POST", `/api/matches/${play.id}/checkin/start`, {});
    expect(again.status()).toBe(200);
    expect((await again.json()).idempotent_replay).toBe(true);

    for (const person of [home, away]) {
      expect(person.problems).toEqual([]);
      await person.close();
    }
  });

  test("Fensterablauf: der Job legt nur den Vorschlag an, die Leitung entscheidet", async ({ browser }, testInfo) => {
    const expire = shared.expire;
    const home = await as(browser, testInfo, expire.homeRole, { width: 390, height: 844 });
    await consent(home, expire.homeSquad);
    await home.page.goto(`/matches/${expire.id}`);
    const roster = (await (await home.page.request.get(`/api/matches/${expire.id}/page`)).json()).checkin.roster.filter((row) => !row.blocked);
    for (const person of roster.slice(0, 3)) await home.page.getByTestId(`checkin-roster-${person.id}`).check();
    await home.page.getByTestId("checkin-submit").click();
    await expect(home.page.getByTestId(`checkin-side-${expire.home}`)).toHaveAttribute("data-checked", "true");
    expect(home.problems).toEqual([]);
    await home.close();

    // Die Leitung legt den Termin 16 Minuten zurück: Das Fenster ist damit wirklich zu - für den Job wie für jede Seite im
    // Browser. Die Gastseite fehlt, der Job schlägt vor, wertet aber nichts.
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    const moved = await api(lead.page, "PATCH", `/api/matches/${expire.id}`, {
      scheduled_at: new Date(Date.now() - 16 * MINUTE).toISOString(), schedule_reason: "Abnahme: Fenster abgelaufen" });
    expect(moved.status(), await moved.text()).toBe(200);
    const counts = runJob("match_deadlines", 0);
    expect(counts.proposed).toBe(1);
    expect(runJob("match_deadlines", 0).proposed, "genau ein Vorschlag").toBe(0);

    const before = await (await lead.page.request.get(`/api/matches/${expire.id}/page`)).json();
    expect(before.match.status).toBe("scheduled");
    expect(before.checkin.proposal.missing.length).toBe(1);

    await lead.page.goto("/admin/dienst");
    await expect(lead.page.getByTestId(`duty-checkin-${expire.id}`)).toContainText("Check-in abgelaufen");
    await noSideScroll(lead.page);
    await shot(lead.page, "dienst-checkin-1440.png");

    await lead.page.goto(`/matches/${expire.id}`);
    await expect(lead.page.getByTestId("checkin-headline")).toHaveText("Check-in geschlossen");
    await expect(lead.page.getByTestId("checkin-proposal")).toContainText("hat nicht eingecheckt");
    await expect(lead.page.getByTestId("checkin-lead")).toBeVisible();
    await noSideScroll(lead.page);
    await shot(lead.page, "checkin-vorschlag-1440.png");

    await lead.page.getByTestId("checkin-proposal-decide").click();
    await expect(lead.page.getByTestId(`lead-case-ns-${expire.id}`)).toBeVisible();
    await expect(lead.page.getByTestId(`lead-case-ns-${expire.id}`)).toContainText("Check-in bis");
    await expect(lead.page.getByTestId(`lead-no-show-${expire.home}`)).toHaveCount(0);
    await shot(lead.page, "leitung-nicht-erschienen-1440.png");
    await lead.page.getByTestId(`lead-no-show-${expire.away}`).click();
    await expect(lead.page.getByTestId(`lead-case-ns-${expire.id}`)).toHaveCount(0);
    const after = await (await lead.page.request.get(`/api/matches/${expire.id}/page`)).json();
    expect(after.match.status).toBe("forfeit");
    expect(after.match.forfeit_registration_id).toBe(expire.away);
    expect(lead.problems).toEqual([]);
    await lead.close();
  });
});
