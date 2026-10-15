const path = require("node:path");
const { test, expect } = require("@playwright/test");
const fixture = require("./fixtures/liveQueueGenerated.json");

// Live vor Ort (#1556): Warteschlange je Station in der Turnierleitung (Uhr tickt ohne Neuladen, „Aufrufen“,
// „Gestartet“) und die Spieler-Sicht auf Matchseite und Turnierseite. Die Daten kommen aus den echten Routen
// (scripts/make_live_queue_fixture.py), die API ist hier nur nachgestellt. Namen sind erfunden.
// LSW_SCREENS=<Ordner> legt die Bildschirmfotos zusätzlich dort ab.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SLUG = fixture.tournament.slug;
const TID = fixture.tournament.id;
const shots = process.env.LSW_SCREENS || "";

async function shot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (shots) require("node:fs").writeFileSync(path.join(shots, name), body);
}

async function prepare(page, { width, height, now, user }) {
  // Die Uhr beginnt beim Stand der Daten und läuft von dort weiter.
  await page.clock.install({ time: new Date(now) });
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  return user;
}

function leadView() {
  return { tournament: { ...fixture.tournament, status: "live" }, now: fixture.now, matches: [], attention: [], recent: [], stations: [], counts: { open: 0 } };
}

/** Nach „Gestartet“: das aufgerufene Spiel läuft, das danach rückt nach - wie der Server es neu rechnen würde. */
function afterStart(queue, stationId, now) {
  return {
    ...queue,
    stations: queue.stations.map((station) => (station.id !== stationId ? station : {
      ...station, status: "busy", running: { ...station.next, state: "running", position: 0, started_at: now }, next: station.after, after: null,
    })),
  };
}

test.describe("Warteschlange vor Ort", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height, name] of [[390, 844, "leitung-390.png"], [1280, 900, "leitung-1280.png"]]) {
    test(`Turnierleitung ${width} px: läuft mit Uhr, aufgerufen mit „Gestartet“, Verzug oben`, async ({ page }, testInfo) => {
      await prepare(page, { width, height, now: fixture.now });
      let queue = fixture.states.live;
      const posts = [];
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const url = new URL(request.url()).pathname;
        if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
        if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
        if (url === `/api/tournaments/${SLUG}/lead`) return route.fulfill(json(leadView()));
        if (url === `/api/tournaments/${SLUG}/live-queue`) return route.fulfill(json(queue));
        if (url === `/api/tournaments/${SLUG}/live-queue/start` && request.method() === "POST") {
          posts.push(request.postDataJSON());
          queue = afterStart(queue, request.postDataJSON().station_id, fixture.now);
          return route.fulfill(json({ ok: true, idempotent_replay: false }));
        }
        return route.fulfill(json([]));
      });
      await page.goto(`/tournaments/${SLUG}/leitung`);

      await expect(page.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("live-summary")).toContainText("+15 Min. · Finale jetzt ca.");
      const running = queue.stations.find((station) => station.running).running;
      const clock = page.getByTestId(`live-clock-${running.match_id}`);
      await expect(clock).toHaveAttribute("data-tone", "warn");
      // Die Uhr tickt ohne Neuladen: 25 Minuten seit dem Start, drei Sekunden später drei Sekunden mehr.
      const seconds = async () => {
        const [minutes, secs] = ((await clock.textContent()).match(/(\d+):(\d\d)/) || []).slice(1).map(Number);
        return minutes * 60 + secs;
      };
      const before = await seconds();
      expect(before).toBeGreaterThanOrEqual(25 * 60);
      await page.clock.runFor(3000);
      await expect.poll(seconds).toBeGreaterThanOrEqual(before + 3);
      const called = queue.stations.find((station) => station.next?.state === "called");
      await expect(page.getByTestId(`live-next-${called.id}`)).toContainText("Aufgerufen");
      await expect(page.getByTestId(`live-next-${called.id}`)).toContainText("nicht erschienen ab");
      await expect(page.getByTestId("live-station-st3")).toContainText("Defekt");
      // Nichts läuft quer aus dem Bild.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await shot(page, testInfo, name);

      await page.getByTestId(`live-start-${called.id}`).click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({ station_id: called.id, match_id: called.next.match_id });
      await expect(page.getByTestId(`live-running-${called.id}`)).toBeVisible();
      await expect(page.getByTestId(`live-clock-${called.next.match_id}`)).toHaveAttribute("data-tone", "run");
    });
  }

  test("Turnierleitung vor dem Start: „Aufrufen“ an jeder freien Station", async ({ page }) => {
    await prepare(page, { width: 390, height: 844, now: fixture.now });
    const calls = [];
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url()).pathname;
      if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
      if (url === `/api/tournaments/${SLUG}/lead`) return route.fulfill(json(leadView()));
      if (url === `/api/tournaments/${SLUG}/live-queue`) return route.fulfill(json(fixture.states.start));
      if (url === `/api/tournaments/${SLUG}/live-queue/call` && request.method() === "POST") {
        calls.push(request.postDataJSON());
        return route.fulfill(json({ detail: "Die Station hält inzwischen ein anderes Spiel. Bitte neu laden." }, 409));
      }
      return route.fulfill(json([]));
    });
    await page.goto(`/tournaments/${SLUG}/leitung`);
    const first = fixture.states.start.stations[0];
    await page.getByTestId(`live-call-${first.id}`).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({ station_id: first.id, match_id: first.next.match_id });
    // Zwei Helfer zugleich: der zweite sieht die Antwort des Servers im Klartext.
    await expect(page.getByText("Die Station hält inzwischen ein anderes Spiel. Bitte neu laden.")).toBeVisible();
  });

  test("Worst Case bei 375 px: lange, diakritische und Emoji-Namen brechen nichts", async ({ page }, testInfo) => {
    await prepare(page, { width: 375, height: 812, now: fixture.worst_now });
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url()).pathname;
      if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
      if (url === `/api/tournaments/${SLUG}/lead`) return route.fulfill(json(leadView()));
      if (url === `/api/tournaments/${SLUG}/live-queue`) return route.fulfill(json(fixture.states.worst));
      return route.fulfill(json([]));
    });
    await page.goto(`/tournaments/${SLUG}/leitung`);
    await expect(page.getByTestId("live-board")).toContainText("bartholomew.fitzgerald@northwind-industries.example");
    // Die Karten kommen gestaffelt herein - erst nach dem Ankommen fotografieren.
    await expect(page.getByTestId("live-station-st3")).toHaveCSS("opacity", "1");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, testInfo, "leitung-worst-375.png");
  });

  test("Spieler-Sicht bei 375 px: Matchseite und „Dein Stand“ sagen Station und Zeit", async ({ page }, testInfo) => {
    await prepare(page, { width: 375, height: 812, now: fixture.now });
    const entry = fixture.me.entries[0];
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url()).pathname;
      if (url === "/api/auth/me") return route.fulfill(json({ id: "u1", username: "spieler", display_name: "Spieler", role: "user" }));
      if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
      if (url === `/api/matches/${fixture.match_id}/page`) return route.fulfill(json(fixture.match_page));
      if (url === `/api/tournaments/${TID}/live-queue`) return route.fulfill(json(fixture.states.public));
      if (url === `/api/tournaments/${TID}/live-queue/me`) return route.fulfill(json(fixture.me));
      if (url === `/api/tournaments/${SLUG}`) return route.fulfill(json({ ...fixture.match_page.tournament, ...fixture.tournament, status: "live", format: "single_elim", is_public: true, visibility: "public", participant_count: 8, max_participants: 8, platform: "Switch 2" }));
      if (url === `/api/tournaments/${TID}/registrations`) return route.fulfill(json([{ id: "r-me", tournament_id: TID, user_id: "u1", status: "checked_in", display_name: "NeonFalke" }]));
      return route.fulfill(json([]));
    });
    await page.goto(`/matches/${fixture.match_id}`);
    const status = page.getByTestId("live-queue-status");
    await expect(status).toContainText(`Als Nächstes an ${entry.station_text}`);
    await expect(status).toContainText("+20 Min.");
    await shot(page, testInfo, "spieler-matchseite-375.png");

    await page.goto(`/tournaments/${SLUG}`);
    const mine = page.getByTestId("tournament-my-stand").getByTestId("live-queue-status");
    await expect(mine).toContainText(`Du bist als Nächstes an ${entry.station_text}`);
    await mine.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "spieler-turnierseite-375.png");
  });
});
