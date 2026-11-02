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
const ignoreGuest = (response) => response.url().includes("/api/auth/");

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
    await lead.page.getByTestId("rules-new-draft").click();
    await lead.page.getByTestId("rules-title").fill("Regelwerk Probelauf");
    await writeMarkdown(lead.page, "rules-body", `# § 1 Fairplay\n${FIRST}\n\n# § 2 Maps`);
    await lead.page.getByTestId("rules-block-map_pool").click();
    await lead.page.getByTestId("rules-annex-add").click();
    await lead.page.getByTestId("rules-annex-title-0").fill("Strafen");
    await writeMarkdown(lead.page, "rules-annex-body-0", "Verwarnung, dann Punktabzug.");
    await lead.page.getByTestId("rules-preview").click();
    await expect(lead.page.getByTestId("rules-preview-document")).toContainText("Modus");
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
});
