const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { mockHallApi } = require("./fixtures/tvMock");

// Stationen in der Turnierleitung (#1162): aufrufen → die TV-Aufruf-Tafel zeigt es ohne Neuladen → starten → die Tafel
// räumt → freigeben (mit Rückfrage, weil das Spiel noch läuft). Zwei Seiten zugleich - die Turnierleitung am Handy bzw.
// am PC und der TV -, die API ist nachgestellt: Was die Leitung schickt, ändert den Stand für beide, der TV erfährt es
// über den Änderungsstrom. Alle Namen erfunden. LSW_SCREENS=<Ordner> legt die Bildschirmfotos zusätzlich dort ab.

const shots = process.env.LSW_SCREENS || "";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const LONG = "Aleksandra Wiśniewska-Kowalczyk 🦁 [LÖWEN-ESPORTS-AKADEMIE]";

let T;
let H;
test.beforeAll(async () => {
  T = await import("./fixtures/tvBrackets.mjs");
  H = await import("./fixtures/tvHall.mjs");
});

const entry = (match, extra = {}) => ({
  match_id: match.id, match_key: match.match_key, label: "Viertelfinale", stage_name: "Turnierbaum", names: ["NeonFalke", LONG],
  open_slots: 0, ready: true, heat: false, state: "queued", position: 1, forecast: false, delay_minutes: 0, duration_minutes: 20,
  forecast_at: new Date(Date.now() + 5 * 60000).toISOString(), planned_at: new Date(Date.now() + 5 * 60000).toISOString(), ...extra,
});

/** Was die Leitung sieht - aus demselben Stand wie der TV. */
function queueOf(world) {
  const { bracket, phase } = world;
  const a = T.find(bracket, "A");
  const b = T.find(bracket, "B");
  const c = T.find(bracket, "C");
  const pc3 = { id: H.stationId("PC 3"), name: "PC 3", station_text: "PC 3 · PC", status: "free", waiting: 1, running: null, next: entry(a), after: null };
  if (phase === "called") Object.assign(pc3, { status: "reserved", next: entry(a, { state: "called", called_at: world.calledAt, report_by: new Date(Date.parse(world.calledAt) + 2 * 60000).toISOString() }) });
  if (phase === "running") Object.assign(pc3, { status: "busy", next: null, running: entry(a, { state: "running", position: 0, started_at: world.startedAt }) });
  if (phase === "released") Object.assign(pc3, { status: "free", next: null, waiting: 0 });
  const pc4 = { id: H.stationId("PC 4"), name: "PC 4", station_text: "PC 4 · PC", status: "free", waiting: 1, running: null, next: entry(b, { names: ["TurboTina", "Frostbiss"] }), after: null };
  // Weitere bereite Spiele für „Anderes Spiel aufrufen“ (#1162) - wie `matches` der echten Antwort.
  const d = T.find(bracket, "D");
  const later = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();
  const matches = Object.fromEntries([
    pc3.next, pc4.next,
    entry(d, { names: ["Aurora Blitz", "Zackenbarsch"], forecast_at: later(25) }),
  ].filter((row) => row && row.state === "queued").map((row) => [row.match_id, row]));
  return {
    applies: true, reason: null, now: new Date().toISOString(), unplaced: [], operate: { all: true, station_ids: [] },
    summary: { delay_minutes: 0, last: { label: "Finale", forecast_at: new Date(Date.now() + 90 * 60000).toISOString() } },
    matches,
    stations: [
      pc3,
      pc4,
      { id: H.stationId("PC 5"), name: "PC 5", station_text: "PC 5 · PC", status: "busy", waiting: 0, running: entry(c, { state: "running", position: 0, started_at: world.otherStart, names: ["PixelPanther", "Kometa"] }), next: null, after: null },
      { id: H.stationId("PC 6"), name: "PC 6", station_text: "PC 6 · PC · Übertragungsplatz hinten links", status: "broken", waiting: 0, running: null, next: null, after: null },
      // Geteilte Station des Events, an der gerade ein anderes Turnier spielt (#1162).
      { id: "st-halle", name: "Halle 1", station_text: "Halle 1 · Switch 2", status: "reserved", waiting: 0, running: null, next: null, after: null, hold_issue: { kind: "other", tournament_title: "Mario Kart Abendcup" } },
    ],
  };
}

async function mockLead(page, world, tv) {
  const posts = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
    if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "example.test" }));
    if (url === "/api/tournaments/herbst-cup/lead") {
      return route.fulfill(json({ tournament: { id: "t1", slug: "herbst-cup", title: "Lions Herbst-Cup", status: "live", event_mode: "local" }, now: new Date().toISOString(), matches: [], attention: [], recent: [], stations: [], counts: { open: 0 } }));
    }
    if (url === "/api/tournaments/herbst-cup/live-queue") return route.fulfill(json(queueOf(world)));
    const action = /\/live-queue\/(call|start|release)$/.exec(url);
    if (action && request.method() === "POST") {
      posts.push([action[1], request.postDataJSON()]);
      const now = new Date().toISOString();
      if (action[1] === "call") {
        world.phase = "called";
        world.calledAt = now;
        H.call(world.bracket, "A", { station: "PC 3", calledAt: now });
      } else if (action[1] === "start") {
        world.phase = "running";
        world.startedAt = now;
        T.start(world.bracket, "A", { station: "PC 3", startedAt: now });
        delete T.find(world.bracket, "A").called_at;
      } else {
        world.phase = "released";
        const match = T.find(world.bracket, "A");
        match.station_id = null;
      }
      tv.bracket = T.clone(world.bracket);
      tv.stations = H.stationsOf([world.bracket], { names: ["PC 3", "PC 4", "PC 5", "PC 6"], broken: ["PC 6"] });
      tv.push("stations");
      return route.fulfill(json({ ok: true, idempotent_replay: false, state: action[1] === "release" ? "running" : undefined }));
    }
    return route.fulfill(json([]));
  });
  return posts;
}

async function shot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (shots) require("node:fs").writeFileSync(path.join(shots, name), body);
}

test.describe("Stationen in der Turnierleitung", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`${width} px: aufrufen → TV-Tafel → starten → freigeben`, async ({ browser }, testInfo) => {
      test.setTimeout(60_000);
      const context = await browser.newContext();
      try {
        const bracket = T.singleElimination(8, { title: "Lions Herbst-Cup" });
        T.start(bracket, "C", { station: "PC 5", startedAt: new Date(Date.now() - 12 * 60000).toISOString() });
        const world = { bracket, phase: "start", otherStart: T.find(bracket, "C").started_at };
        const tvPage = await context.newPage();
        await tvPage.setViewportSize({ width: 1920, height: 1080 });
        const tv = await mockHallApi(tvPage, { bracket: T.clone(bracket), stations: H.stationsOf([bracket], { names: ["PC 3", "PC 4", "PC 5", "PC 6"], broken: ["PC 6"] }) });
        await tvPage.goto("/display/bracket/t1?key=tv-schluessel&pixel_shift=0&playlist=calls");
        await expect(tvPage.getByTestId("bracket-tv")).toBeVisible();
        await expect(tvPage.getByTestId("tv-calls-none")).toBeVisible();
        await tvPage.evaluate(() => { window.__ohneNeuladen = true; });

        const page = await context.newPage();
        await page.setViewportSize({ width, height });
        const posts = await mockLead(page, world, tv);
        await page.goto("/tournaments/herbst-cup/leitung?reiter=stationen");
        await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
        const pc3 = H.stationId("PC 3");
        const matchA = T.find(bracket, "A").id;

        // 1. Aufrufen: reserviert, „aufgerufen um“, die Tafel zeigt es ohne Neuladen.
        await page.getByTestId(`live-call-${pc3}`).click();
        await expect(page.getByTestId(`live-chip-${pc3}`)).toHaveAttribute("data-tone", "called");
        await expect(page.getByTestId(`live-next-${pc3}`)).toContainText("Aufgerufen");
        await expect(tvPage.getByTestId(`tv-call-${matchA}`)).toBeVisible({ timeout: 8000 });
        await expect(tvPage.getByTestId(`tv-call-station-${matchA}`)).toHaveText("PC 3");
        await expect(page.getByTestId(`live-broken-${H.stationId("PC 6")}`)).toHaveText(/Bereit/);
        // Nichts läuft quer aus dem Bild, jede Tippfläche ist groß genug.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        const small = await page.evaluate(() => [...document.querySelectorAll("[data-testid='live-board'] button")]
          .filter((button) => button.getBoundingClientRect().height < 44).map((button) => button.dataset.testid || button.textContent));
        expect(small).toEqual([]);
        await page.waitForTimeout(900); // der Puls ist durch
        await shot(page, testInfo, `1162-stationen-${width}.png`);

        // 2. Starten: die Uhr läuft, die Tafel räumt den Aufruf.
        await page.getByTestId(`live-start-${pc3}`).click();
        await expect(page.getByTestId(`live-running-${pc3}`)).toBeVisible();
        await expect(page.getByTestId(`live-chip-${pc3}`)).toHaveAttribute("data-tone", "running");
        await expect(tvPage.getByTestId(`tv-call-${matchA}`)).toHaveCount(0, { timeout: 8000 });

        // 3. Freigeben: das Spiel läuft noch - erst die Rückfrage, dann ist die Station frei.
        await page.getByTestId(`live-release-${pc3}`).click();
        await expect(page.getByTestId(`live-release-confirm-${pc3}`)).toContainText("Das Spiel läuft noch");
        await page.getByTestId(`live-release-yes-${pc3}`).click();
        await expect(page.getByTestId(`live-chip-${pc3}`)).toHaveAttribute("data-tone", "free");
        expect(posts.map(([kind]) => kind)).toEqual(["call", "start", "release"]);
        expect(posts.every(([, body]) => body.station_id === pc3 && body.match_id === matchA)).toBe(true);
        expect(await tvPage.evaluate(() => window.__ohneNeuladen)).toBe(true);

        // 4. Anderes Spiel aufrufen: alle bereiten Spiele, „Als Nächstes“ oben, dann nach Prognose.
        const pc4 = H.stationId("PC 4");
        await page.getByTestId(`live-pick-${pc4}`).click();
        const picker = page.getByTestId(`live-pick-list-${pc4}`);
        await expect(picker.locator("button").first()).toContainText("Als Nächstes");
        await expect(picker.locator("button")).toHaveCount(2);
        if (width === 390) {
          await page.waitForTimeout(400);
          await picker.scrollIntoViewIfNeeded();
          const body = await page.screenshot();
          await testInfo.attach("1162-anderes-spiel-390.png", { body, contentType: "image/png" });
          if (shots) require("node:fs").writeFileSync(path.join(shots, "1162-anderes-spiel-390.png"), body);
        }
      } finally {
        await context.close();
      }
    });
  }

  // Schmales Handy und zwischen Handy und PC (Review N7, #1162): kein Knopftext läuft über seinen Knopf.
  for (const width of [320, 768, 820, 900, 1000]) {
    test(`${width} px: Knopftexte passen in ihre Knöpfe`, async ({ page }) => {
      const bracket = T.singleElimination(8, { title: "Lions Herbst-Cup" });
      T.start(bracket, "C", { station: "PC 5", startedAt: new Date(Date.now() - 12 * 60000).toISOString() });
      const world = { bracket, phase: "called", calledAt: new Date().toISOString(), otherStart: T.find(bracket, "C").started_at };
      await page.setViewportSize({ width, height: 1000 });
      await mockLead(page, world, { push() {} });
      await page.goto("/tournaments/herbst-cup/leitung?reiter=stationen");
      await expect(page.getByTestId("live-board")).toBeVisible();
      const overflowing = await page.evaluate(() => [...document.querySelectorAll("[data-testid='live-board'] button")]
        .filter((button) => button.scrollWidth > button.clientWidth + 1 || button.getBoundingClientRect().height < 44)
        .map((button) => `${button.dataset.testid || ""}: ${button.textContent}`));
      expect(overflowing).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }
});
