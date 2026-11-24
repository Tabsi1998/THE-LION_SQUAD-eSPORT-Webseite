const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Playoffs und Relegation (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“) im echten Browser, Server nachgestellt: im Reiter
// „Abschluss“ die Sperrgründe, die Vorschau der Setzung mit Paarungen und Wochen, Anlegen mit Bestätigung, der Stand der angelegten
// Staffeln und die Einstellungen (ab dem Season-Start mit ausgegrauten Feldern, Nr. 249), der Hinweis „zu wenige Teams“ - und auf der
// Ligaseite der Baum der Playoffs (ohne „Winner Bracket“, Nr. 248), die Paarungen der Relegation als Karten und das Kennzeichen
// „Playoff-Platz“ in der Tabelle. Bei 390 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab
// (playoffs-…). Die Antworten kommen aus dem echten Server (e2e/fixtures/league-postseason.json), nur erfundene Namen.
const DATA = require("./fixtures/league-postseason.json");

const { ids } = DATA;
const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 86400000 }));
};
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const LIGA = `/liga/${ids.league_slug}/${ids.season_slug}`;
const ABSCHLUSS = `/admin/leagues/seasons/${ids.season}#abschluss`;

async function mockServer(page, { admin = false, cockpit = DATA.cockpit_ready, closing = DATA.closing_ready } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (admin) await page.route("**/api/auth/me", json(ADMIN));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues", json(DATA.leagues));
  await page.route(`**/api/leagues/${ids.league_slug}/${ids.season_slug}`, json(DATA.public_season));
  await page.route(`**/api/leagues/${ids.league_slug}/${ids.season_slug}/staffeln/**`, json(DATA.public_staffel));
  await page.route(`**/api/tournaments/${ids.playoff}/bracket`, json(DATA.bracket_playoff));
  await page.route(`**/api/tournaments/${ids.relegation}/bracket`, json(DATA.bracket_relegation));
  await page.route(`**/api/admin/leagues/seasons/${ids.season}`, json(DATA.season_admin));
  await page.route(`**/api/admin/leagues/seasons/${ids.season}/closing`, json(closing));
  await page.route(`**/api/admin/leagues/seasons/${ids.season}/postseason`, json(cockpit));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(target, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  // Hohe Ausschnitte: Was am Fenster klebt (Kopfleiste am Handy, Sprungmarke, untere Leiste), stünde sonst mitten im Bild.
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled",
    style: ".tls-bottom-nav, .tls-skip-link { display: none !important; } .sticky { position: static !important; }" });
}

test.describe("Liga: Playoffs und Relegation", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Sperrgründe bei ${width} px: solange eine reguläre Staffel offen ist, gibt es keine Setzliste`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { admin: true, cockpit: DATA.cockpit_waiting });
      await page.goto(ABSCHLUSS);
      const panel = page.getByTestId("season-postseason");
      await expect(panel.getByTestId(`postseason-playoffs-state-${ids.division_1}`)).toHaveText("Wartet");
      await expect(panel.getByTestId(`postseason-playoffs-blockers-${ids.division_1}`)).toContainText("Erst alle regulären Staffeln von Liga 1 abschließen (1 von 2 abgeschlossen).");
      await expect(panel.getByTestId(`postseason-create-playoffs-${ids.division_1}`)).toBeDisabled();
      await expect(panel.getByTestId("postseason-missing")).toContainText("Die Playoffs von Liga 1 sind noch nicht angelegt.");
      await expect(panel.getByTestId(`postseason-seeds-${ids.division_1}`)).toHaveCount(0);
      await noSideScroll(page);
      await shot(panel, `playoffs-sperrgruende-${width}`);
    });

    test(`Vorschau und Anlegen bei ${width} px: Setzliste, Paarungen, Wochen, Relegation`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { admin: true });
      const sent = {};
      await page.route(`**/api/admin/leagues/seasons/${ids.season}/postseason/playoffs`, (route) => {
        sent.playoffs = route.request().postDataJSON();
        return json({ ok: true, replay: false, tournament: { tournament_id: ids.playoff } })(route);
      });
      await page.goto(ABSCHLUSS);
      await expect(page.getByTestId("season-tab-abschluss")).toHaveAttribute("aria-selected", "true");
      const panel = page.getByTestId("season-postseason");
      await expect(panel.getByTestId("postseason-summary")).toContainText("Meister aus den Playoffs");
      const division = panel.getByTestId(`postseason-division-${ids.division_1}`);
      await expect(division.getByTestId(`postseason-playoffs-state-${ids.division_1}`)).toHaveText("Bereit zum Anlegen");
      await expect(division.getByTestId(`postseason-playoffs-line-${ids.division_1}`)).toContainText("4 je Staffel · Best of 3 · Runde 3: Best of 5");
      const seeds = division.getByTestId(`postseason-seeds-${ids.division_1}`).getByRole("listitem");
      await expect(seeds).toHaveCount(8);
      await expect(seeds.first()).toContainText("Nordlicht · Nordlicht A");
      await expect(seeds.first()).toContainText("Staffel A · Platz 1");
      // Die beiden Staffelsieger stehen gleich: gelost wird erst beim Anlegen, die Vorschau sagt es.
      await expect(division.getByTestId(`postseason-lot-${ids.division_1}`)).toContainText("wird beim Anlegen gelost");
      // Die erste Runde als Karten: je Paarung beide Seiten mit Setzplatz, für Screenreader ein Satz.
      const pairings = division.getByTestId(`postseason-pairings-${ids.division_1}`);
      await expect(pairings.getByRole("listitem")).toHaveCount(4);
      await expect(pairings.getByRole("listitem").first()).toHaveAttribute("aria-label", /^1 .+ – 8 .+$/);
      await shot(pairings, `playoffs-paarungen-${width}`);
      await expect(division.getByTestId(`postseason-rounds-${ids.division_1}`)).toContainText("Finale · Best of 5");
      const relegation = division.getByTestId(`postseason-relegation-${ids.division_1}`);
      await expect(relegation).toContainText("Relegation gegen Liga 2");
      await expect(relegation.getByTestId(`postseason-pairs-${ids.division_1}`).getByRole("listitem")).toHaveCount(2);
      await expect(relegation.getByTestId(`postseason-pairs-${ids.division_1}`)).toContainText("Heim");
      // Liga 2 folgt der Season nicht: dort gibt es keine Playoffs, und nach unten keine Relegation.
      await expect(panel.getByTestId(`postseason-none-${ids.division_2}`)).toBeVisible();
      await noSideScroll(page);
      await shot(panel, `playoffs-vorschau-${width}`);

      await division.getByTestId(`postseason-create-playoffs-${ids.division_1}`).click();
      const sheet = page.getByTestId("postseason-create-sheet");
      await expect(sheet).toContainText("eigene K.-o.-Staffel mit 8 Teams");
      await expect(sheet.getByTestId("postseason-create-lot")).toContainText("Das Los fällt einmal");
      await noSideScroll(page);
      await shot(sheet, `playoffs-anlegen-${width}`);
      expect(sent.playoffs).toBeUndefined();
      await sheet.getByTestId("postseason-create-confirm").click();
      await expect.poll(() => sent.playoffs).toEqual({ division_id: ids.division_1, stamp: DATA.cockpit_ready.divisions[0].playoffs.stamp, confirm: true });
    });

    test(`Stand bei ${width} px: angelegte Playoffs und Relegation, die Playoff-Staffel im Abschluss`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { admin: true, cockpit: DATA.cockpit_running, closing: DATA.closing_running });
      await page.goto(ABSCHLUSS);
      const panel = page.getByTestId("season-postseason");
      const division = panel.getByTestId(`postseason-division-${ids.division_1}`);
      await expect(division.getByTestId(`postseason-playoffs-state-${ids.division_1}`)).toHaveText("Angelegt");
      await expect(division.getByTestId(`postseason-staffel-${ids.playoff}`)).toContainText("6 von 7 Spielen entschieden");
      await expect(division.getByRole("link", { name: "Baum ansehen" })).toHaveAttribute("href", `/tournaments/${ids.playoff_slug}/bracket`);
      await expect(division.getByTestId(`postseason-relegation-state-${ids.division_1}`)).toHaveText("Angelegt");
      await expect(panel.getByTestId("postseason-complete")).toBeVisible();
      await expect(division.getByTestId(`postseason-create-playoffs-${ids.division_1}`)).toHaveCount(0);
      await noSideScroll(page);
      await shot(panel, `playoffs-stand-${width}`);
      // Im Abschluss steht die Playoff-Staffel mit Plätzen aus dem Baum - sie heißt „Playoffs“, nie „Staffel PO“.
      const card = page.getByTestId(`close-staffel-${ids.playoff}`);
      await expect(card.getByRole("heading", { name: "Liga 1 · Playoffs" })).toBeVisible();
      await expect(card.getByTestId(`close-placements-${ids.playoff}`).getByRole("listitem")).toHaveCount(8);
      await expect(card.getByTestId(`close-blocker-${ids.playoff}-open_matches`)).toContainText("Finale");
      await expect(page.getByText("Staffel PO")).toHaveCount(0);
      await noSideScroll(page);
      await shot(card, `playoffs-abschluss-${width}`);
    });

    test(`Einstellungen bei ${width} px: speichern schickt die Vorlage der Season`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { admin: true });
      const sent = {};
      await page.route(`**/api/admin/leagues/seasons/${ids.season}/postseason`, (route) => {
        if (route.request().method() !== "PUT") return json(DATA.cockpit_ready)(route);
        sent.body = route.request().postDataJSON();
        return json({ ok: true, settings: sent.body })(route);
      });
      await page.goto(ABSCHLUSS);
      await page.getByTestId("postseason-settings").click();
      const sheet = page.getByTestId("postseason-settings-sheet");
      await expect(sheet.getByTestId("postseason-playoffs-enabled")).toBeChecked();
      await expect(sheet.getByTestId("postseason-per-staffel")).toHaveValue("4");
      await expect(sheet.getByTestId("postseason-champion-source")).toHaveValue("playoffs");
      // In Liga 1 ist schon abgeschlossen: an/aus und die Plätze stehen fest - das Fenster sagt es.
      await expect(sheet.getByTestId("postseason-settings-locked")).toContainText("bis zum Season-Start ändern, Termine bis zum Anlegen");
      await noSideScroll(page);
      await shot(sheet, `playoffs-einstellungen-${width}`);
      await sheet.getByTestId("postseason-third-place").check();
      await sheet.getByTestId("postseason-settings-save").click();
      await expect.poll(() => sent.body?.playoffs).toEqual({ enabled: true, per_staffel: 4, best_of: 3, third_place: true, home: "better_seed", start_date: null,
        best_of_rounds: [{ round: 3, best_of: 5 }] });
      expect(sent.body.champion_source).toBe("playoffs");
    });

    test(`Ab dem Season-Start bei ${width} px: Best of, Platz 3 und Heimrecht sind ausgegraut, mit Hinweis`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      // Dieselbe Antwort des Servers, nur nach dem Beginn der ersten Spielwoche (`started`).
      await mockServer(page, { admin: true, cockpit: { ...DATA.cockpit_ready, started: true } });
      await page.goto(ABSCHLUSS);
      await page.getByTestId("postseason-settings").click();
      const sheet = page.getByTestId("postseason-settings-sheet");
      await expect(sheet.getByTestId("postseason-start-locked")).toContainText("Seit dem Season-Start stehen Best of, Spiel um Platz 3 und Heimrecht fest");
      for (const id of ["postseason-best-of", "postseason-home", "postseason-third-place", "postseason-round-0", "postseason-round-best-of-0"]) {
        await expect(sheet.getByTestId(id)).toBeDisabled();
      }
      await expect(sheet.getByTestId("postseason-round-add")).toHaveCount(0);
      // Der Start der Playoffs und die Relegation gehören nicht dazu.
      await expect(sheet.getByTestId("postseason-start")).toBeEnabled();
      await noSideScroll(page);
      await shot(sheet, `playoffs-gesperrt-${width}`);
    });

    test(`Zu wenige Teams bei ${width} px: der Hinweis steht an der Liga und nach dem Speichern`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const few = DATA.cockpit_too_few;
      const id = few.divisions[0].division_id;
      const hint = few.divisions[0].playoffs.too_few_hint;
      await mockServer(page, { admin: true, cockpit: few });
      await page.route(`**/api/admin/leagues/seasons/${ids.season}/postseason`, (route) => {
        if (route.request().method() !== "PUT") return json(few)(route);
        return json({ ok: true, settings: route.request().postDataJSON(), warnings: [hint] })(route);
      });
      await page.goto(ABSCHLUSS);
      const panel = page.getByTestId("season-postseason");
      await expect(panel.getByTestId(`postseason-too-few-${id}`)).toHaveText(hint);
      await expect(panel.getByTestId(`postseason-too-few-${id}`)).toContainText("weniger als zwei Teams");
      // Diese Liga spielt keine Playoffs: nichts anzulegen, nichts, worauf zu warten wäre.
      await expect(panel.getByTestId(`postseason-playoffs-state-${id}`)).toHaveText("Keine Playoffs");
      await expect(panel.getByTestId(`postseason-create-playoffs-${id}`)).toHaveCount(0);
      // Die Season wartet nicht auf diese Playoffs.
      await expect(panel.getByTestId("postseason-missing")).toHaveCount(0);
      await noSideScroll(page);
      await shot(panel.getByTestId(`postseason-division-${id}`), `playoffs-zu-wenige-${width}`);
      await page.getByTestId("postseason-settings").click();
      await page.getByTestId("postseason-settings-sheet").getByTestId("postseason-settings-save").click();
      await expect(page.getByText(`Einstellungen gespeichert. ${hint}`)).toBeVisible();
    });

    test(`Ligaseite bei ${width} px: Baum der Playoffs, Paarungen der Relegation, Playoff-Plätze in der Tabelle`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto(LIGA);
      const division = page.getByTestId("league-division-1");
      // Die Tabellen bleiben die Staffeln A und B - Playoffs und Relegation stehen darunter, als eigene Abschnitte.
      await expect(division.getByTestId("league-staffel-tab-A")).toBeVisible();
      await expect(division.getByTestId("league-staffel-tab-PO")).toHaveCount(0);
      const table = division.locator(".tls-league-table").first();
      await expect(table.locator(".tls-playoff-mark")).toHaveCount(5);
      await expect(division.getByTestId("zone-legend-playoff").first()).toHaveText("Playoff-Platz");
      const playoffs = division.getByTestId(`league-postseason-playoff-${ids.playoff}`);
      await expect(playoffs.getByRole("heading", { name: "Playoffs" })).toBeVisible();
      // Am Handy blättert der Baum Runde für Runde, am Desktop steht er als Leinwand - beides trägt den Abschnitt.
      await expect(playoffs.locator("[data-testid^='bracket-section-']").first()).toBeVisible();
      await expect(playoffs).toContainText("Nordlicht · Nordlicht A");
      // Nr. 248: Der Baum heißt „Playoffs“ - der Abschnittstitel des Turnierbaums steht hier nirgends.
      await expect(division.getByText(/Winner Bracket/i)).toHaveCount(0);
      await expect(playoffs.getByTestId(`league-postseason-link-${ids.playoff}`)).toHaveAttribute("href", `/tournaments/${ids.playoff_slug}/bracket`);
      const relegation = division.getByTestId(`league-postseason-relegation-${ids.relegation}`);
      await expect(relegation.getByRole("heading", { name: "Relegation" })).toBeVisible();
      // Die Relegation lesbar: je Paarung das Team der oberen (Heim) und das der unteren Liga, ohne Baum und ohne Setzplätze.
      await expect(relegation.locator("[data-testid^='bracket-section-']")).toHaveCount(0);
      await expect(relegation.getByText(/^REL$/)).toHaveCount(0);
      const pairs = relegation.getByTestId(`league-relegation-pairs-${ids.relegation}`).getByRole("listitem");
      await expect(pairs).toHaveCount(2);
      const [played, open] = DATA.public_season.divisions[0].postseason[1].pairs;
      await expect(pairs.first()).toContainText("Liga 1 · Heim");
      await expect(pairs.first()).toContainText(played.upper.display_name);
      await expect(pairs.first()).toContainText("Liga 2");
      await expect(pairs.first()).toContainText(`${played.lower.display_name} steigt auf, ${played.upper.display_name} steigt ab.`);
      await expect(pairs.first().getByRole("link")).toHaveAttribute("href", `/matches/${played.match_id}`);
      await expect(pairs.nth(1)).toContainText(open.lower.display_name);
      await expect(pairs.nth(1)).toContainText("Noch nicht gespielt");
      await noSideScroll(page);
      await shot(table, `playoffs-tabelle-${width}`);
      await shot(playoffs, `playoffs-ligaseite-${width}`);
      await shot(relegation, `playoffs-relegation-${width}`);
    });
  }

  test("ohne Playoffs zeigt die Ligaseite keinen Abschnitt und die Tabelle kein Kennzeichen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const season = JSON.parse(JSON.stringify(DATA.public_season));
    for (const division of season.divisions) delete division.postseason;
    const staffel = JSON.parse(JSON.stringify(DATA.public_staffel));
    for (const row of staffel.standings) delete row.playoff;
    await mockServer(page);
    await page.route(`**/api/leagues/${ids.league_slug}/${ids.season_slug}`, json(season));
    await page.route(`**/api/leagues/${ids.league_slug}/${ids.season_slug}/staffeln/**`, json(staffel));
    await page.goto(LIGA);
    const division = page.getByTestId("league-division-1");
    await expect(division.locator(".tls-league-table").first()).toBeVisible();
    await expect(page.locator("[data-testid^='league-postseason-']")).toHaveCount(0);
    await expect(page.locator(".tls-playoff-mark")).toHaveCount(0);
  });
});
