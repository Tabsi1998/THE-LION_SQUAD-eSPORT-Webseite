const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Das Regelwerk schreibend gegen den echten Server (docs/LIGA.md, #1646) - ohne nachgestellte API. Stand aus scripts/seed_abnahme_liga.py,
// öffentliche Season der „Liga-Probelauf“. Die Turnierleitung schreibt und veröffentlicht zwei Versionen; bei 390 und 1440 px liest ein
// Gast Text, Markierung, Vergleich und PDF; ein Captain stimmt zu. Keine Konsolenfehler, keine Antwort 4xx/5xx, kein seitliches Scrollen.
// Erfundene Regeln.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const ablauf = state?.ablauf;
const scopeUrl = () => `/admin/leagues/rules/league_season/${ablauf.season.id}`;
const pageUrl = () => `/liga/${ablauf.league.slug}/${ablauf.season.slug}/regeln`;
const stamp = Date.now().toString(36);
const FIRST = `Die Probe-Regel ${stamp} gilt von Anfang an.`;
const SECOND = `Die Probe-Regel ${stamp} gilt ab heute anders.`;
// Aus den Einstellungen (#2269): Variablen im Satz und der Baustein „Modi der Season“ - das Ziel setzt der Test vorher auf 250.
const MODES = "# § 3 Modi\nIn {{mode:stellung.name}} gilt das Ziel {{mode:stellung.target}} bei {{team_size}} Spielern je Map.\n\n[[baustein:modes]]";
const RENAMED = `Hardpoint ${stamp}`;
const ignoreGuest = (response) => response.url().includes("/api/auth/");

async function csrfHeaders(page) {
  const cookie = (await page.context().cookies()).find((row) => row.name === "csrf_token");
  return cookie ? { "X-CSRF-Token": decodeURIComponent(cookie.value) } : {};
}

/** Die echte API mit der Sitzung der Seite - für Einstellungen, die der Obmann in der Verwaltung ändern würde. */
async function ok(page, method, url, data) {
  const response = await page.request.fetch(url, { method, data, headers: await csrfHeaders(page) });
  const body = await response.json().catch(() => null);
  expect(response.status(), `${method} ${url}: ${JSON.stringify(body)}`).toBe(200);
  return body;
}

/** Die Ergebnisregeln der Season als PUT-Körper - so, wie die Verwaltung sie speichert. */
async function resultRulesBody(page) {
  const view = await ok(page, "GET", `/api/admin/leagues/seasons/${ablauf.season.id}/result-rules`);
  const rules = {};
  for (const row of view.rules || []) if (row.season_rule) rules[row.mode] = row.season_rule;
  return { scores_required: Boolean(view.scores_required), rules };
}

async function setTarget(page, target) {
  const body = await resultRulesBody(page);
  await ok(page, "PUT", `/api/admin/leagues/seasons/${ablauf.season.id}/result-rules`, { ...body, rules: { ...body.rules, stellung: { kind: "score", target } } });
}

async function renameMode(page, label) {
  const game = (await ok(page, "GET", "/api/games")).find((row) => row.id === state.game.id);
  const modes = game.match_modes.map((mode) => (mode.mode === "stellung" ? { ...mode, label } : mode));
  await ok(page, "PATCH", `/api/games/${game.id}`, { match_modes: modes });
}

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

/** Text in die Markdown-Ansicht des Editors - so kommt er genau so an, wie er getippt ist. */
async function writeMarkdown(page, testId, text) {
  const editor = page.getByTestId(testId);
  await editor.getByRole("button", { name: "Markdown" }).click();
  await page.getByTestId(`${testId}-markdown`).fill(text);
}

async function publish(page, reason, { consent = false } = {}) {
  await page.getByTestId("rules-reason").fill(reason);
  if (consent) await page.getByTestId("rules-requires-consent").check();
  await page.getByTestId("rules-publish").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByText("Version veröffentlicht.")).toBeVisible();
}

test.describe("Abnahme: Regelwerk gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !ablauf, `Kein Ablauf-Stand in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py laufen lassen und ABNAHME_STATE auf dessen Stand-Datei setzen`);
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  test("Turnierleitung: Entwurf mit Baustein und Anlage, Vorschau, Veröffentlichen", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(scopeUrl());
    await expect(lead.page.getByRole("heading", { level: 1, name: "Regelwerk", exact: true })).toBeVisible();
    // Das Ziel des Modus „Stellung“ in der Season: 250 - die Variable und der Baustein lesen es (#2269).
    await setTarget(lead.page, 250);
    await lead.page.reload();
    await lead.page.getByTestId("rules-new-draft").click();
    await lead.page.getByTestId("rules-title").fill("Regelwerk Probelauf");
    await writeMarkdown(lead.page, "rules-body", `# § 1 Fairplay\n${FIRST}\n\n${MODES}\n\n# § 2 Maps`);
    await lead.page.getByTestId("rules-block-map_pool").click();
    // Die Variablenliste zeigt den Wert von heute.
    await lead.page.getByTestId("rules-variables").locator("summary").click();
    await expect(lead.page.getByTestId("rules-var-mode:stellung.target")).toContainText("250");
    await expect(lead.page.getByTestId("rules-var-team_size")).toContainText("4");
    await lead.page.getByTestId("rules-annex-add").click();
    await lead.page.getByTestId("rules-annex-title-0").fill("Strafen");
    await writeMarkdown(lead.page, "rules-annex-body-0", "Verwarnung, dann Punktabzug.");
    await lead.page.getByTestId("rules-preview").click();
    await expect(lead.page.getByTestId("rules-preview-document")).toContainText("Modus");
    await expect(lead.page.getByTestId("rules-preview-document")).toContainText("In Stellung gilt das Ziel 250 bei 4 Spielern je Map.");
    await expect(lead.page.getByTestId("rules-preview-document")).toContainText("Punkte bis zum Ziel 250");
    await noSideScroll(lead.page);
    await shot(lead.page, "regeln-pflege-1440.png");
    await publish(lead.page, "Erste Fassung für den Probelauf", { consent: true });
    await expect(lead.page.getByTestId("rules-versions")).toContainText("Erste Fassung für den Probelauf");
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  test("Zweite Version: aus der letzten vorbereitet, nur der geänderte Paragraf ist markiert", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(scopeUrl());
    await lead.page.getByTestId("rules-from-latest").click();
    const body = lead.page.getByTestId("rules-body");
    await body.getByRole("button", { name: "Markdown" }).click();
    const text = await lead.page.getByTestId("rules-body-markdown").inputValue();
    expect(text).toContain("[[baustein:map_pool]]");
    await lead.page.getByTestId("rules-body-markdown").fill(text.replace(FIRST, SECOND));
    await publish(lead.page, "Fairplay neu gefasst");
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  for (const [width, height] of WIDTHS) {
    test(`Gast (${width} px): Text, Markierung, Vergleich und PDF`, async ({ browser }, testInfo) => {
      const guest = await as(browser, testInfo, "anon", { width, height });
      await guest.page.goto(pageUrl());
      await expect(guest.page.getByRole("heading", { level: 1 })).toContainText("Regelwerk Probelauf");
      const fairplay = guest.page.locator("[id='1-fairplay']");
      await expect(fairplay).toContainText(SECOND);
      await expect(fairplay).toContainText("Geändert in Version");
      await expect(guest.page.locator("[id='2-maps']")).not.toHaveAttribute("data-mark");
      await expect(guest.page.locator("[id='2-maps'] table")).toContainText("Modus");
      await expect(guest.page.locator("[id='anlage-a']")).toContainText("Punktabzug");
      await expect(guest.page.getByTestId("rules-changes")).toContainText("§ 1 Fairplay");
      await noSideScroll(guest.page);
      await shot(guest.page, `regeln-${width}.png`);

      await guest.page.getByTestId("rules-search").fill(stamp);
      await expect(guest.page.getByTestId("rules-search-count")).toHaveText("1 von 1");
      await guest.page.getByTestId("rules-search").press("Escape");

      const href = await guest.page.getByTestId("rules-pdf").getAttribute("href");
      const pdf = await guest.page.request.get(href);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

      const options = guest.page.getByTestId("rules-compare-select").locator("option");
      await guest.page.getByTestId("rules-compare-select").selectOption(await options.nth(1).getAttribute("value"));
      const compare = guest.page.getByTestId("rules-compare");
      await expect(compare.locator("del", { hasText: "von" })).toBeVisible();
      await expect(compare.locator("ins", { hasText: "heute" })).toBeVisible();
      await noSideScroll(guest.page);
      await shot(guest.page, `regeln-vergleich-${width}.png`);

      await guest.page.goto(`/liga/${ablauf.league.slug}/${ablauf.season.slug}`);
      await expect(guest.page.getByTestId("league-rules-version")).toContainText("gültig ab");
      await expect(guest.page.getByTestId("league-rules")).toHaveCount(0);
      expect(guest.problems).toEqual([]);
      await guest.close();
    });
  }

  test("Captain: Aufgabe auf der Startseite, Zustimmung, die Leitung sieht den Stand", async ({ browser }, testInfo) => {
    const captain = await as(browser, testInfo, "captain-0", { width: 390, height: 844 });
    await captain.page.goto("/dashboard");
    await expect(captain.page.getByText("Regeln zustimmen").first()).toBeVisible();
    await captain.page.goto(pageUrl());
    const hint = captain.page.getByTestId("rules-consent");
    await hint.getByRole("button", { name: "Zustimmen" }).first().click();
    await expect(hint).toContainText("hat zugestimmt");
    await noSideScroll(captain.page);
    expect(captain.problems).toEqual([]);
    await captain.close();

    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await lead.page.goto(scopeUrl());
    await expect(lead.page.getByTestId(`rules-consent-row-${state.teams[0].squad_id}`)).toContainText("zugestimmt");
    expect(lead.problems).toEqual([]);
    await lead.close();
  });

  // Aus den Einstellungen (#2269): Modus umbenennen und Ziel ändern → „Regelwerk muss freigegeben werden“ → Vorschlag mit Unterschieden →
  // Freigabe mit Zustimmungspflicht → Team sieht „bitte zustimmen“; Web und PDF zeigen die neuen Werte, die alte Version bleibt.
  test("Einstellungen geändert: Hinweis, Vorschlag, Freigabe mit Zustimmungspflicht", async ({ browser }, testInfo) => {
    const lead = await as(browser, testInfo, "lead", { width: 1440, height: 900 });
    await renameMode(lead.page, RENAMED);
    await setTarget(lead.page, 300);
    // Die veröffentlichte Fassung ändert sich nicht still - die Verwaltung zeigt den Hinweis an drei Stellen.
    const page = await (await lead.page.request.get(`/api/league-rules/seasons/${ablauf.league.slug}/${ablauf.season.slug}`)).json();
    const before = page.sections.map((row) => row.body_md).join("\n");
    expect(before).toContain("In Stellung gilt das Ziel 250");
    expect(before).not.toContain(RENAMED);
    await lead.page.goto(`/admin/leagues/seasons/${ablauf.season.id}`);
    await expect(lead.page.getByTestId("season-rules-notice")).toContainText("Regelwerk muss freigegeben werden");
    await lead.page.goto("/admin/dienst");
    await expect(lead.page.getByTestId(`duty-rules-${ablauf.season.id}`)).toContainText("Regelwerk muss freigegeben werden");
    await lead.page.getByTestId(`duty-rules-open-${ablauf.season.id}`).click();
    await expect(lead.page).toHaveURL(new RegExp(`/admin/leagues/rules/league_season/${ablauf.season.id}$`));
    const box = lead.page.getByTestId("rules-data-changes");
    await expect(box).toContainText("Regelwerk muss freigegeben werden");
    await expect(lead.page.getByTestId("rules-change-variable-mode:stellung.name")).toContainText(RENAMED);
    await expect(lead.page.getByTestId("rules-change-variable-mode:stellung.target")).toContainText("300");
    await expect(lead.page.getByTestId("rules-change-block-modes")).toBeVisible();
    await expect(lead.page.getByTestId("rules-proposal-document")).toContainText(`In ${RENAMED} gilt das Ziel 300 bei 4 Spielern je Map.`);
    await expect(lead.page.locator("[data-testid='rules-proposal-document'] [id='3-modi']")).toContainText("Geändert in der neuen Fassung");
    await noSideScroll(lead.page);
    await shot(lead.page, "regeln-freigabe-1440.png");
    await expect(lead.page.getByTestId("rules-approve-consent")).toBeChecked();
    await lead.page.getByTestId("rules-approve-reason").fill(`Modus umbenannt und Ziel geändert ${stamp}`);
    await lead.page.getByTestId("rules-approve-publish").click();
    await lead.page.getByTestId("confirm-dialog-confirm").click();
    await expect(lead.page.getByText("Neue Fassung freigegeben.")).toBeVisible();
    await expect(lead.page.getByTestId("rules-versions")).toContainText(`Modus umbenannt und Ziel geändert ${stamp}`);
    await expect(lead.page.getByTestId("rules-data-changes")).toHaveCount(0);
    expect(lead.problems).toEqual([]);

    for (const [width, height] of WIDTHS) {
      const guest = await as(browser, testInfo, "anon", { width, height });
      await guest.page.goto(pageUrl());
      const modi = guest.page.locator("[id='3-modi']");
      await expect(modi).toContainText(`In ${RENAMED} gilt das Ziel 300 bei 4 Spielern je Map.`);
      await expect(modi).toContainText("Punkte bis zum Ziel 300");
      await expect(modi).toContainText("Geändert in Version");
      await noSideScroll(guest.page);
      await shot(guest.page, `regeln-neue-werte-${width}.png`);
      const href = await guest.page.getByTestId("rules-pdf").getAttribute("href");
      const pdf = await guest.page.request.get(href);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      // Die alte Version bleibt, wie sie war.
      const versions = (await (await guest.page.request.get(`/api/league-rules/seasons/${ablauf.league.slug}/${ablauf.season.slug}`)).json()).versions;
      const previous = versions.find((row) => !row.is_current);
      await guest.page.goto(`${pageUrl()}?version=${previous.id}`);
      await expect(guest.page.locator("[id='3-modi']")).toContainText("In Stellung gilt das Ziel 250 bei 4 Spielern je Map.");
      expect(guest.problems).toEqual([]);
      await guest.close();
    }

    const captain = await as(browser, testInfo, "captain-0", { width: 390, height: 844 });
    await captain.page.goto("/dashboard");
    await expect(captain.page.getByText("Regeln zustimmen").first()).toBeVisible();
    await captain.page.goto(`/teams?team=${state.teams[0].team_id}`);
    const note = captain.page.getByTestId(`squad-rules-${ablauf.season.id}`);
    await expect(note).toHaveAttribute("data-consent", "open");
    await expect(note).toContainText("Neue Fassung, bitte zustimmen");
    await noSideScroll(captain.page);
    await shot(captain.page, "regeln-team-zustimmen-390.png");
    await captain.page.goto(pageUrl());
    await captain.page.getByTestId("rules-consent").getByRole("button", { name: "Zustimmen" }).first().click();
    await expect(captain.page.getByTestId("rules-consent")).toContainText("hat zugestimmt");
    await captain.page.goto(`/teams?team=${state.teams[0].team_id}`);
    await expect(captain.page.getByTestId(`squad-rules-${ablauf.season.id}`)).toHaveAttribute("data-consent", "agreed");
    expect(captain.problems).toEqual([]);
    await captain.close();

    // Den Stand für die übrigen Specs zurücksetzen: der Modus heißt wieder wie im Seed.
    await renameMode(lead.page, "Stellung");
    await lead.close();
  });
});
