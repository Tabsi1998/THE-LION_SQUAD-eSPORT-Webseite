const { test, expect } = require("@playwright/test");
const { mockTvApi } = require("./fixtures/tvMock");

// TV II, Meilenstein 59 (#1115-#1120): der echte Turnierbaum am Beamer. Bäume mit 8, 16 und 32 Spielern (K.-o.,
// Doppel-K.-o., Durchgänge) bei 1280×720, 1920×1080 und 3840×2160: kein Name abgeschnitten, die Linien treffen die
// Karten, ein passender Baum steht still, ein großer fährt Kamera und bleibt am längsten beim laufenden Spiel.
// Ergebnis-Moment, Fahrt über die Linie bis in den richtigen Platz, Start-Zoom mit Spielzeit, Champion mit goldenem
// Weg, Startaufstellung an der Station. „Bewegung reduzieren“ hält alles still, Ton nur mit Einstellung. Alle Namen
// erfunden; alle Antworten kommen aus dem Test (page.route). Bilder in SHOT_DIR, wenn gesetzt.

const SHOTS = process.env.SHOT_DIR || "";
const SIZES = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }];
const LIMITS = { name: 2, other: 1.4 };
// Nur der Baum: seit Meilenstein 60 zeigt der Turnierbaum-TV eine Wiedergabeliste (#1121) - hier geht es um den Baum.
const TREE = "/display/bracket/t1?key=tv-schluessel&pixel_shift=0&playlist=tree";
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

let T;
test.beforeAll(async () => {
  T = await import("./fixtures/tvBrackets.mjs");
});

async function openTree(page, path = TREE) {
  await page.goto(path);
  await expect(page.getByTestId("tv-tree")).toBeVisible();
  // Messen, Kamera setzen, Linien zeichnen.
  await expect(page.getByTestId("tv-viewport")).not.toHaveAttribute("data-camera", "wait");
  await page.waitForTimeout(900);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Wie der Baum gerade im Bild steht: Kamera, Karten im Bild, Linien an den Karten, Namen ganz, Schrift groß genug. */
function inspectTree(page) {
  return page.evaluate(({ limits }) => {
    const viewport = document.querySelector("[data-testid='tv-viewport']");
    const stage = document.querySelector("[data-testid='tv-tree-stage']");
    const view = viewport.getBoundingClientRect();
    const scale = Number(stage.getAttribute("data-tv-scale") || 1);
    const cards = [...stage.querySelectorAll("[data-tv-card]")].map((element) => ({ id: element.getAttribute("data-tv-card"), rect: element.getBoundingClientRect() }));
    const byId = new Map(cards.map((card) => [card.id, card.rect]));
    const inView = (rect) => rect.left >= view.left - 1 && rect.top >= view.top - 1 && rect.right <= view.right + 1 && rect.bottom <= view.bottom + 1;
    // Linien: Anfang an der rechten Kante der einen Karte, Ende an der linken Kante der nächsten, jeweils auf halber Höhe.
    const badLines = [];
    const paths = [...stage.querySelectorAll("[data-testid='bracket-connectors'] path")];
    for (const path of paths) {
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      const at = (distance) => { const point = path.getPointAtLength(distance); return { x: point.x * matrix.a + matrix.e, y: point.y * matrix.d + matrix.f }; };
      const start = at(0);
      const end = at(length);
      const from = byId.get(path.getAttribute("data-from"));
      const to = byId.get(path.getAttribute("data-to"));
      const tolerance = 3;
      const ok = from && to
        && Math.abs(start.x - from.right) <= tolerance && Math.abs(start.y - (from.top + from.height / 2)) <= tolerance
        && Math.abs(end.x - to.left) <= tolerance && Math.abs(end.y - (to.top + to.height / 2)) <= tolerance;
      if (!ok) badLines.push(`${path.getAttribute("data-from")} → ${path.getAttribute("data-to")}`);
    }
    // Namen: nie „…“, nie breiter als ihr Platz; im Bild mindestens 2 % der Bildhöhe, Nebensachen 1,4 %.
    const cut = [];
    const small = [];
    const height = window.innerHeight;
    for (const element of stage.querySelectorAll("[data-tv-name]")) {
      const rect = element.getBoundingClientRect();
      if (!inView(rect)) continue;
      const style = getComputedStyle(element);
      if (element.textContent.trim().endsWith("…") || style.textOverflow === "ellipsis" || element.scrollWidth > element.clientWidth + 1) cut.push(element.textContent.trim());
    }
    const walker = document.createTreeWalker(stage, window.NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest("[aria-hidden='true']")) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !inView(rect)) continue;
      const min = (element.closest("[data-tv-name]") ? limits.name : limits.other) * height / 100;
      const size = parseFloat(getComputedStyle(element).fontSize) * scale;
      if (size + 0.05 < min) small.push(`${node.textContent.trim()} (${size.toFixed(1)} < ${min.toFixed(1)})`);
    }
    return {
      camera: viewport.getAttribute("data-camera"),
      zoom: Number(stage.getAttribute("data-tv-zoom")),
      cards: cards.length,
      cardsInView: cards.filter((card) => inView(card.rect)).length,
      lines: paths.length,
      badLines,
      cut,
      small,
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    };
  }, { limits: LIMITS });
}

function scenarios() {
  const ko8 = T.singleElimination(8, { bronze: true });
  T.play(ko8, ["A", "B"]);
  T.start(ko8, "C", { station: "PC 3", startedAt: ago(754) });
  const ko16 = T.singleElimination(16);
  T.play(ko16, ["A", "B", "C", "D", "E"]);
  T.start(ko16, "F", { station: "PC 2", startedAt: ago(320) });
  const ko32 = T.singleElimination(32);
  T.play(ko32, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
  T.start(ko32, "M", { station: "PC 1", startedAt: ago(95) });
  const dko8 = T.doubleElimination(8);
  T.play(dko8, ["A", "B", "C", "D"]);
  T.start(dko8, "E", { station: "PC 4", startedAt: ago(1312) });
  const dko16 = T.doubleElimination(16);
  T.play(dko16, ["A", "B", "C", "D", "E", "F", "G", "H"]);
  T.start(dko16, "LA", { station: "PC 5", startedAt: ago(61) });
  const durchgaenge8 = T.heatDoubleElimination();
  T.play(durchgaenge8, ["A"]);
  T.start(durchgaenge8, "B", { station: "PC 3", startedAt: ago(402) });
  const durchgaenge16 = T.heats(16);
  T.play(durchgaenge16, ["A", "B"]);
  T.start(durchgaenge16, "C", { station: "PC 6", startedAt: ago(130) });
  const durchgaenge32 = T.heats(32);
  T.play(durchgaenge32, ["A", "B", "C"]);
  const liga8 = T.league(8);
  T.play(liga8, ["A", "B", "C", "D"]);
  T.start(liga8, "E", { station: "PC 2", startedAt: ago(300) });
  return { ko8, ko16, ko32, dko8, dko16, durchgaenge8, durchgaenge16, durchgaenge32, liga8 };
}

/** Zählt, wie oft die Seite einen Klang-Baukasten anlegt und wie viele Töne sie spielt - ohne echten Ton. */
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

test.describe("Turnierbaum am Beamer (Meilenstein 59)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "TV-Seiten sind für große Bildschirme; die Größen stellt der Test selbst ein");

  test("#1115: 8, 16 und 32 Spieler, K.-o., Doppel-K.-o., Durchgänge und Liga bei drei Auflösungen - kein Name abgeschnitten, die Linien treffen die Karten", async ({ page }) => {
    test.setTimeout(240_000);
    const all = scenarios();
    const state = await mockTvApi(page, { bracket: all.ko8 });
    const seen = {};
    for (const [name, bracket] of Object.entries(all)) {
      state.bracket = bracket;
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await openTree(page);
        const result = await inspectTree(page);
        const label = `${name} ${size.width}x${size.height}`;
        expect(result.cards, `${label}: Karten`).toBe(bracket.matches_v2.length);
        expect(result.badLines, `${label}: Linien treffen die Karten nicht`).toEqual([]);
        expect(result.cut, `${label}: Namen abgeschnitten`).toEqual([]);
        expect(result.small, `${label}: Schrift zu klein`).toEqual([]);
        expect(result.overflowX, `${label}: seitlich gescrollt`).toBeLessThanOrEqual(1);
        // Ein passender Baum steht ganz im Bild; sonst fährt die Kamera und zeigt dabei ganze Karten.
        if (result.camera === "still") expect(result.cardsInView, `${label}: steht still, aber nicht alles im Bild`).toBe(result.cards);
        else expect(result.cardsInView, `${label}: Kamera zeigt nichts`).toBeGreaterThan(0);
        seen[label] = result.camera;
        await shot(page, `nachher-${name}-${size.width}x${size.height}`);
      }
      // Auf jedem Bildschirm gleich: dieselbe Bühne, nur größer oder kleiner.
      expect(new Set(SIZES.map((size) => seen[`${name} ${size.width}x${size.height}`])).size, `${name}: je Auflösung anders`).toBe(1);
    }
    // Kleine Bäume stehen still, große fahren Kamera.
    expect(seen["ko8 1920x1080"]).toBe("still");
    expect(seen["durchgaenge8 1920x1080"]).toBe("still");
    expect(seen["ko32 1920x1080"]).toBe("tour");
  });

  test("#1115: großer Baum - die Kamera fährt über alles und hält am längsten beim laufenden Spiel", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install({ time: new Date("2026-10-10T14:32:00+02:00") });
    await mockTvApi(page, { bracket: scenarios().ko32 });
    await openTree(page);
    await expect(page.getByTestId("tv-viewport")).toHaveAttribute("data-camera", "tour");
    await page.clock.pauseAt(new Date("2026-10-10T14:32:10+02:00"));
    // Gut zwei Minuten Kamerafahrt (eine ganze Runde über den Baum) in halben Sekunden: je Halt, wie lange er dauert und
    // ob das laufende Spiel M ganz im Bild ist.
    const stops = new Map();
    for (let step = 0; step < 300; step += 1) {
      await page.clock.runFor(500);
      const sample = await page.evaluate(() => {
        const element = document.querySelector("[data-testid='tv-tree-stage']");
        const view = document.querySelector("[data-testid='tv-viewport']").getBoundingClientRect();
        const card = document.querySelector("[data-tv-card='m-M']").getBoundingClientRect();
        return {
          moving: element.hasAttribute("data-tv-moving"),
          index: element.getAttribute("data-tv-stop"),
          hold: Number(element.getAttribute("data-tv-hold")),
          view: element.getAttribute("data-tv-view"),
          live: card.left >= view.left && card.right <= view.right && card.top >= view.top && card.bottom <= view.bottom,
        };
      });
      if (sample.moving || sample.index === null) continue;
      const entry = stops.get(sample.index) || { hold: sample.hold, live: sample.live };
      entry.live = entry.live && sample.live;
      stops.set(sample.index, entry);
    }
    const entries = [...stops.values()];
    const longest = Math.max(...entries.map((entry) => entry.hold));
    expect(entries.length, "die Kamera zeigt mehrere Ausschnitte").toBeGreaterThan(2);
    expect(entries.some((entry) => entry.live), "das laufende Spiel kommt ganz ins Bild").toBe(true);
    expect(entries.filter((entry) => entry.hold === longest).every((entry) => entry.live), "am längsten beim laufenden Spiel").toBe(true);
    expect(entries.filter((entry) => !entry.live).every((entry) => entry.hold < longest)).toBe(true);
  });

  test("#1115: ein neuer Stand lässt die Kamera nicht springen - sie bleibt im Halt stehen", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const state = await mockTvApi(page, { bracket: scenarios().ko32 });
    await openTree(page);
    const stage = page.getByTestId("tv-tree-stage");
    // Eine Fahrt abwarten - danach beginnt ein neuer Halt von mehreren Sekunden.
    await expect.poll(() => stage.getAttribute("data-tv-moving"), { timeout: 25_000 }).toBe("1");
    await expect.poll(() => stage.getAttribute("data-tv-moving"), { timeout: 6000 }).toBeNull();
    const view = await stage.getAttribute("data-tv-view");
    const calls = state.calls.bracket;
    const next = T.clone(state.bracket);
    T.find(next, "Q").scheduled_at = "2026-10-10T16:45:00+02:00";
    state.bracket = next;
    state.push();
    await expect.poll(() => state.calls.bracket).toBeGreaterThan(calls);
    await page.waitForTimeout(400);
    expect(await stage.getAttribute("data-tv-view")).toBe(view);
    expect(await stage.getAttribute("data-tv-moving")).toBeNull();
  });

  test("#1115: „Bewegung reduzieren“ - die Kamera wechselt in einem Schritt statt zu fahren", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install({ time: new Date("2026-10-10T14:32:00+02:00") });
    await mockTvApi(page, { bracket: scenarios().ko32 });
    await openTree(page, `${TREE}&reduce_motion=1`);
    await page.clock.pauseAt(new Date("2026-10-10T14:32:10+02:00"));
    const stage = page.getByTestId("tv-tree-stage");
    // 40 Sekunden in Zehntelsekunden: Jeder Wechsel ist ein einziger Schritt - danach steht das Bild wieder.
    const views = [];
    for (let step = 0; step < 400; step += 1) {
      await page.clock.runFor(100);
      views.push(await stage.getAttribute("data-tv-view"));
      expect(await stage.getAttribute("data-tv-moving")).toBeNull();
    }
    const changes = views.map((view, index) => (index && view !== views[index - 1] ? index : -1)).filter((index) => index > 0);
    expect(changes.length).toBeGreaterThan(1);
    for (const index of changes) expect(views[index + 1] ?? views[index]).toBe(views[index]);
    expect(changes.every((index, position) => position === 0 || index - changes[position - 1] > 30)).toBe(true);
  });

  test("#1117/#1118: Ergebnis eintragen - Karte etwa 3 Sekunden, dann fahren die Spieler und landen im richtigen Platz", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await countSound(page);
    const bracket = T.singleElimination(8, { bronze: true });
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page);
    // Beim ersten Laden fährt nichts.
    await expect(page.getByTestId("tv-result-card")).toHaveCount(0);
    await expect(page.getByTestId("tv-rider")).toHaveCount(0);
    await expect(page.locator("[data-tv-slot='m-E:0']")).toContainText("Sieger aus A");

    T.decide(bracket, "A", ["r8", "r1"]);
    state.bracket = T.clone(bracket);
    state.push();
    const card = page.getByTestId("tv-result-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    const shownAt = Date.now();
    await expect(card).toContainText("Spiel A entschieden");
    await expect(page.getByTestId("tv-result-row-r8")).toContainText("weiter");
    await expect(page.getByTestId("tv-result-row-r1")).toContainText("raus");
    // Aus 5 Metern lesbar: jeder Text der Karte mindestens 1,4 % der Bildhöhe, Namen mindestens 2 %.
    const small = await page.evaluate(() => {
      const found = [];
      for (const element of document.querySelectorAll("[data-testid='tv-result-card'] *")) {
        if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()) || element.closest("[aria-hidden='true']")) continue;
        const min = (element.closest("[data-tv-name]") ? 2 : 1.4) * window.innerHeight / 100;
        const size = parseFloat(getComputedStyle(element).fontSize);
        if (size + 0.05 < min) found.push(`${element.textContent.trim()} (${size})`);
      }
      return found;
    });
    expect(small).toEqual([]);
    await page.waitForTimeout(800);
    await shot(page, "moment-ergebnis-1920x1080");
    // Solange die Karte steht, wartet der Platz noch auf seinen Spieler.
    await expect(page.locator("[data-tv-slot='m-E:0']")).toContainText("Sieger aus A");
    await expect(card).toHaveCount(0, { timeout: 6000 });
    const gone = Date.now() - shownAt;
    expect(gone).toBeGreaterThan(2500);
    expect(gone).toBeLessThan(4500);
    // Die Fahrt: SchnellSchnecke fährt von A nach E und landet im ersten Platz von E.
    await expect(page.getByTestId("tv-rider").first()).toBeAttached({ timeout: 3000 });
    await page.waitForTimeout(500);
    await shot(page, "moment-fahrt-1920x1080");
    await expect(page.locator("[data-tv-slot='m-E:0']")).toContainText("SchnellSchnecke", { timeout: 6000 });
    await expect(page.getByTestId("tv-rider")).toHaveCount(0, { timeout: 3000 });
    // Wer ausscheidet, bleibt stehen und wird blasser.
    await expect(page.locator("[data-tv-node='m-A'] [data-tv-reg='r1']")).toHaveClass(/tv-row--out/);
    // Mit der Standard-Einstellung kommt nie ein Ton - nicht einmal ein Klang-Baukasten.
    expect(await page.evaluate(() => window.__tvSound)).toEqual({ contexts: 0, tones: 0 });
    // Danach sieht der Baum genau so aus wie nach einem Neuladen.
    const after = await page.getByTestId("tv-tree").innerText();
    await openTree(page);
    expect(await page.getByTestId("tv-tree").innerText()).toBe(after);
    await expect(page.getByTestId("tv-result-card")).toHaveCount(0);
  });

  test("#1117: Durchgang mit 4 Spielern und 2 Weiterkommern im Doppel-K.-o. - jeder landet in seinem Platz, ins Loser Bracket über die rote Linie", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.heatDoubleElimination();
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page);
    T.decide(bracket, "A", ["r5", "r8", "r1", "r4"]);
    state.bracket = T.clone(bracket);
    state.push();
    await expect(page.getByTestId("tv-result-card")).toBeVisible({ timeout: 5000 });
    for (const [id, label] of [["r5", "weiter"], ["r8", "weiter"], ["r1", "→ Loser Bracket"], ["r4", "→ Loser Bracket"]]) {
      await expect(page.getByTestId(`tv-result-row-${id}`)).toContainText(label);
    }
    await expect(page.getByTestId("tv-result-card")).toHaveCount(0, { timeout: 6000 });
    await expect(page.getByTestId("tv-rider")).toHaveCount(4, { timeout: 3000 });
    await expect(page.locator("[data-tv-drop]")).toHaveCount(2);
    await page.waitForTimeout(700);
    await shot(page, "moment-fahrt-durchgaenge-1920x1080");
    // Wo jeder hinfährt, sagt die Herkunft des Platzes: C bekommt Platz 1 und 2, D Platz 3 und 4 (L:A:1, L:A:2).
    const expected = { "m-C:0": "DriftDaniel", "m-C:1": "SchnellSchnecke", "m-D:0": "NeonFalke", "m-D:1": "PixelPaula" };
    for (const [slot, name] of Object.entries(expected)) await expect(page.locator(`[data-tv-slot='${slot}']`)).toContainText(name, { timeout: 6000 });
    await expect(page.getByTestId("tv-rider")).toHaveCount(0, { timeout: 3000 });
    const after = await page.getByTestId("tv-tree").innerText();
    await openTree(page);
    expect(await page.getByTestId("tv-tree").innerText()).toBe(after);
  });

  test("#1118: mehr als drei Ergebnisse auf einmal kommen als eine Sammelkarte", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.singleElimination(16);
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page);
    T.play(bracket, ["A", "B", "C", "D", "E"]);
    state.bracket = T.clone(bracket);
    state.push();
    const card = page.getByTestId("tv-collective-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("5 Spiele entschieden");
    for (const key of ["A", "B", "C", "D", "E"]) await expect(page.getByTestId(`tv-collective-m-${key}`)).toBeVisible();
    await expect(page.getByTestId("tv-result-card")).toHaveCount(0);
    await page.waitForTimeout(800);
    await shot(page, "moment-sammelkarte-1920x1080");
    await expect(card).toHaveCount(0, { timeout: 8000 });
    // Alle fahren - kurz versetzt, zusammen höchstens etwa 4 Sekunden.
    await expect(page.locator("[data-tv-slot='m-I:0']")).toContainText("NeonFalke", { timeout: 6000 });
    await expect(page.locator("[data-tv-slot='m-K:0']")).toContainText("KartKönigin", { timeout: 6000 });
  });

  test("#1116: Spiel an einer Station starten - Zoom mit „Jetzt live“, zurück zur ganzen Ansicht; Spielzeit stimmt auch nach dem Neuladen", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.singleElimination(8, { bronze: true });
    T.play(bracket, ["A", "B"]);
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page);
    const stage = page.getByTestId("tv-tree-stage");
    await expect(page.getByTestId("tv-viewport")).toHaveAttribute("data-camera", "still");
    const fitZoom = Number(await stage.getAttribute("data-tv-zoom"));

    T.start(bracket, "C", { station: "PC 3", startedAt: ago(5) });
    state.bracket = T.clone(bracket);
    state.push();
    const banner = page.getByTestId("tv-live-banner");
    await expect(banner).toContainText("Jetzt live: Spiel C an PC 3", { timeout: 5000 });
    await expect.poll(async () => Number(await stage.getAttribute("data-tv-zoom")), { timeout: 3000 }).toBeGreaterThan(fitZoom + 0.1);
    await page.waitForTimeout(600);
    await shot(page, "moment-jetzt-live-1920x1080");
    // Etwa 4 Sekunden, dann zurück zum ganzen Baum.
    await expect(banner).toHaveCount(0, { timeout: 6000 });
    await expect.poll(async () => Number(await stage.getAttribute("data-tv-zoom")), { timeout: 3000 }).toBeCloseTo(fitZoom, 2);
    // Station und Spielzeit, sekundengenau.
    const clock = page.getByTestId("tv-spot-clock-m-C");
    const first = await clock.textContent();
    await page.waitForTimeout(1300);
    expect(await clock.textContent()).not.toBe(first);
    await expect(page.getByTestId("tv-spot-m-C")).toContainText("PC 3");
    // Nach dem Neuladen: kein Zoom, aber dieselbe Zeit aus der Startzeit.
    state.bracket.matches_v2.find((match) => match.id === "m-C").started_at = ago(754);
    await openTree(page);
    await expect(page.getByTestId("tv-live-banner")).toHaveCount(0);
    await expect(clock).toHaveText(/^12:3\d$/);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("tv-live-banner")).toHaveCount(0);
    // Ohne Startzeit (ohne Station gestartet) steht nur „Live“.
    T.start(bracket, "D", { station: null, startedAt: null });
    state.bracket = T.clone(bracket);
    await openTree(page);
    await expect(page.getByTestId("tv-spot-m-D")).toHaveText("Live");
  });

  test("#1116: der Zoom kommt nicht während eines anderen Moments - erst das Ergebnis, dann der Start", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.singleElimination(8, { bronze: true });
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page);
    T.decide(bracket, "A");
    T.start(bracket, "C", { station: "PC 1", startedAt: ago(1) });
    state.bracket = T.clone(bracket);
    state.push();
    await expect(page.getByTestId("tv-result-card")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("tv-live-banner")).toHaveCount(0);
    await expect(page.getByTestId("tv-result-card")).toHaveCount(0, { timeout: 6000 });
    await expect(page.getByTestId("tv-live-banner")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("tv-rider")).toHaveCount(0);
  });

  test("#1119: Finale eintragen - goldener Weg, Siegerkarte mit Konfetti, geparkt ohne einen Namen zu verdecken; nach dem Neuladen gleich das Endbild", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.singleElimination(8, { bronze: true });
    T.play(bracket, ["A", "B", "C", "D", "E", "F", "H"]);
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page);
    await expect(page.getByTestId("tv-champion-parked")).toHaveCount(0);
    T.decide(bracket, "G");
    state.bracket = T.clone(bracket);
    state.push();
    // Der Weg leuchtet Linie für Linie: A → E → G.
    await expect(page.locator("[data-testid='tv-gold-path'][data-drawn='1']")).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator("[data-testid='tv-gold-path'][data-drawn='1']")).toHaveCount(2, { timeout: 3000 });
    const card = page.getByTestId("tv-champion");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("NeonFalke");
    await expect(card).toContainText("Lions Herbst-Cup");
    await expect(card).toContainText("Platz 2: KartKönigin");
    await expect(page.getByTestId("tv-confetti")).toBeVisible();
    await page.waitForTimeout(900);
    await shot(page, "moment-champion-1920x1080");
    for (const id of ["m-A", "m-E", "m-G"]) await expect(page.locator(`[data-tv-node='${id}'] [data-tv-reg='r1']`)).toHaveClass(/tv-row--gold/);
    // Danach parkt die Karte in einer freien Ecke - sie verdeckt keinen Namen.
    const parked = page.getByTestId("tv-champion-parked");
    await expect(parked).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("tv-confetti")).toHaveCount(0);
    const covers = () => page.evaluate(() => {
      const box = document.querySelector("[data-testid='tv-champion-parked']").getBoundingClientRect();
      return [...document.querySelectorAll("[data-testid='tv-tree-stage'] [data-tv-name]")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
      }).map((element) => element.textContent);
    });
    expect(await covers()).toEqual([]);
    await page.waitForTimeout(700);
    await shot(page, "moment-champion-geparkt-1920x1080");
    // Nach dem Neuladen steht gleich das Endbild - ohne Konfetti, der Moment kommt nur einmal.
    await openTree(page);
    await expect(page.getByTestId("tv-champion-parked")).toBeVisible();
    await expect(page.getByTestId("tv-champion")).toHaveCount(0);
    await expect(page.getByTestId("tv-confetti")).toHaveCount(0);
    await expect(page.locator("[data-testid='tv-gold-path'][data-drawn='1']")).toHaveCount(2);
    expect(await covers()).toEqual([]);
  });

  test("#1119: Doppel-K.-o. - der Sieger kommt über das Loser Bracket zurück, der goldene Weg führt durch beide Blöcke", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.doubleElimination(8);
    T.play(bracket, ["A", "B", "C", "D"]);
    T.decide(bracket, "E", ["r4", "r1"]);
    T.play(bracket, ["F", "G", "LA", "LB", "LC", "LD", "LE", "LF"]);
    T.decide(bracket, "GF", ["r1", "r2"]);
    await mockTvApi(page, { bracket });
    await openTree(page);
    // Nach dem Laden gleich das Endbild: fünf goldene Strecken A → E → LC → LE → LF → GF.
    await expect(page.locator("[data-testid='tv-gold-path'][data-drawn='1']")).toHaveCount(5);
    for (const id of ["m-A", "m-E", "m-LC", "m-LE", "m-LF", "m-GF"]) await expect(page.locator(`[data-tv-node='${id}'] [data-tv-reg='r1']`)).toHaveClass(/tv-row--gold/);
    await expect(page.getByTestId("tv-champion-parked")).toBeVisible();
    await expect(page.getByTestId("tv-confetti")).toHaveCount(0);
    await shot(page, "endbild-champion-doppel-ko-1920x1080");
  });

  test("„Bewegung reduzieren“: keine Fahrt, kein Zoom, kein Konfetti - Namen stehen sofort am neuen Platz", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.singleElimination(8, { bronze: true });
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page, `${TREE}&reduce_motion=1`);
    await expect(page.getByTestId("tv-screen")).toHaveAttribute("data-tv-motion", "off");
    const stage = page.getByTestId("tv-tree-stage");
    const zoom = await stage.getAttribute("data-tv-zoom");
    T.decide(bracket, "A");
    T.start(bracket, "B", { station: "PC 2", startedAt: ago(2) });
    state.bracket = T.clone(bracket);
    state.push();
    await expect(page.getByTestId("tv-result-card")).toBeVisible({ timeout: 5000 });
    // Der Name steht schon am neuen Platz, während die Karte noch da ist.
    await expect(page.locator("[data-tv-slot='m-E:0']")).toContainText("NeonFalke");
    const running = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length);
    expect(running).toBe(0);
    await expect(page.getByTestId("tv-result-card")).toHaveCount(0, { timeout: 6000 });
    await expect(page.getByTestId("tv-rider")).toHaveCount(0);
    // Der Start: „Jetzt live“ steht da, aber die Kamera zoomt nicht.
    await expect(page.getByTestId("tv-live-banner")).toBeVisible({ timeout: 5000 });
    expect(await stage.getAttribute("data-tv-zoom")).toBe(zoom);
    await expect(page.getByTestId("tv-live-banner")).toHaveCount(0, { timeout: 7000 });
    // Das Finale: kein Konfetti, Weg und Karte erscheinen ohne Bewegung.
    T.play(bracket, ["B", "C", "D", "E", "F", "H", "G"]);
    state.bracket = T.clone(bracket);
    state.push();
    await expect(page.getByTestId("tv-champion")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("tv-confetti")).toHaveCount(0);
    await expect(page.locator("[data-testid='tv-gold-path'][data-drawn='1']")).toHaveCount(2);
    await expect(page.getByTestId("tv-champion-parked")).toBeVisible({ timeout: 8000 });
  });

  test("#1118: Ton beim Ergebnis im Link - einmal „Für Ton einmal klicken“, danach ein Gong", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await countSound(page);
    // Ein TV, an dem noch niemand geklickt hat (Playwright zählt sein Öffnen der Seite sonst als Klick).
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "userActivation", { configurable: true, value: { hasBeenActive: false, isActive: false } });
    });
    const bracket = T.singleElimination(8);
    const state = await mockTvApi(page, { bracket: T.clone(bracket) });
    await openTree(page, `${TREE}&result_sound=1`);
    expect(await page.evaluate(() => window.__tvSound.contexts)).toBe(0);
    await expect(page.getByTestId("tv-sound-hint")).toHaveText("Für Ton einmal klicken");
    await page.mouse.click(400, 400);
    await expect(page.getByTestId("tv-sound-hint")).toHaveCount(0);
    T.decide(bracket, "A");
    state.bracket = T.clone(bracket);
    state.push();
    await expect(page.getByTestId("tv-result-card")).toBeVisible({ timeout: 5000 });
    await expect.poll(() => page.evaluate(() => window.__tvSound.tones)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__tvSound.contexts)).toBe(1);
  });

  test("#1120: Stations-Ansicht - Startaufstellung mit 4 Spielern, nach dem Ergebnis weiter / Loser Bracket; 8 Spieler passen", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const bracket = T.heatDoubleElimination();
    T.play(bracket, ["A"]);
    T.start(bracket, "B", { station: "PC 3", startedAt: ago(402) });
    const stations = [{ id: "st-pc-3", name: "PC 3", tournament_id: "t1", status: "busy", current_match_id: "m-B" }, { id: "st-pc-4", name: "PC 4", tournament_id: "t1", status: "free" }];
    const state = await mockTvApi(page, { bracket: T.clone(bracket), stations });
    await page.goto("/display/bracket/t1/station/st-pc-3?key=tv-schluessel&pixel_shift=0");
    const view = page.getByTestId("station-tv");
    await expect(view).toContainText("PC 3");
    await expect(page.getByTestId("station-tv-match")).toHaveAttribute("data-mode", "live");
    await expect(page.getByTestId("station-tv-match")).toContainText("Durchgang B");
    const grid = page.getByTestId("tv-start-grid");
    await expect(grid).toHaveAttribute("data-decided", "0");
    // Versetztes Raster: Startplatz 1 links vorn, 2 rechts dahinter.
    const place = async (id) => page.getByTestId(`tv-grid-slot-${id}`).boundingBox();
    const [first, second, third] = [await place("r2"), await place("r3"), await place("r6")];
    expect(second.x).toBeGreaterThan(first.x + first.width / 2);
    expect(second.y).toBeGreaterThan(first.y);
    expect(third.y).toBeGreaterThan(first.y + first.height / 2);
    await expect(page.getByTestId("tv-spot-m-B")).toContainText("PC 3");
    await page.waitForTimeout(400);
    await shot(page, "station-startaufstellung-4-1920x1080");

    T.decide(bracket, "B", ["r7", "r3", "r2", "r6"]);
    state.bracket = T.clone(bracket);
    state.stations = [{ ...stations[0], status: "free", current_match_id: null }, stations[1]];
    state.push();
    await expect(page.getByTestId("station-tv-match")).toHaveAttribute("data-mode", "done", { timeout: 5000 });
    await expect(grid).toHaveAttribute("data-decided", "1");
    for (const [id, label] of [["r7", "weiter"], ["r3", "weiter"], ["r2", "→ Loser Bracket"], ["r6", "→ Loser Bracket"]]) {
      await expect(page.getByTestId(`tv-grid-label-${id}`)).toHaveText(label);
    }
    // Die Weiterkommer stehen vorn (so viele, wie der Durchgang einstellt), die anderen rutschen zur Seite.
    await page.waitForTimeout(1000);
    const winner = await place("r7");
    const out = await place("r2");
    expect(winner.y).toBeLessThan(out.y);
    expect(await page.locator("[data-testid^='tv-grid-label-']", { hasText: "weiter" }).count()).toBe(2);
    await shot(page, "station-ergebnis-4-1920x1080");

    // 6 und 8 Spieler in zwei versetzten Reihen - alles im Bild, nichts abgeschnitten.
    const six = T.heats(6, { size: 6, qualifiers: 2 });
    T.start(six, "A", { station: "PC 3", startedAt: ago(30) });
    state.bracket = six;
    state.stations = stations;
    // „Bewegung reduzieren“: die Plätze wechseln ohne Fahrt.
    await page.goto("/display/bracket/t1/station/st-pc-3?key=tv-schluessel&pixel_shift=0&reduce_motion=1");
    await expect(page.getByTestId("tv-start-grid")).toBeVisible();
    expect(await page.getByTestId("tv-grid-slot-r1").evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
    await page.goto("/display/bracket/t1/station/st-pc-3?key=tv-schluessel&pixel_shift=0");
    await expect(page.locator("[data-testid^='tv-grid-slot-']")).toHaveCount(6);
    expect(await page.getByTestId("tv-grid-slot-r1").evaluate((element) => getComputedStyle(element).transitionDuration)).not.toBe("0s");
    await page.waitForTimeout(400);
    await shot(page, "station-startaufstellung-6-1920x1080");
    const eight = T.heats(8, { size: 8, qualifiers: 2 });
    T.start(eight, "A", { station: "PC 3", startedAt: ago(30) });
    state.bracket = eight;
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto("/display/bracket/t1/station/st-pc-3?key=tv-schluessel&pixel_shift=0");
      await expect(page.getByTestId("tv-start-grid")).toBeVisible();
      await page.waitForTimeout(500);
      const fits = await page.evaluate(() => {
        const body = document.querySelector("[data-testid='tv-start-grid']").getBoundingClientRect();
        return [...document.querySelectorAll("[data-testid^='tv-grid-slot-']")].every((slot) => {
          const rect = slot.getBoundingClientRect();
          const name = slot.querySelector("[data-tv-name]");
          return rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1 && rect.left >= body.left - 1 && rect.right <= body.right + 1
            && (!name || name.scrollWidth <= name.clientWidth + 1);
        });
      });
      expect(fits, `${size.width}x${size.height}: abgeschnitten`).toBe(true);
      expect(await page.locator("[data-testid^='tv-grid-slot-']").count()).toBe(8);
      await shot(page, `station-startaufstellung-8-${size.width}x${size.height}`);
    }
  });
});
