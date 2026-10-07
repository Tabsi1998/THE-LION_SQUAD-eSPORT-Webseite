const { test, expect } = require("@playwright/test");
const { mockHallApi } = require("./fixtures/tvMock");

// TV III, Meilenstein 60 (#1121-#1127): der Bildschirm begleitet den ganzen Turniertag. Wiedergabeliste mit kurzer
// Test-Dauer (Reihenfolge, Balken, leere Folien, Ergebnis hält an, eine Folie ohne Wechsel), Aufruf-Tafel (reservieren,
// Tafel, starten, weg; Countdown; Gong nur mit Einstellung), Pause-, Check-in- und Anmelde-Bildschirm (Wechsel ohne
// Neuladen, neuer Haken sofort, QR groß genug), Zahlen und Sponsoren (selten, nie während eines Moments, jede
// Schalter-Kombination), Hallen-Tafel mit 6, 12 und 24 Stationen (keine fehlt still) und mehreren Tagen, Fast Lap mit
// Bestzeit-Moment. „Bewegung reduzieren“ hält alles still. Alle Namen erfunden; alle Antworten kommen aus dem Test.

const KEY = "/display/bracket/t1?key=tv-schluessel&pixel_shift=0";
const SIZES = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }];
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

let T;
let H;
test.beforeAll(async () => {
  T = await import("./fixtures/tvBrackets.mjs");
  H = await import("./fixtures/tvHall.mjs");
});

/** Ein Turnier mit 16 Spielern: Runde 1 halb gespielt, zwei laufen, `calls` aufgerufen, eines eingeplant. */
function busyCup({ calls = 1, live = true } = {}) {
  const cup = T.singleElimination(16, { title: "Lions Herbst-Cup" });
  T.play(cup, ["A", "B", "C"]);
  if (live) {
    T.start(cup, "D", { station: "PC 1", startedAt: ago(12) });
    T.start(cup, "E", { station: "PC 2", startedAt: ago(4) });
  }
  ["F", "G", "H"].slice(0, calls).forEach((key, index) => H.call(cup, key, { station: `PC ${3 + index}`, calledAt: ago(0.5) }));
  return cup;
}

async function openBracket(page, query = "") {
  await page.goto(`${KEY}${query ? `&${query}` : ""}`);
  await expect(page.getByTestId("bracket-tv")).toBeVisible();
}

const slideOf = (page) => page.getByTestId("bracket-tv").getAttribute("data-slide");

/**
 * Mit der Test-Uhr in kleinen Schritten vorspulen, bis `check()` stimmt - ein großer Sprung ließe einen Moment, der
 * wenige Sekunden steht, ganz im Sprung beginnen und enden.
 */
async function runUntil(page, check, maxMs, stepMs = 1500) {
  for (let spent = 0; spent <= maxMs; spent += stepMs) {
    if (await check()) return true;
    await page.clock.runFor(stepMs);
  }
  return check();
}

/** Text kleiner als die Grenze, „…“ und Überlauf - gemessen im Browser (wie Meilenstein 58). */
function measure(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-testid='tv-screen']");
    const height = window.innerHeight;
    const small = [];
    const cut = [];
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest("option, [aria-hidden='true']")) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === "hidden" || !rect.width || !rect.height) continue;
      const isName = Boolean(element.closest("[data-tv-name]"));
      const stage = element.closest("[data-tv-scale]");
      const size = parseFloat(style.fontSize) * (stage ? Number(stage.getAttribute("data-tv-scale")) || 1 : 1);
      const min = (isName ? 2 : 1.4) * height / 100;
      if (size + 0.05 < min) small.push(`${node.textContent.trim()} (${size.toFixed(1)} < ${min.toFixed(1)})`);
      if (isName && (node.textContent.trim().endsWith("…") || element.scrollWidth > element.clientWidth + 1)) cut.push(node.textContent.trim());
    }
    const overflow = [];
    for (const box of root.querySelectorAll("[data-testid='tv-station-list'], [data-testid='tv-checkin-names'], [data-testid='tv-call-board'], [data-testid='tv-lap-list'], .tv-hall__plan-body")) {
      if (box.scrollHeight > box.clientHeight + 1) overflow.push(box.getAttribute("data-testid") || box.className);
    }
    const outside = [];
    for (const element of root.querySelectorAll(".tv-call, .tv-hall-station, .tv-nownext__card, .tv-plan__block, .tv-check, .tv-stat")) {
      const r = element.getBoundingClientRect();
      if (r.right > window.innerWidth + 2 || r.bottom > window.innerHeight + 2) outside.push(element.textContent.slice(0, 40));
    }
    return { small, cut, overflow, outside };
  });
}

async function countSound(page) {
  await page.addInitScript(() => {
    window.__tvSound = { contexts: 0, tones: 0 };
    class CountingAudioContext {
      constructor(options = {}) {
        this.options = options;
        this.state = "suspended";
        this.currentTime = 0;
        this.destination = {};
        window.__tvSound.contexts += 1;
      }

      async resume() { this.state = "running"; }

      createOscillator() {
        window.__tvSound.tones += 1;
        return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
      }

      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    }
    window.AudioContext = CountingAudioContext;
  });
}

const runningAnimations = (page) => page.evaluate(() => {
  const root = document.querySelector("[data-testid='tv-screen']");
  return document.getAnimations().filter((animation) => animation.playState === "running" && root.contains(animation.effect?.target)).length;
});

test.describe("TV III: Ablauf im Raum (Meilenstein 60)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "TV-Seiten sind für große Bildschirme; die Größen stellt der Test selbst ein");

  // ------------------------------------------------------------ #1121 Wiedergabeliste
  test("#1121: Reihenfolge und Dauer stimmen, der Balken passt dazu; leere Folien werden übersprungen", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const state = await mockHallApi(page, { bracket: busyCup({ calls: 1 }) });
    state.stations = H.stationsOf([state.bracket], { names: ["PC 1", "PC 2", "PC 3"] });
    await openBracket(page, "playlist=tree-3_live-3_calls-3");
    await expect(page.getByTestId("tv-tree")).toBeVisible();
    expect(await slideOf(page)).toBe("tree");
    const bar = page.getByTestId("tv-slide-bar");
    await expect(bar).toHaveAttribute("data-total", "3000");
    const width = () => bar.locator("i").evaluate((element) => parseFloat(element.style.width));
    const first = await width();
    await page.waitForTimeout(1200);
    expect(await width()).toBeGreaterThan(first);
    // Baum → Live-Spiele → Aufrufe → Baum, je etwa 3 Sekunden.
    const order = [];
    const started = Date.now();
    const changes = [];
    let last = "tree";
    while (Date.now() - started < 10_500) {
      const slide = await slideOf(page);
      if (slide !== last) {
        order.push(slide);
        changes.push(Date.now());
        last = slide;
      }
      await page.waitForTimeout(100);
    }
    expect(order.slice(0, 3)).toEqual(["live", "calls", "tree"]);
    const gaps = changes.slice(1, 3).map((time, index) => time - changes[index]);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(2500);
      expect(gap).toBeLessThan(4200);
    }

    // Ohne Aufrufe gibt es keine Aufruf-Folie: Baum und Live-Spiele wechseln sich ab.
    state.bracket = busyCup({ calls: 0 });
    state.stations = [];
    await openBracket(page, "playlist=tree-3_calls-3_live-3");
    const seen = new Set();
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      seen.add(await slideOf(page));
      await page.waitForTimeout(150);
    }
    expect([...seen].sort()).toEqual(["live", "tree"]);
  });

  test("#1121: ein Ergebnis hält die Liste an - der Baum zeigt es, danach läuft die Folie zu Ende", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = busyCup({ calls: 1, live: false });
    const state = await mockHallApi(page, { bracket: T.clone(bracket) });
    state.stations = H.stationsOf([state.bracket], { names: ["PC 3"] });
    await openBracket(page, "playlist=tree-3_calls-6");
    await expect.poll(() => slideOf(page), { timeout: 6000 }).toBe("calls");
    await page.waitForTimeout(1000);
    T.decide(bracket, "D");
    state.bracket = T.clone(bracket);
    state.push();
    await expect(page.getByTestId("tv-result-card")).toBeVisible({ timeout: 5000 });
    expect(await slideOf(page)).toBe("tree");
    await expect(page.getByTestId("tv-slide-bar")).toHaveCount(0);
    await expect(page.getByTestId("tv-result-card")).toHaveCount(0, { timeout: 6000 });
    // Nach dem Moment (und der Fahrt) geht es auf der Aufruf-Folie weiter - mit der Zeit, die ihr noch fehlte.
    await expect.poll(() => slideOf(page), { timeout: 10_000 }).toBe("calls");
    const back = Date.now();
    await expect.poll(() => slideOf(page), { timeout: 9000 }).toBe("tree");
    const rest = Date.now() - back;
    expect(rest).toBeGreaterThan(3000);
    expect(rest).toBeLessThan(6500);
  });

  test("#1121: ein Link mit nur einer Folie zeigt genau diese - ohne Wechsel und ohne Balken", async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockHallApi(page, { bracket: busyCup() });
    await openBracket(page, "playlist=live-3");
    await expect(page.getByTestId("tv-live-slide")).toBeVisible();
    for (let step = 0; step < 14; step += 1) {
      expect(await slideOf(page)).toBe("live");
      await page.waitForTimeout(500);
    }
    await expect(page.getByTestId("tv-slide-bar")).toHaveCount(0);
    await expect(page.getByTestId("tv-live-slide")).toHaveAttribute("data-count", "2");
    await expect(page.getByTestId("tv-live-m-D")).toContainText("PC 1");
  });

  test("#1121: „Bewegung reduzieren“ - Folien wechseln ohne Gleiten", async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockHallApi(page, { bracket: busyCup() });
    await openBracket(page, "playlist=tree-3_live-3&reduce_motion=1");
    await expect.poll(() => slideOf(page), { timeout: 6000 }).toBe("live");
    expect(await runningAnimations(page)).toBe(0);
    expect(await page.locator(".tv-slidebar i").evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
    await expect.poll(() => slideOf(page), { timeout: 6000 }).toBe("tree");
    expect(await runningAnimations(page)).toBe(0);
  });

  // ------------------------------------------------------------ #1122 Aufruf-Tafel
  test("#1122: reservieren - die Tafel zeigt den Aufruf ohne Neuladen; starten - weg", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = busyCup({ calls: 0, live: false });
    const state = await mockHallApi(page, { bracket: T.clone(bracket), stations: [] });
    await openBracket(page, "playlist=calls");
    await expect(page.getByTestId("tv-calls-none")).toHaveText("Gerade keine Aufrufe");
    await page.evaluate(() => { window.__ohneNeuladen = true; });

    H.call(bracket, "F", { station: "PC 3", calledAt: new Date().toISOString() });
    state.bracket = T.clone(bracket);
    state.stations = H.stationsOf([bracket], { names: ["PC 3"] });
    state.push("stations");
    const card = page.getByTestId("tv-call-m-F");
    await expect(card).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId("tv-call-station-m-F")).toHaveText("PC 3");
    await expect(card).toContainText("Bitte jetzt zur Station");
    const clock = page.getByTestId("tv-call-clock-m-F");
    await expect(clock).toHaveText(/^[12]:\d{2}$/);
    const before = await clock.textContent();
    await page.waitForTimeout(1300);
    expect(await clock.textContent()).not.toBe(before);
    await page.waitForTimeout(500);
    const measured = await measure(page);
    expect(measured.small).toEqual([]);
    expect(measured.cut).toEqual([]);

    T.start(bracket, "F", { station: "PC 3", startedAt: new Date().toISOString() });
    delete T.find(bracket, "F").called_at;
    state.bracket = T.clone(bracket);
    state.stations = H.stationsOf([bracket], { names: ["PC 3"] });
    state.push("stations");
    await expect(card).toHaveCount(0, { timeout: 6000 });
    await expect(page.getByTestId("tv-calls-none")).toBeVisible();
    expect(await page.evaluate(() => window.__ohneNeuladen)).toBe(true);
  });

  test("#1122: bei 0 „Jetzt geht es los“, nichts blinkt; „Bewegung reduzieren“: der Ring steht, die Zahl zählt", async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = busyCup({ calls: 0, live: false });
    H.call(bracket, "F", { station: "PC 3", calledAt: ago(2.5) });
    H.call(bracket, "G", { station: "PC 4", calledAt: ago(0.2) });
    await mockHallApi(page, { bracket, stations: H.stationsOf([bracket], { names: ["PC 3", "PC 4"] }) });
    await openBracket(page, "playlist=calls&reduce_motion=1");
    await expect(page.getByTestId("tv-call-m-F")).toHaveAttribute("data-done", "1");
    await expect(page.getByTestId("tv-call-m-F")).toContainText("Jetzt geht es los");
    const ring = page.locator("[data-testid='tv-call-count-m-G'] .tv-call__ring-fg");
    expect(Number(await ring.evaluate((element) => parseFloat(element.style.strokeDashoffset)))).toBe(0);
    const clock = page.getByTestId("tv-call-clock-m-G");
    const first = await clock.textContent();
    await page.waitForTimeout(1300);
    expect(await clock.textContent()).not.toBe(first);
    expect(Number(await ring.evaluate((element) => parseFloat(element.style.strokeDashoffset)))).toBe(0);
    expect(await runningAnimations(page)).toBe(0);
    // Mit Bewegung schrumpft der Ring.
    await openBracket(page, "playlist=calls");
    expect(Number(await page.locator("[data-testid='tv-call-count-m-G'] .tv-call__ring-fg").evaluate((element) => parseFloat(element.style.strokeDashoffset)))).toBeGreaterThan(0);
  });

  test("#1122: Gong beim Aufruf nur mit Einstellung - nach einem Klick, bei einem neuen Aufruf", async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await countSound(page);
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "userActivation", { configurable: true, value: { hasBeenActive: false, isActive: false } });
    });
    const bracket = busyCup({ calls: 0, live: false });
    const state = await mockHallApi(page, { bracket: T.clone(bracket), stations: [] });
    await openBracket(page, "playlist=calls");
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__tvSound)).toEqual({ contexts: 0, tones: 0 });
    await expect(page.getByTestId("tv-sound-hint")).toHaveCount(0);

    await openBracket(page, "playlist=calls&call_sound=1");
    await expect(page.getByTestId("tv-sound-hint")).toHaveText("Für Ton einmal klicken");
    await page.mouse.click(300, 300);
    await expect(page.getByTestId("tv-sound-hint")).toHaveCount(0);
    H.call(bracket, "G", { station: "PC 4", calledAt: new Date().toISOString() });
    state.bracket = T.clone(bracket);
    state.stations = H.stationsOf([bracket], { names: ["PC 4"] });
    state.push("stations");
    await expect(page.getByTestId("tv-call-m-G")).toBeVisible({ timeout: 6000 });
    await expect.poll(() => page.evaluate(() => window.__tvSound.tones)).toBeGreaterThan(0);
  });

  test("#1122: die Aufruf-Tafel eines Events - alle Turniere, mit Turnier, ohne Anmeldung", async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const hall = H.hallEvent({ now: Date.now(), stations: 24 });
    await mockHallApi(page, { event: hall.event, stations: hall.stations, brackets: hall.brackets });
    await page.goto("/display/event/event-1/calls?pixel_shift=0");
    const board = page.getByTestId("tv-call-board");
    await expect(board).toBeVisible();
    const reserved = hall.stations.filter((station) => station.status === "reserved");
    await expect(board).toHaveAttribute("data-count", String(reserved.length));
    await expect(board).toContainText("Kart-Sprint");
    const measured = await measure(page);
    expect(measured.small).toEqual([]);
    expect(measured.cut).toEqual([]);
    expect(measured.overflow).toEqual([]);
  });

  // ------------------------------------------------------------ #1123 Pause, Check-in, Anmeldung
  test("#1123: der Bildschirm wechselt ohne Neuladen - Check-in mit neuem Haken, dann Spiel, dann Pause", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const cup = T.singleElimination(16, { title: "Lions Herbst-Cup" });
    const registrations = cup.registrations.map((reg, index) => ({ ...reg, status: index < 12 ? "checked_in" : "approved" }));
    const checkin = { ...T.clone(cup), registrations, tournament: { ...cup.tournament, status: "check_in", check_in_until: inMinutes(13) } };
    const state = await mockHallApi(page, { bracket: checkin });
    await openBracket(page);
    await expect(page.getByTestId("tv-checkin-screen")).toBeVisible();
    await expect(page.getByTestId("tv-checkin-count")).toContainText("12");
    await expect(page.getByTestId("tv-checkin-count")).toContainText("von 16 da");
    await expect(page.getByTestId("tv-check-r13")).toHaveAttribute("data-present", "0");
    await page.evaluate(() => { window.__ohneNeuladen = true; });
    const measured = await measure(page);
    expect(measured.small).toEqual([]);
    expect(measured.cut).toEqual([]);
    expect(measured.overflow).toEqual([]);

    // Einchecken: der Haken erscheint sofort.
    state.bracket = { ...checkin, registrations: registrations.map((reg) => (reg.id === "r13" ? { ...reg, status: "checked_in" } : reg)) };
    state.push("tournaments");
    await expect(page.getByTestId("tv-check-r13")).toHaveAttribute("data-present", "1", { timeout: 6000 });
    await expect(page.getByTestId("tv-checkin-count")).toContainText("13");
    // Alle da.
    state.bracket = { ...checkin, registrations: registrations.map((reg) => ({ ...reg, status: "checked_in" })) };
    state.push("tournaments");
    await expect(page.getByTestId("tv-checkin-hint")).toHaveText("Alle da. Gleich geht es los.", { timeout: 6000 });

    // Es geht los: die Wiedergabeliste.
    const live = { ...T.clone(cup), tournament: { ...cup.tournament, status: "live" } };
    state.bracket = live;
    state.push("tournaments");
    await expect(page.getByTestId("tv-tree")).toBeVisible({ timeout: 6000 });

    // Pause bis in zehn Minuten: Countdown.
    state.bracket = { ...live, tournament: { ...live.tournament, status: "paused", paused_until: inMinutes(10) } };
    state.push("tournaments");
    await expect(page.getByTestId("tv-pause-screen")).toHaveAttribute("data-state", "running", { timeout: 6000 });
    await expect(page.getByTestId("tv-pause-countdown")).toContainText(/(09|10):\d{2}/);
    // „Pause bis“ ist vorbei: „Gleich geht es weiter“ statt Minuszeit.
    state.bracket = { ...live, tournament: { ...live.tournament, status: "paused", paused_until: ago(1) } };
    state.push("tournaments");
    await expect(page.getByTestId("tv-pause-headline")).toHaveText("Gleich geht es weiter", { timeout: 6000 });
    await expect(page.getByTestId("tv-pause-countdown")).toHaveCount(0);
    // Ohne Uhrzeit nur „Kurze Pause“.
    state.bracket = { ...live, tournament: { ...live.tournament, status: "paused" } };
    state.push("tournaments");
    await expect(page.getByTestId("tv-pause-headline")).toHaveText("Kurze Pause", { timeout: 6000 });
    expect(await page.evaluate(() => window.__ohneNeuladen)).toBe(true);
  });

  test("#1123: Anmeldung offen - großer QR-Code zur Anmeldung, aus 3 Metern scanbar, freie Plätze", async ({ page }) => {
    test.setTimeout(60_000);
    const cup = T.singleElimination(16, { title: "Abend-Turnier" });
    const bracket = {
      ...cup,
      matches_v2: [],
      registrations: cup.registrations.slice(0, 10).map((reg) => ({ ...reg, status: "approved" })),
      seats: { taken: 10, capacity: 16 },
      tournament: { ...cup.tournament, slug: "abend-turnier", status: "registration_open", registration_enabled: true, start_date: inMinutes(180), max_participants: 16 },
    };
    await mockHallApi(page, { bracket });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openBracket(page);
      await expect(page.getByTestId("tv-registration-screen")).toBeVisible();
      await expect(page.getByTestId("tv-registration-seats")).toHaveText("Noch 6 von 16 Plätzen frei");
      const qr = page.getByTestId("tv-registration-qr");
      await expect(qr.getByTestId("branded-qr-code")).toBeVisible();
      expect(await qr.locator("[data-testid='branded-qr-code']").count()).toBe(1);
      // Aus 3 Metern scanbar: der Code nimmt gut ein Drittel der Bildhöhe ein.
      const box = await qr.boundingBox();
      expect(box.height).toBeGreaterThan(size.height * 0.4);
      const measured = await measure(page);
      expect(measured.small).toEqual([]);
    }
  });

  // ------------------------------------------------------------ #1124 Zahlen, #1125 Sponsoren
  test("#1124/#1125: Zahlen und Sponsor kommen selten - und nie während eines Ergebnisses", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install({ time: new Date("2026-10-10T14:32:00+02:00") });
    const bracket = busyCup({ calls: 0, live: false });
    const state = await mockHallApi(page, { bracket: T.clone(bracket) });
    await openBracket(page, "playlist=tree-3_stats-5&stats_every=1");
    await expect(page.getByTestId("tv-tree")).toBeVisible();
    // In der ersten Minute kommen keine Zahlen - sie kommen höchstens jede Minute (Test-Einstellung).
    for (let step = 0; step < 5; step += 1) {
      await page.clock.runFor(5000);
      expect(await slideOf(page)).toBe("tree");
    }
    expect(await runUntil(page, async () => (await slideOf(page)) === "stats", 45_000)).toBe(true);
    await expect(page.getByTestId("tv-stat-played")).toContainText("von 15");
    await expect(page.getByTestId("tv-stat-played")).toContainText("3");
    // Danach wieder der Baum - und erst nach einer weiteren Minute wieder Zahlen.
    expect(await runUntil(page, async () => (await slideOf(page)) === "tree", 8000)).toBe(true);
    for (let step = 0; step < 8; step += 1) {
      await page.clock.runFor(5000);
      expect(await slideOf(page)).toBe("tree");
    }

    // Ein Ergebnis während der Zahlen: die Zahlen machen Platz, das Ergebnis kommt zuerst.
    expect(await runUntil(page, async () => (await slideOf(page)) === "stats", 30_000)).toBe(true);
    T.decide(bracket, "D");
    state.bracket = T.clone(bracket);
    state.push();
    await expect(page.getByTestId("tv-result-card")).toBeVisible({ timeout: 8000 });
    expect(await slideOf(page)).toBe("tree");
  });

  test("#1125: Sponsor-Moment im Turnierbaum-TV, „präsentiert von“ bis die Runde fertig ist, Laufband nur mit Schalter", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install({ time: new Date("2026-10-10T14:32:00+02:00") });
    const bracket = T.singleElimination(8, { title: "Lions Herbst-Cup" });
    T.play(bracket, ["A", "B", "C"]);
    bracket.tournament.round_sponsors = [{ stage_id: "stage-1", section: "WB", round: 1, sponsor_id: "sp1" }];
    const state = await mockHallApi(page, { bracket: T.clone(bracket) });
    await openBracket(page, "playlist=tree-3_sponsor-4&sponsor_every=1");
    // „Runde 1 präsentiert von“ - Runde 1 läuft noch (Spiel D).
    await expect(page.getByTestId("tv-presented-by")).toContainText("Runde 1");
    await expect(page.getByTestId("sponsor-grid")).toHaveCount(0);
    expect(await runUntil(page, () => page.getByTestId("tv-sponsor-moment").isVisible(), 70_000)).toBe(true);
    await expect(page.getByTestId("tv-sponsor-moment")).toContainText("Unser Partner");
    await expect(page.getByTestId("tv-sponsor-moment")).toContainText("„Lions Herbst-Cup“");
    // Runde 1 fertig: „präsentiert von“ verschwindet.
    T.decide(bracket, "D");
    state.bracket = T.clone(bracket);
    state.push();
    await page.clock.runFor(12_000);
    await expect(page.getByTestId("tv-presented-by")).toHaveCount(0, { timeout: 8000 });
    // Laufband nur mit Schalter; mit „präsentiert von“ aus kein Logo oben.
    state.bracket.tournament.round_sponsors = [{ stage_id: "stage-1", section: "WB", round: 2, sponsor_id: "sp1" }];
    await openBracket(page, "playlist=tree-3&sponsor_ticker=1&sponsor_presented=0");
    await expect(page.getByTestId("sponsor-grid")).toBeVisible();
    await expect(page.getByTestId("tv-presented-by")).toHaveCount(0);
  });

  test("#1125: Event-TV und Fast-Lap-TV - Sponsor-Moment als Einblendung im selben Takt, aus heißt aus", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install({ time: new Date("2026-10-10T14:32:00+02:00") });
    const hall = H.hallEvent({ now: Date.parse("2026-10-10T14:32:00+02:00"), stations: 6 });
    await mockHallApi(page, { event: hall.event, stations: hall.stations, brackets: hall.brackets });
    await page.goto("/display/event/event-1?pixel_shift=0&sponsor_every=1");
    await expect(page.getByTestId("tv-hall")).toBeVisible();
    await page.clock.runFor(30_000);
    await expect(page.getByTestId("tv-sponsor-moment")).toHaveCount(0);
    expect(await runUntil(page, () => page.getByTestId("tv-sponsor-moment").isVisible(), 40_000)).toBe(true);
    await expect(page.getByTestId("tv-sponsor-moment")).toContainText("Lions LAN Herbst");
    expect(await runUntil(page, async () => (await page.getByTestId("tv-sponsor-moment").count()) === 0, 10_000)).toBe(true);
    // Alles aus: keine Sponsoren am TV.
    await page.goto("/display/event/event-1?pixel_shift=0&sponsor_every=1&sponsor_moment=0&sponsor_ticker=0");
    await expect(page.getByTestId("tv-hall")).toBeVisible();
    await page.clock.runFor(130_000);
    await expect(page.getByTestId("tv-sponsor-moment")).toHaveCount(0);
    await expect(page.getByTestId("sponsor-grid")).toHaveCount(0);
  });

  // ------------------------------------------------------------ #1126 Hallen-Tafel
  test("#1126: 6, 12 und 24 Stationen - alle sichtbar oder geblättert, keine fehlt still; nichts zu klein oder abgeschnitten", async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install({ time: new Date("2026-10-10T14:32:00+02:00") });
    const state = await mockHallApi(page, {});
    for (const count of [6, 12, 24]) {
      const hall = H.hallEvent({ now: Date.parse("2026-10-10T14:32:00+02:00"), stations: count });
      Object.assign(state, { event: hall.event, stations: hall.stations, brackets: hall.brackets });
      const sizes = count === 12 ? SIZES : [{ width: 1920, height: 1080 }];
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto("/display/event/event-1?pixel_shift=0");
        await expect(page.getByTestId("tv-station-board")).toBeVisible();
        await page.clock.runFor(1500);
        const pages = Number(await page.getByTestId("tv-station-board").getAttribute("data-pages"));
        const seen = new Set();
        for (let index = 0; index < pages; index += 1) {
          const ids = await page.locator("[data-testid='tv-station']").evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-station")));
          ids.forEach((id) => seen.add(id));
          if (pages > 1) await expect(page.getByTestId("tv-station-page")).toContainText(`Seite ${index + 1}/${pages}`);
          const measured = await measure(page);
          expect(measured.small, `${count} ${size.width}: zu klein`).toEqual([]);
          expect(measured.cut, `${count} ${size.width}: abgeschnitten`).toEqual([]);
          expect(measured.overflow, `${count} ${size.width}: läuft über`).toEqual([]);
          expect(measured.outside, `${count} ${size.width}: außerhalb`).toEqual([]);
          await page.clock.runFor(10_100);
        }
        expect(seen.size, `${count} Stationen bei ${size.width}`).toBe(count);
        if (count === 6) expect(pages).toBe(1);
      }
    }
  });

  test("#1126: Zeitleiste aus den Event-Tagen - „Tag 2 von 3“, „jetzt“ rückt jede Minute weiter, der Schreibfehler ist weg", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install({ time: new Date("2026-10-10T14:32:00+02:00") });
    const hall = H.hallEvent({ now: Date.parse("2026-10-10T14:32:00+02:00"), stations: 12, multiDay: true });
    const state = await mockHallApi(page, { event: hall.event, stations: hall.stations, brackets: hall.brackets });
    await page.goto("/display/event/event-1?pixel_shift=0");
    await expect(page.getByTestId("tv-event-day")).toHaveText(/Tag 2 von 3 · Samstag/);
    await expect(page.getByTestId("tv-plan-clock")).toHaveText("jetzt 14:32");
    const now = page.getByTestId("tv-plan-now");
    const first = Number(await now.getAttribute("data-share"));
    await page.clock.runFor(61_000);
    await expect(page.getByTestId("tv-plan-clock")).toHaveText("jetzt 14:33");
    expect(Number(await now.getAttribute("data-share"))).toBeGreaterThan(first);
    await expect(page.getByTestId("tv-plan-block-t-t1")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("tv-plan-block-t-t3")).toHaveAttribute("data-state", "next");
    await expect(page.getByTestId("tv-next")).toContainText("Check-in ab 17:30 bei der Turnierleitung");
    // Ein leeres Event - richtig geschrieben.
    state.event = { ...hall.event, tournaments: [], f1_challenges: [] };
    await page.goto("/display/event/event-1?pixel_shift=0");
    await expect(page.getByText("Keine verknüpften Turniere oder Fast Laps")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("verknuepft");
  });

  test("#1126: „Bewegung reduzieren“ - Linie und Stationen wechseln ohne Bewegung", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const hall = H.hallEvent({ now: Date.now(), stations: 24 });
    await mockHallApi(page, { event: hall.event, stations: hall.stations, brackets: hall.brackets });
    await page.goto("/display/event/event-1?pixel_shift=0&reduce_motion=1");
    await expect(page.getByTestId("tv-station-board")).toBeVisible();
    await page.waitForTimeout(600);
    expect(await runningAnimations(page)).toBe(0);
    await expect(page.getByTestId("tv-station-page")).toContainText("Seite 1/");
    await expect(page.getByTestId("tv-station-page")).toContainText("Seite 2/", { timeout: 13_000 });
    expect(await runningAnimations(page)).toBe(0);
  });

  // ------------------------------------------------------------ #1127 Fast Lap
  test("#1127: neue Zeit - die Zeile gleitet an ihren Platz mit „persönliche Bestzeit“; Bestzeit - der Moment, dann gleitet sie nach oben", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const board = H.fastLapBoard(10);
    const state = await mockHallApi(page, {
      challenge: { id: "f1-1", slug: "lions-fast-lap", title: "Lions Fast Lap", is_championship: false, tracks: [{ id: "track-1", name: "Spielberg", country: "Österreich" }] },
      board,
    });
    await page.goto("/display/f1/f1-1?pixel_shift=0");
    await expect(page.locator("[data-testid='tv-lap-row'][data-user='u9']")).toBeVisible();
    await page.waitForTimeout(800);
    // Ein Neuladen ohne neue Zeit bewegt nichts.
    state.push("f1");
    await page.waitForTimeout(1200);
    await expect(page.locator("[data-testid^='tv-lap-chip-']")).toHaveCount(0);
    await expect(page.getByTestId("tv-best-moment")).toHaveCount(0);

    // u9 (Platz 9) fährt auf Platz 5: die Zeile gleitet nach oben.
    const row = page.locator("[data-testid='tv-lap-row'][data-user='u9']");
    const from = (await row.boundingBox()).y;
    state.board = H.lap(board, "u9", 81000);
    state.push("f1");
    await expect(page.getByTestId("tv-lap-chip-u9")).toContainText("persönliche Bestzeit", { timeout: 6000 });
    await expect(page.getByTestId("tv-lap-chip-u9")).toContainText("−");
    const positions = [];
    for (let step = 0; step < 10; step += 1) {
      positions.push((await row.boundingBox()).y);
      await page.waitForTimeout(90);
    }
    const to = positions.at(-1);
    expect(to).toBeLessThan(from);
    expect(positions.some((y) => y < from - 2 && y > to + 2), `gleitet: ${positions.join(", ")}`).toBe(true);
    await expect(page.getByTestId("tv-best-moment")).toHaveCount(0);

    // Neue Bestzeit: der Moment zuerst - mit Name, Zeit, Abstand und wer sie vorher hatte -, danach ist sie oben.
    state.board = H.lap(state.board, "u5", 79400);
    state.push("f1");
    const moment = page.getByTestId("tv-best-moment");
    await expect(moment).toBeVisible({ timeout: 6000 });
    await expect(moment).toContainText("Neue Bestzeit!");
    await expect(moment).toContainText("DriftDaniel");
    await expect(moment).toContainText("1:19.400");
    await expect(moment).toContainText("vorher NeonFalke · 1:20.000");
    await expect(page.getByTestId("tv-best-gap")).toHaveText("−0.600 s");
    // Während des Moments steht die alte Liste noch: Platz 1 ist noch NeonFalke.
    await expect(page.locator("[data-testid='tv-podium']").first()).toHaveAttribute("data-user", "u1");
    await expect(moment).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator("[data-testid='tv-podium']").first()).toHaveAttribute("data-user", "u5");
    await expect(page.getByTestId("tv-lap-chip-u5")).toContainText("Neue Bestzeit");
  });

  test("#1127: Strafsekunden und ungültige Zeiten werden einsortiert, lösen aber keinen Bestzeit-Moment aus; alle Plätze über der Fußleiste", async ({ page }) => {
    test.setTimeout(60_000);
    const board = H.fastLapBoard(13);
    const state = await mockHallApi(page, {
      challenge: { id: "f1-1", slug: "lions-fast-lap", title: "Lions Fast Lap", is_championship: false, tracks: [{ id: "track-1", name: "Spielberg" }] },
      board,
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto("/display/f1/f1-1?pixel_shift=0");
      await expect(page.locator("[data-testid='tv-lap-row']").first()).toBeVisible();
      await page.waitForTimeout(900);
      const placement = await page.evaluate(() => {
        const footer = document.querySelector("[data-testid='tv-footer']").getBoundingClientRect();
        return [...document.querySelectorAll("[data-testid='tv-lap-row'], [data-testid='tv-podium']")].every((row) => row.getBoundingClientRect().bottom <= footer.top + 1);
      });
      expect(placement, `${size.width}x${size.height}: unter der Fußleiste`).toBe(true);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/display/f1/f1-1?pixel_shift=0");
    await expect(page.locator("[data-testid='tv-lap-row']").first()).toBeVisible();
    await page.waitForTimeout(600);
    // 78,000 s gefahren plus 1,5 s Strafe: schneller als alle, aber mit Strafe kein Moment.
    state.board = H.lap(board, "u7", 78000, { penalty: 1.5 });
    state.push("f1");
    await expect(page.locator("[data-testid='tv-podium']").first()).toHaveAttribute("data-user", "u7", { timeout: 6000 });
    await page.waitForTimeout(800);
    await expect(page.getByTestId("tv-best-moment")).toHaveCount(0);
    // Die Zeit wird ungültig: wieder heraus - auch das ist kein Moment.
    state.board = H.rankBoard({ ...board, entries: board.entries.filter((entry) => entry.user_id !== "u1") });
    state.push("f1");
    await expect(page.locator("[data-testid='tv-podium']").first()).toHaveAttribute("data-user", "u2", { timeout: 6000 });
    await page.waitForTimeout(800);
    await expect(page.getByTestId("tv-best-moment")).toHaveCount(0);
  });

  test("#1127: Streckenwechsel nach der Einstellung - ein Bestzeit-Moment läuft zu Ende; „Bewegung reduzieren“: Zeilen springen", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const first = H.fastLapBoard(8);
    const second = H.fastLapBoard(6, { trackId: "track-2", trackName: "Monza" });
    const state = await mockHallApi(page, {
      challenge: { id: "f1-1", slug: "lions-fast-lap", title: "Lions Fast Lap", is_championship: true, tracks: [{ id: "track-1", name: "Spielberg" }, { id: "track-2", name: "Monza" }] },
      boards: { "track-1": first, "track-2": second },
    });
    await page.goto("/display/f1/f1-1?pixel_shift=0&track_seconds=20");
    await expect(page.getByTestId("tv-track-name")).toHaveText("Spielberg");
    await page.waitForTimeout(17_500);
    state.boards["track-1"] = H.lap(first, "u4", 79000);
    state.push("f1");
    await expect(page.getByTestId("tv-best-moment")).toBeVisible({ timeout: 4000 });
    // Nach 20 Sekunden wäre der Wechsel dran - der Moment läuft aber noch.
    await page.waitForTimeout(2600);
    await expect(page.getByTestId("tv-track-name")).toHaveText("Spielberg");
    await expect(page.getByTestId("tv-track-name")).toHaveText("Monza", { timeout: 6000 });
    await expect(page.getByTestId("tv-best-moment")).toHaveCount(0);

    // Mit fester Strecke im Link wechselt es nie.
    await page.goto("/display/f1/f1-1?pixel_shift=0&track_seconds=20&track=track-1");
    await expect(page.getByTestId("tv-track-name")).toHaveText("Spielberg");

    // „Bewegung reduzieren“: die Zeile springt an den neuen Platz, der Moment erscheint ohne Bewegung.
    state.boards["track-1"] = first;
    await page.goto("/display/f1/f1-1?pixel_shift=0&track=track-1&reduce_motion=1");
    await expect(page.locator("[data-testid='tv-lap-row'][data-user='u8']")).toBeVisible();
    state.boards["track-1"] = H.lap(first, "u8", 80300);
    state.push("f1");
    await expect(page.getByTestId("tv-lap-chip-u8")).toBeVisible({ timeout: 6000 });
    expect(await runningAnimations(page)).toBe(0);
    state.boards["track-1"] = H.lap(state.boards["track-1"], "u6", 79100);
    state.push("f1");
    await expect(page.getByTestId("tv-best-moment")).toBeVisible({ timeout: 6000 });
    expect(await runningAnimations(page)).toBe(0);
  });
});
