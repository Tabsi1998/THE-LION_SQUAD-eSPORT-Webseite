const path = require("node:path");
const { test, expect } = require("@playwright/test");
const fixture = require("./fixtures/liveQueueGenerated.json");
const { mockTvApi } = require("./fixtures/tvMock");

// Spielzeit-Uhr (#1167): Turnierleitung (Stationen und Liste „läuft“) und TV zeigen dieselbe Zeit - nach der Serverzeit,
// auch wenn die Uhr des Geräts danebenliegt (hier: Handy 7 Minuten nach, TV 3 Minuten vor). Feste Uhr über page.clock;
// die Daten der Warteschlange kommen aus den echten Routen (scripts/make_live_queue_fixture.py). Namen sind erfunden.
// LSW_SCREENS=<Ordner> legt die Bildschirmfotos zusätzlich dort ab.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SLUG = fixture.tournament.slug;
const SERVER_NOW = Date.parse(fixture.now);
const MINUTE = 60 * 1000;
const shots = process.env.LSW_SCREENS || "";
const queue = fixture.states.live;
const running = queue.stations.find((station) => station.running);
// Laut Server läuft das Spiel genau so lange (ganze Sekunden).
const elapsed = Math.floor((SERVER_NOW - Date.parse(running.running.started_at)) / 1000);
// „25:00“ bzw. „1:05:12“ in Sekunden.
const secondsOf = (text) => String(text || "").trim().split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
// Die Uhr zeigt die Serverzeit seit der Antwort: höchstens ein paar Sekunden mehr als beim Stand der Daten - nie die
// Minuten, um die die Geräteuhr danebenliegt.
const nearServer = async (locator) => {
  const shown = secondsOf(await locator.textContent());
  return shown >= elapsed && shown <= elapsed + 20;
};

async function shot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (shots) require("node:fs").writeFileSync(path.join(shots, name), body);
}

function participants(a, b) {
  return [{ registration_id: `${a}-r`, name: a }, { registration_id: `${b}-r`, name: b }];
}

/** Liste „läuft“: ruhig (50 %), knapp (80 %), überschritten mit fehlendem Ergebnis, ohne Dauer - Startzeiten nach dem Server. */
function leadView() {
  const startedAgo = (minutes) => new Date(SERVER_NOW - minutes * MINUTE).toISOString();
  const row = (id, label, names, extra) => ({
    id, label, kind: "duel", status: "in_progress", participants: names, station_text: extra.station, can_enter: true,
    has_result: false, result: [], advance: {}, best_of: 1, ranking_mode: "higher_score", allows_draw: false, ...extra,
  });
  return {
    tournament: { ...fixture.tournament, status: "live" }, now: fixture.now, attention: [], recent: [], stations: [], draws: [],
    counts: { open: 4, running: 4, missing: 1 },
    matches: [
      row("m-late", "Viertelfinale 1", participants("NeonFalke", "PixelPanther"), { station: "PC 1", started_at: startedAgo(33), timing: { running_minutes: 33, overdue_minutes: 13, missing: true, duration_minutes: 20 } }),
      row("m-warn", "Viertelfinale 2", participants("TurboTina", "Frostbiss"), { station: "PC 2", started_at: startedAgo(16.5), timing: { running_minutes: 16, overdue_minutes: null, missing: false, duration_minutes: 20 } }),
      row("m-run", "Viertelfinale 3", participants("Aleksandra Wiśniewska-Kowalczyk", "Mo"), { station: "PC 4", started_at: startedAgo(10), timing: { running_minutes: 10, overdue_minutes: null, missing: false, duration_minutes: 20 } }),
      row("m-free", "Showmatch", participants("Kranich", "Zander"), { station: "Switch 1", started_at: startedAgo(72.2), timing: { running_minutes: 72, overdue_minutes: null, missing: false, duration_minutes: null } }),
    ],
  };
}

test.describe("Spielzeit-Uhr", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("Turnierleitung 390 px: Handy geht 7 Minuten nach - Stationen und Liste zählen nach dem Server", async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date(SERVER_NOW - 7 * MINUTE) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url()).pathname;
      if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
      if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (url === "/api/seasonal/active") return route.fulfill(json({ seasons: [], now: fixture.now }));
      if (url === `/api/tournaments/${SLUG}/lead`) return route.fulfill(json(leadView()));
      if (url === `/api/tournaments/${SLUG}/live-queue`) return route.fulfill(json(queue));
      return route.fulfill(json([]));
    });
    await page.goto(`/tournaments/${SLUG}/leitung`);

    // Stationen: dieselbe Sekunde wie der Server, nicht 7 Minuten weniger.
    await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
    const tile = page.getByTestId(`live-clock-${running.running.match_id}`);
    const tileTime = page.getByTestId(`live-clock-${running.running.match_id}-time`);
    await expect.poll(() => nearServer(tileTime)).toBe(true);
    await expect(tile).toHaveAttribute("data-tone", "warn");
    await expect(tile).toHaveAttribute("aria-label", /, knapp$/);

    // Liste „läuft“ (Reiter Ergebnisse, Filter „Läuft“): jede Uhr mit ihrer Farbe.
    await page.getByTestId("lead-tab-results").click();
    await page.getByTestId("lead-filter-running").click();
    await expect(page.getByTestId("lead-clock-m-run")).toHaveAttribute("data-tone", "run");
    await expect(page.getByTestId("lead-clock-m-warn")).toHaveAttribute("data-tone", "warn");
    await expect(page.getByTestId("lead-clock-m-late")).toHaveAttribute("data-tone", "over");
    await expect(page.getByTestId("lead-clock-m-late")).toHaveAttribute("aria-label", /Zeit überschritten$/);
    await expect(page.getByTestId("lead-line-m-late")).toContainText("Ergebnis fehlt");
    await expect(page.getByTestId("lead-clock-m-free")).toHaveAttribute("data-tone", "none");
    await expect(page.getByTestId("lead-clock-m-free-time")).toHaveText(/^1:12:1\d$/);
    await expect(page.getByTestId("lead-clock-m-run-time")).toHaveText(/^10:0\d$/);
    // Tickt ohne Neuladen.
    const before = await page.getByTestId("lead-clock-m-run-time").textContent();
    await page.clock.runFor(2000);
    await expect(page.getByTestId("lead-clock-m-run-time")).not.toHaveText(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.waitForTimeout(900); // das Aufleuchten beim Farbwechsel ist durch
    await shot(page, testInfo, "1167-uhr-390.png");
  });

  test("TV 1440 px: TV-Uhr geht 3 Minuten vor - die Warteschlange zeigt dieselbe Zeit wie die Leitung", async ({ page }, testInfo) => {
    const T = await import("./fixtures/tvBrackets.mjs");
    await page.clock.install({ time: new Date(SERVER_NOW + 3 * MINUTE) });
    await page.setViewportSize({ width: 1440, height: 900 });
    const bracket = T.singleElimination(8);
    await mockTvApi(page, { bracket });
    await page.route("**/api/seasonal/active**", (route) => route.fulfill(json({ seasons: [], now: fixture.now })));
    // Station 2 hat ein Spiel, das schon über der Zeit ist: orange gefüllt mit Warn-Symbol.
    const tvQueue = {
      ...queue,
      stations: queue.stations.map((station) => (station.id !== "st2" ? station : {
        ...station, status: "busy",
        running: { ...running.running, match_id: "over-1", started_at: new Date(SERVER_NOW - 41 * MINUTE).toISOString() },
      })),
    };
    await page.route(/\/api\/tournaments\/t1\/live-queue(\?.*)?$/, (route) => route.fulfill(json(tvQueue)));
    await page.goto("/display/bracket/t1?key=tv-schluessel&pixel_shift=0&playlist=calls");

    await expect(page.getByTestId("tv-queue-board")).toBeVisible();
    const clock = page.getByTestId(`tv-queue-clock-${running.id}`);
    const time = clock.locator(".tv-lanes__time");
    await expect.poll(() => nearServer(time)).toBe(true);
    await expect(clock).toHaveAttribute("data-tone", "warn");
    await expect(clock).toContainText("/ 30 Min.");
    await expect(clock).toHaveAttribute("aria-label", /, knapp$/);
    const over = page.getByTestId("tv-queue-clock-st2");
    await expect(over).toHaveAttribute("data-tone", "over");
    await expect(page.getByTestId("tv-queue-clock-st2-warn")).toBeVisible();
    await expect(over).toContainText("+11 Min.");
    // Orange gefüllt, nicht rot (Fabians Auswahl 07.10.).
    const fill = await over.locator(".tv-lanes__time").evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(fill).toBe("rgb(255, 159, 67)");
    await page.waitForTimeout(900);
    await shot(page, testInfo, "1167-uhr-tv-1440.png");
  });

  test("Turnierpause 390 px: die Uhr steht mit „Pause“ - nach dem Weiterspielen läuft sie ohne die Pause weiter", async ({ page }) => {
    await page.clock.install({ time: new Date(SERVER_NOW) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    });
    // Gestartet vor 20 Minuten, seit 5 Minuten Pause: die Uhr steht bei 15:00.
    const startedAt = new Date(SERVER_NOW - 20 * MINUTE).toISOString();
    const pausedAt = new Date(SERVER_NOW - 5 * MINUTE).toISOString();
    let resumed = false;
    const view = () => {
      const base = leadView();
      const item = {
        ...base.matches[2], id: "m-pause", started_at: startedAt,
        paused_at: resumed ? null : pausedAt, paused_seconds: resumed ? 300 : 0,
        timing: { running_minutes: 15, overdue_minutes: null, missing: false, duration_minutes: 30 },
      };
      return { ...base, tournament: { ...base.tournament, status: resumed ? "live" : "paused", paused_at: resumed ? null : pausedAt }, matches: [item] };
    };
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url()).pathname;
      if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
      if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      // Geräteuhr = Serveruhr: hier geht es nur um die Pause.
      if (url === `/api/tournaments/${SLUG}/lead`) return route.fulfill(json(view()));
      return route.fulfill(json([]));
    });
    await page.goto(`/tournaments/${SLUG}/leitung`);
    await page.getByTestId("lead-tab-results").click();
    const time = page.getByTestId("lead-clock-m-pause-time");
    await expect(time).toHaveText("15:00");
    await expect(page.getByTestId("lead-clock-m-pause-paused")).toHaveText(/Pause/i);
    await page.clock.runFor(5000);
    await expect(time).toHaveText("15:00");

    // Weiter: der Server hat 300 Sekunden Pause gebucht - die Uhr zählt ab 15:00 weiter, nicht ab 20:00.
    resumed = true;
    await page.reload();
    await page.getByTestId("lead-tab-results").click();
    await expect(page.getByTestId("lead-clock-m-pause-paused")).toHaveCount(0);
    await expect.poll(async () => secondsOf(await time.textContent())).toBeGreaterThanOrEqual(15 * 60);
    expect(secondsOf(await time.textContent())).toBeLessThan(15 * 60 + 30);
  });
});
