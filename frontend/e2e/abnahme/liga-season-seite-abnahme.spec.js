const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { ENABLED, STATE_FILE, state, signIn, watch } = require("./abnahmeSession");

// Season-Seite (#2268) als Gast gegen den echten Server - ohne nachgestellte API. Stand aus `scripts/seed_abnahme_liga.py --schaufenster`:
// „Alpenliga“, Season 1 mit Modus-Symbolen und Ergebnisregeln, Map-Pool mit Bildern, Sperrliste mit Bildern, Regelwerk, Liga 1 und
// Liga 2 mit je einer gestarteten Staffel, Spieltag 1 und 2 mit Ergebnissen (Maps, kampflos, wiederholte Map, „in Klärung“) und
// Logos. Dazu die Season der Selbstanmeldung (nur eine Staffel im Entwurf): für Gäste der Platzhalter vor der Einteilung.
// Bei 390 und 1440 px ohne seitliches Scrollen und ohne Konsolenfehler; die TV-Ansicht einer Staffel lädt.

const SHOTS = process.env.ABNAHME_SHOTS || "";
const WIDTHS = [[390, 844], [1440, 900]];
const show = state?.schaufenster;
const seasonUrl = (section = "") => `/liga/${show.league.slug}/${show.season.slug}${section ? `/${section}` : ""}`;

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Die feste Leiste unten (Handy) stünde im ganzen Bild mitten auf der Seite - das Fenster wird so hoch wie die Seite.
  const size = page.viewportSize();
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: full });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  await page.setViewportSize(size);
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Bilder fertig laden lassen - der Screenshot soll zeigen, was ein Gast sieht. */
async function settle(page) {
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = "eager";
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((done) => { img.onload = done; img.onerror = done; }))));
  });
  // Durchscrollen: gestaffelte Teile erscheinen erst, wenn sie sichtbar werden - wie beim Lesen.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
}

async function guest(browser, testInfo, viewport) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, locale: "de-AT", timezoneId: "Europe/Vienna" });
  const page = await context.newPage();
  await signIn(page, "anon");
  return { page, problems: watch(page), close: () => context.close() };
}

test.describe("Abnahme: Season-Seite als Gast gegen den echten Server", () => {
  test.skip(!ENABLED, "nur für die lokale Abnahme (ABNAHME=1, siehe docs/entwicklung/abnahme-lokal.md)");
  test.skip(ENABLED && !show, `Kein Schaufenster in ${STATE_FILE} - erst scripts/seed_abnahme_liga.py --schaufenster laufen lassen`);
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.skip(({ isMobile }) => Boolean(isMobile), "Größe stellt der Test selbst ein");

  for (const [width, height] of WIDTHS) {
    test(`Übersicht, Spieltage und Teams (${width} px)`, async ({ browser }, testInfo) => {
      const { page, problems, close } = await guest(browser, testInfo, { width, height });
      await page.goto(seasonUrl());
      await expect(page.getByTestId("league-head-banner")).toBeVisible();
      const play = page.getByTestId("season-play");
      await expect(play.getByTestId("season-mode-stellung-rule")).toContainText("bis 250 Punkte");
      await expect(play.getByTestId("season-mode-suchen-rule")).toContainText("6 Runden, höchstens 11");
      await expect(play.getByTestId("season-mode-stellung").locator("[data-icon='image']")).toBeVisible();
      await expect(play.getByTestId("season-map-order").getByRole("listitem")).toHaveCount(3);
      await expect(page.getByTestId("league-map-pool").locator("img").first()).toBeVisible();
      await expect(page.getByTestId("season-bans-toggle")).toContainText("2 Sperren");
      await expect(page.getByTestId("season-flow-home")).toContainText("72 Stunden");
      await expect(page.getByTestId("league-rules-version")).toContainText("Version 1");
      await expect(page.getByTestId("league-division-1").getByTestId("league-staffel-A")).toBeVisible();
      await expect(page.getByTestId("league-division-2").getByTestId("league-staffel-A")).toBeVisible();
      await expect(page.getByTestId("league-division-1").locator(".tls-standing-row").first()).toBeVisible();
      await noSideScroll(page);
      await settle(page);
      await shot(page, `2268-uebersicht-${width}.png`);

      await page.getByTestId("season-bans-toggle").click();
      await expect(page.getByTestId("league-loadout-bans")).toContainText("Donnerbüchse");
      await expect(page.getByTestId("league-loadout-bans").locator("img").first()).toBeVisible();

      await page.getByTestId("league-division-1").getByTestId("league-plan-link-A").click();
      await expect(page).toHaveURL(/\/spieltage\?staffel=/);
      await expect(page.getByTestId("season-nav-spieltage")).toHaveAttribute("aria-current", "page");
      const plan = page.getByTestId("league-plan-A");
      await plan.getByTestId("league-week-1").getByRole("button").click();
      const week = page.getByTestId("league-weekpanel-1");
      await expect(week.locator("[data-done='true']")).toHaveCount(2);
      await expect(week).toContainText("kampflos");
      await expect(week.locator("[data-testid$='-replayed']")).toHaveCount(1);
      await expect(week.locator(".tls-league-map").first()).toBeVisible();
      await expect(week.locator(".tls-league-map img").first()).toBeVisible();
      await noSideScroll(page);
      await settle(page);
      await shot(page, `2268-spieltage-${width}.png`);

      // Liga 2: das angefochtene Ergebnis steht als „in Klärung“.
      await page.getByTestId("season-staffel-picker").getByRole("button").nth(1).click();
      await page.getByTestId("league-plan-A").getByTestId("league-week-1").getByRole("button").click();
      await expect(page.getByTestId("league-weekpanel-1").locator("[data-testid$='-contested']")).toHaveCount(1);

      await page.getByTestId("season-nav-teams").click();
      await expect(page.locator("[data-testid^='season-team-']")).toHaveCount(8);
      await expect(page.locator(".tls-season-team img").first()).toBeVisible();
      await noSideScroll(page);

      await page.getByTestId("season-nav-regeln").click();
      await expect(page.getByTestId("rules-document")).toBeVisible();
      await expect(page.getByTestId("season-nav-regeln")).toHaveAttribute("aria-current", "page");
      expect(problems).toEqual([]);
      await close();
    });
  }

  test("Vor der Einteilung (390 px): Platzhalter mit den nächsten Schritten", async ({ browser }, testInfo) => {
    const anmeldung = state.anmeldung;
    const { page, problems, close } = await guest(browser, testInfo, { width: 390, height: 844 });
    await page.goto(`/liga/${anmeldung.league.slug}/${anmeldung.season.slug}`);
    const placeholder = page.getByTestId("league-no-divisions");
    await expect(placeholder).toContainText("Die Ligen werden eingeteilt");
    await expect(placeholder.getByTestId("season-step-split")).toBeVisible();
    await expect(page.getByTestId("season-play")).toBeVisible();
    await noSideScroll(page);
    await settle(page);
    await shot(page, "2268-vor-einteilung-390.png");
    expect(problems).toEqual([]);
    await close();
  });

  test("TV-Ansicht einer Staffel lädt für die Turnierleitung (1440 px)", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 }, locale: "de-AT", timezoneId: "Europe/Vienna" });
    const page = await context.newPage();
    await signIn(page, "lead");
    const problems = watch(page);
    await page.goto(`/display/bracket/${show.staffeln[0]}`);
    await expect(page).toHaveURL(/\/display\/bracket\//);
    await expect(page.locator("body")).not.toContainText("nicht gefunden");
    await expect(page.locator("body")).toContainText("Nebelwölfe");
    await page.waitForTimeout(1500);
    if (process.env.ABNAHME_CHECK_SHOTS) await page.screenshot({ path: path.join(process.env.ABNAHME_CHECK_SHOTS, "tv.png") });
    expect(problems).toEqual([]);
    await context.close();
  });
});
