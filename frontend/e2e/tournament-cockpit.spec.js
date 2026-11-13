const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Turnier-Cockpit (#1653): der Einstieg der Turnierleitung am Turniertag vor Ort - am Handy (390), am Tablet hochkant
// (768) und quer (1024, zwei Spalten: links Probleme, rechts Stationen). Feste Uhr (page.clock.setFixedTime), die API
// ist nachgestellt: Was die Leitung tippt, ändert den Stand wie am Server - Aufrufen, Starten, Freigeben (mit Rückfrage)
// und Defekt melden gehen über die bestehenden Wege der Warteschlange. Ein neuer Fall („Station defekt“) steigt ein,
// ein erledigter („Verzug“ nach dem Start) gleitet hinaus. Alle Namen erfunden. LSW_SCREENS=<Ordner> legt die
// Bildschirmfotos zusätzlich dort ab.

const shots = process.env.LSW_SCREENS || "";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SLUG = "herbst-cup";
const NOW = Date.parse("2026-11-14T15:30:00Z");
const MINUTE = 60 * 1000;
const at = (minutes) => new Date(NOW + minutes * MINUTE).toISOString();

const entry = (id, label, names, extra = {}) => ({
  match_id: id, match_key: id.toUpperCase(), label, stage_name: "Turnierbaum", names, open_slots: 0, ready: true, heat: false,
  state: "queued", position: 1, forecast: false, delay_minutes: 0, duration_minutes: 20, forecast_at: at(5), planned_at: at(5),
  called_at: null, report_by: null, no_show_due_at: null, no_show_names: [], started_at: null, paused_at: null, paused_seconds: 0, busy_at: null, ...extra,
});

function newWorld() {
  return {
    stations: {
      pc1: { id: "pc1", name: "PC 1", station_text: "PC 1 · PC", status: "busy", running: entry("qf1", "Viertelfinale", ["NeonFalke", "PixelPanther"], { state: "running", position: 0, started_at: at(-17) }), next: null, after: null },
      pc2: { id: "pc2", name: "PC 2", station_text: "PC 2 · PC", status: "free", running: null, next: entry("qf2", "Viertelfinale", ["TurboTina", "Frostbiss"], { delay_minutes: 12, forecast_at: at(0), planned_at: at(-12) }), after: entry("sf1", "Halbfinale", ["Sieger VF 1", "Sieger VF 2"], { position: 2, forecast_at: at(25), planned_at: at(20) }) },
      pc3: { id: "pc3", name: "PC 3", station_text: "PC 3 · PC", status: "reserved", running: null, next: entry("qf3", "Viertelfinale", ["Aurora Blitz", "Zackenbarsch"], { state: "called", called_at: at(-3), report_by: at(2) }), after: null },
      pc4: { id: "pc4", name: "PC 4", station_text: "PC 4 · PC", status: "free", running: null, next: entry("qf4", "Viertelfinale", ["Kometa", "Silberdachs"], { forecast_at: at(4), planned_at: at(4) }), after: null },
    },
    attention: [
      { id: "ds-g1", kind: "dispute", title: "Streitfall gemeldet", action: "view", match_id: "g1", station_text: "PC 5 · PC", label: "Gruppe A · Spiel 3", names: "Graufalke gegen Mondkatze", detail: "Graufalke: „Falsches Ergebnis“", since: at(-6) },
      { id: "rm-g2", kind: "result_missing", title: "Ergebnis fehlt", action: "enter", match_id: "g2", station_text: "PC 6 · PC", label: "Gruppe B · Spiel 2", names: "Nebelwolf gegen Kupferkrähe", detail: "9 Min. über der Zeit", overdue_minutes: 9, since: at(-9) },
      { id: "ns-g3", kind: "no_show", title: "Nicht erschienen?", action: "no_show", match_id: "g3", station_text: "PC 7 · PC", label: "Gruppe B · Spiel 3", names: "Sturmling gegen Eisvogel", detail: "10 Min. ab Aufruf um – kampflos werten oder verlängern.", since: at(-1),
        participants: [{ registration_id: "r-st", name: "Sturmling" }, { registration_id: "r-ei", name: "Eisvogel" }] },
    ],
    posts: [],
  };
}

function queueOf(world) {
  const stations = Object.values(world.stations).map((station) => ({ ...station, waiting: [station.next, station.after].filter(Boolean).length }));
  const matches = Object.fromEntries(stations.flatMap((station) => [station.next, station.after]).filter((row) => row && row.state === "queued").map((row) => [row.match_id, row]));
  return {
    applies: true, reason: null, now: at(0), unplaced: [], operate: { all: true, station_ids: [] }, matches, stations,
    summary: { delay_minutes: 12, last: { label: "Finale", forecast_at: at(95) } },
  };
}

function leadOf(world) {
  return {
    tournament: { id: "t1", slug: SLUG, title: "Lions Herbst-Cup", status: "live", event_mode: "local", can_check_in: false, can_notice: false },
    now: at(0), matches: [], recent: [], stations: [], draws: [], counts: { open: 0 }, attention: world.attention,
  };
}

async function mockCockpit(page, world) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    if (url === "/api/auth/me") return route.fulfill(json({ id: "s1", username: "leitung", display_name: "Turnierleitung", role: "tournament_admin", is_tournament_staff: true }));
    if (url === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "example.test" }));
    if (url === "/api/seasonal/active") return route.fulfill(json({ seasons: [], now: at(0) }));
    if (url === `/api/tournaments/${SLUG}/lead`) return route.fulfill(json(leadOf(world)));
    if (url === `/api/tournaments/${SLUG}/live-queue`) return route.fulfill(json(queueOf(world)));
    const action = /\/live-queue\/(call|start|release|broken)$/.exec(url);
    if (action && request.method() === "POST") {
      const body = request.postDataJSON();
      world.posts.push([action[1], body]);
      const station = world.stations[body.station_id];
      if (action[1] === "call") {
        station.next = { ...station.next, state: "called", called_at: at(0), report_by: at(5) };
        station.status = "reserved";
      } else if (action[1] === "start") {
        station.running = { ...station.next, state: "running", position: 0, started_at: at(0), delay_minutes: 0 };
        station.next = station.after;
        station.after = null;
        station.status = "busy";
      } else if (action[1] === "release") {
        station.running = null;
        station.status = "free";
      } else {
        station.status = "broken";
        // Wartet noch ein Spiel auf die Station, ist das ein neuer Fall (services/match_attention.py).
        if (station.next) {
          world.attention = [...world.attention, { id: `st-${station.id}`, kind: "station_broken", title: "Station defekt", action: "move", station_id: station.id, station_text: station.station_text,
            label: station.next.label, names: station.next.names.join(" gegen "), detail: "1 Spiel wartet darauf", match_ids: [station.next.match_id], since: at(0) }];
        }
      }
      return route.fulfill(json({ ok: true, idempotent_replay: false, state: action[1] === "release" ? "running" : undefined, holds: null }));
    }
    return route.fulfill(json([]));
  });
}

// Fürs ganze Bild: die festen Leisten (Rückmeldung, Leiste unten am Handy) lägen sonst mitten über der Seite.
const HIDE = "[data-sonner-toaster], [data-testid='bottom-nav'], [data-testid='scroll-top-btn'] { display: none !important; }";

/**
 * Erst messen, wenn nichts mehr einblendet (#2390, wie station-lead): Während Kachel, Aufruf und Seite einblenden, ändert eine Skalierung
 * an einem Vorfahren die gemessene Höhe um Bruchteile eines Pixels (43,9999 statt 44). Wartet auf alle endlichen
 * Animationen und die Schriften - dauerhafte (der Live-Punkt) laufen weiter. Die Prüfung selbst bleibt gleich streng.
 */
async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = () => document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    for (let round = 0; round < 5 && finite().some((animation) => animation.playState === "running"); round += 1) {
      await Promise.all(finite().map((animation) => animation.finished.catch(() => null)));
    }
  });
}

async function shot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage: true, style: HIDE });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (shots) require("node:fs").writeFileSync(path.join(shots, name), body);
}

const problemIds = (page) => page.locator("[data-testid='cockpit-problems-list'] a").evaluateAll((rows) => rows.map((row) => row.dataset.testid.replace("cockpit-problem-", "")));

test.describe("Turnier-Cockpit", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [768, 1024], [1024, 768]]) {
    test(`${width} px: Probleme nach Dringlichkeit, aufrufen, starten, freigeben, Defekt melden`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      const world = newWorld();
      await page.setViewportSize({ width, height });
      await mockCockpit(page, world);
      await page.goto(`/tournaments/${SLUG}/leitung`);

      // Einstieg: das Cockpit. Die übrigen Reiter bleiben da.
      await expect(page.getByTestId("lead-tab-cockpit")).toHaveAttribute("aria-selected", "true");
      for (const key of ["attention", "stations", "results"]) await expect(page.getByTestId(`lead-tab-${key}`)).toBeVisible();
      await expect(page.getByTestId("cockpit-problems-count")).toHaveText("4 Probleme");
      expect(await problemIds(page)).toEqual(["ds-g1", "ns-g3", "rm-g2", "dl-pc2"]);
      await expect(page.getByTestId("cockpit-problem-dl-pc2")).toContainText("+12 Min. hinter dem Plan");
      // Die Spielzeit-Uhr an der Station: 17 von 20 Minuten - knapp, orange.
      await expect(page.getByTestId("live-clock-qf1")).toHaveAttribute("data-tone", "warn");
      await expect(page.getByTestId("live-clock-qf1-time")).toHaveText("17:00");

      // Anordnung: am Tablet quer zwei Spalten (links Probleme, rechts Stationen), sonst untereinander.
      const problems = await page.getByTestId("cockpit-problems").boundingBox();
      const stations = await page.getByTestId("cockpit-stations").boundingBox();
      if (width >= 1024) {
        expect(problems.x + problems.width).toBeLessThanOrEqual(stations.x);
        expect(Math.abs(problems.y - stations.y)).toBeLessThan(4);
      } else {
        expect(stations.y).toBeGreaterThanOrEqual(problems.y + problems.height);
      }
      // Zwei Kacheln nebeneinander (768): die kurze bleibt so hoch wie ihr Inhalt, sie wird nicht auf die lange gestreckt.
      if (width === 768) {
        const short = await page.getByTestId("live-station-pc1").boundingBox();
        const tall = await page.getByTestId("live-station-pc2").boundingBox();
        expect(Math.abs(short.y - tall.y)).toBeLessThan(2);
        expect(short.height).toBeLessThan(tall.height - 40);
      }
      // Nichts läuft quer hinaus, jede Tippfläche ist mindestens 44 px hoch.
      await settled(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() => [...document.querySelectorAll("[data-testid='lead-cockpit'] button, [data-testid='lead-cockpit'] a, [data-testid='lead-tabs'] button")]
        .filter((node) => node.getBoundingClientRect().height < 44).map((node) => node.dataset.testid || node.textContent));
      expect(small).toEqual([]);

      // Aufrufen und Starten an PC 2: der Verzug ist erledigt und gleitet hinaus.
      await page.getByTestId("live-call-pc2").click();
      await expect(page.getByTestId("live-chip-pc2")).toHaveAttribute("data-tone", "called");
      await expect(page.getByTestId("cockpit-problem-dl-pc2")).toContainText("Aufgerufen");
      await page.getByTestId("live-start-pc2").click();
      await expect(page.getByTestId("live-chip-pc2")).toHaveAttribute("data-tone", "running");
      await expect(page.getByTestId("cockpit-problem-dl-pc2")).toHaveCount(0);
      // Starten an PC 3 (aufgerufen): die Uhr läuft ab 00:00.
      await page.getByTestId("live-start-pc3").click();
      await expect(page.getByTestId("live-clock-qf3-time")).toHaveText("00:00");

      // Freigeben fragt nach - erst dann ist PC 1 frei.
      await page.getByTestId("live-release-pc1").click();
      await expect(page.getByTestId("live-release-confirm-pc1")).toContainText("Das Spiel läuft noch");
      await page.getByTestId("live-release-yes-pc1").click();
      await expect(page.getByTestId("live-chip-pc1")).toHaveAttribute("data-tone", "free");

      // Defekt melden an PC 4: dort wartet ein Spiel - ein neuer Fall steigt ein.
      await page.getByTestId("live-broken-pc4").click();
      await expect(page.getByTestId("live-chip-pc4")).toHaveAttribute("data-tone", "broken");
      await expect(page.getByTestId("cockpit-problem-st-pc4")).toBeVisible();
      expect(await problemIds(page)).toEqual(["ds-g1", "ns-g3", "st-pc4", "rm-g2"]);
      expect(world.posts.map(([kind, body]) => `${kind}:${body.station_id}`)).toEqual(["call:pc2", "start:pc2", "start:pc3", "release:pc1", "broken:pc4"]);

      await page.waitForTimeout(1200); // Einsteigen und Aufleuchten sind durch
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, testInfo, `1653-cockpit-${width}.png`);

      // Ein Tipp auf ein Problem führt zum Fall - mit seinen Knöpfen.
      await page.getByTestId("cockpit-problem-ns-g3").click();
      await expect(page.getByTestId("lead-tab-attention")).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(/\?fall=ns-g3$/);
      await expect(page.getByTestId("lead-no-show-r-st")).toBeVisible();
      await expect(page.getByTestId("lead-no-show-r-st")).toBeInViewport();
    });
  }

  test("Verzug führt zur Station im Cockpit; „Bewegung reduzieren“: Erledigtes ist sofort weg", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      const world = newWorld();
      await mockCockpit(page, world);
      await page.goto(`/tournaments/${SLUG}/leitung`);
      await expect(page.getByTestId("cockpit-problems-list")).toHaveAttribute("data-motion", "off");
      await page.getByTestId("cockpit-problem-dl-pc2").click();
      await expect(page).toHaveURL(/\?station=pc2$/);
      await expect(page.getByTestId("lead-tab-cockpit")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("live-station-pc2")).toHaveAttribute("data-highlighted", /^[ab]$/);
      await expect(page.getByTestId("live-station-pc2")).toBeInViewport();
      await page.getByTestId("live-call-pc2").click();
      await expect(page.getByTestId("live-start-pc2")).toBeVisible();
      await page.getByTestId("live-start-pc2").click();
      // Ohne Hinausgleiten: im selben Bild, in dem die Station „Läuft“ zeigt, ist der Verzug weg.
      await expect(page.getByTestId("live-chip-pc2")).toHaveAttribute("data-tone", "running");
      expect(await page.getByTestId("cockpit-problem-dl-pc2").count()).toBe(0);
    } finally {
      await context.close();
    }
  });
});
