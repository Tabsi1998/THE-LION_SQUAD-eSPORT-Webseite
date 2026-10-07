const { test, expect } = require("@playwright/test");
const { activePayload, mockSeason } = require("./seasonQa");

// Jahreszeiten IV (#1087–#1094): Deko an einer Karte reagiert, wenn sich die Karte hebt - nur genau diese Karte, erst
// nach einer Viertelsekunde, nur mit Maus, nie mit „Bewegung reduzieren“. Schnee rutscht ab und wächst nach, ein Netz
// reißt, eine Fledermaus flattert auf; die Deko fährt mit der Karte hoch und wieder herunter. Variante B (#1091–#1094):
// Lichterkette, Osterei, Luftschlange und Wimpelkette sitzen zusätzlich an einigen Karten und reagieren dort - die Kette
// schwingt nach, das Ei wackelt und rollt, Luftschlange und Wimpel flattern einmal durch. Bilder in SHOT_DIR.

const SHOTS = process.env.SHOT_DIR || "";
const snow = { key: "snow", label: "Schnee", phase: "schnee", intensity: "full", channels: ["web", "app"], texts: {}, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false, data: { night: false, snowcap_stage: 3 } };
const halloween = { key: "halloween", phase: "deko", intensity: "full", channels: ["web", "app"], texts: { greeting: "Happy Halloween" }, data: { night: true }, starts_at: "", ends_at: "" };

/** Die Mitte einer Karte unter einem Deko-Element (Seitenkoordinaten sind egal - die Maus nimmt Fenster). */
async function cardUnder(page, selector) {
  return page.evaluate((sel) => {
    const deco = [...document.querySelectorAll(sel)].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top > 80 && rect.bottom < window.innerHeight - 80;
    });
    if (!deco) return null;
    const box = deco.getBoundingClientRect();
    const probeX = box.left + Math.min(box.width / 2, 40);
    const probeY = box.bottom + 24;
    const card = document.elementsFromPoint(probeX, probeY).find((node) => node.matches?.(".tls-card[data-season-anchor='card'], .tls-card[data-season-perch='card']"));
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, key: deco.getAttribute("data-season-card") };
  }, selector);
}

async function settle(page, selector) {
  await expect.poll(async () => page.locator(selector).count(), { timeout: 10000 }).toBeGreaterThan(0);
  await page.waitForTimeout(600);
}

test.describe("Jahreszeiten IV: Deko reagiert auf Karten", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "nur mit Maus");

  test("Schnee: die Haube dieser Karte rutscht ab, fährt mit und wächst nach - die Nachbarn behalten ihren Schnee", async ({ page }) => {
    await mockSeason(page, activePayload({ season: snow, now: "2026-12-07T18:00:00+01:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/events");
    await settle(page, "[data-testid='snow-cap'][data-season-card]");
    const target = await cardUnder(page, "[data-testid='snow-cap'][data-season-card]");
    expect(target, "eine Karte mit Haube im Bild").not.toBeNull();
    const mine = page.locator(`[data-testid='snow-cap'][data-season-card='${target.key}']`);
    const others = page.locator(`[data-testid='snow-cap'][data-season-card]:not([data-season-card='${target.key}'])`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/schnee-vorher.png` });

    // Drüberwischen löst nichts aus.
    await page.mouse.move(target.x, target.y);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await expect(page.locator("[data-testid='snow-shake']")).toHaveCount(0);

    await page.mouse.move(target.x, target.y);
    await expect(mine.first()).toHaveAttribute("data-season-lifted", "");
    await expect(mine.first()).toHaveAttribute("data-shake", /drop|grow/);
    await expect(page.locator("[data-testid='snow-shake']")).toHaveCount(1);
    await expect(others.filter({ has: page.locator("xpath=self::*[@data-shake]") })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/schnee-faellt.png` });
    await expect(mine.first()).toHaveAttribute("data-shake", "grow", { timeout: 2000 });
    // Die Flocken sind nach spätestens zwei Sekunden weg; die Haube bleibt beim Nachwachsen.
    await expect(page.locator("[data-testid='snow-shake']")).toHaveCount(0, { timeout: 3000 });

    await page.mouse.move(5, 5);
    await expect(mine.first()).not.toHaveAttribute("data-season-lifted", "");
    await expect(mine.first()).toHaveAttribute("data-shake", "grow");
    // Gleich noch einmal: Ruhezeit je Karte - kein zweites Abschütteln.
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(500);
    await expect(page.locator("[data-testid='snow-shake']")).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/schnee-nachher.png` });
  });

  test("Halloween: das Netz dieser Karte reißt, die Spinne seilt sich ab; Fledermäuse flattern auf", async ({ page }) => {
    await mockSeason(page, activePayload({ season: halloween, now: "2026-10-28T20:00:00+01:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/events");
    await settle(page, "[data-testid='halloween-corner-web']");
    const web = await cardUnder(page, "[data-testid='halloween-corner-web'][data-season-card]");
    test.skip(!web, "kein Netz an einer Karte im Bild");
    const net = page.locator(`[data-testid='halloween-corner-web'][data-season-card='${web.key}']`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/netz-vorher.png` });
    await page.mouse.move(web.x, web.y);
    await expect(net.first()).toHaveAttribute("data-tear", "tear");
    await expect(page.locator("[data-testid='halloween-corner-spider-rappel']")).toHaveCount(1);
    await page.waitForTimeout(700);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/netz-reisst.png` });
    await expect(net.first()).toHaveAttribute("data-tear", "gone", { timeout: 4000 });
    await page.mouse.move(5, 5);

    const bat = await cardUnder(page, "[data-testid='halloween-bat-hanging'][data-season-card]");
    if (bat) {
      const hanging = page.locator(`[data-testid='halloween-bat-hanging'][data-season-card='${bat.key}']`);
      await page.mouse.move(bat.x, bat.y);
      await expect(hanging.first()).toHaveAttribute("data-flutter", "1");
      await expect(hanging.first()).not.toHaveAttribute("data-flutter", "1", { timeout: 3000 });
      await expect(hanging.first()).toHaveAttribute("data-state", /perched|alert/);
    }
  });

  test("„Bewegung reduzieren“: nichts reagiert, nichts fährt mit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockSeason(page, activePayload({ season: snow, now: "2026-12-07T18:00:00+01:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/events");
    await settle(page, "[data-testid='snow-cap'][data-season-card]");
    const target = await cardUnder(page, "[data-testid='snow-cap'][data-season-card]");
    expect(target).not.toBeNull();
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(600);
    await expect(page.locator("[data-testid='snow-shake']")).toHaveCount(0);
    await expect(page.locator("[data-season-lifted]")).toHaveCount(0);
    await expect(page.locator("[data-shake]")).toHaveCount(0);
  });
});

const christmas = { key: "christmas", label: "Weihnachten", phase: "gruss", intensity: "full", channels: ["web", "app"], texts: { greeting: "Frohe Weihnachten" }, starts_at: "2026-12-24T00:00:00+01:00", ends_at: "2026-12-26T23:59:59+01:00", forced: false, data: {} };
const easter = { key: "easter", label: "Ostern", phase: "deko", intensity: "full", channels: ["web", "app"], texts: { greeting: "Frohe Ostern" }, starts_at: "2027-03-21T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", forced: false, data: { quiet: false, sunday: "2027-03-28" } };
const carnival = { key: "carnival", label: "Fasching", phase: "deko", intensity: "full", channels: ["web", "app"], texts: { greeting: "Schönen Fasching" }, starts_at: "2027-02-09T00:00:00+01:00", ends_at: "2027-02-09T23:59:59+01:00", forced: false, data: {} };
const birthday = { key: "club_birthday", label: "Vereinsgeburtstag", phase: "feier", intensity: "full", channels: ["web", "app"], texts: { greeting: "8 Jahre THE LION SQUAD" }, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "2027-03-01T23:59:59+01:00", forced: false, data: { years: 8, founded_on: "2019-03-01" } };

/** Grüße und Konfetti-Regen gelten heute als gesehen - sie lägen sonst über den Karten. */
async function quietGreetings(page) {
  await page.addInitScript(() => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    ["christmas-gruss", "carnival-greeting", "club-birthday-greeting", "easter-greeting"].forEach((key) => window.localStorage.setItem(`tls-season-toast-${key}`, day));
    ["tls-carnival-rain", "tls-carnival-unfold", "tls-birthday-unfold"].forEach((key) => window.localStorage.setItem(key, day));
  });
}

/** Eine Deko an einer Karte im Bild und wohin die Maus muss, um genau diese Karte zu heben. */
async function decoCard(page, selector) {
  return page.evaluate((sel) => {
    const cards = ".tls-card[data-season-anchor='card'], .tls-card[data-season-perch='card']";
    for (const deco of document.querySelectorAll(sel)) {
      const rect = [deco, ...deco.querySelectorAll("*")].map((node) => node.getBoundingClientRect()).find((r) => r.width > 0 && r.height > 0);
      if (!rect || rect.top < 90 || rect.bottom > window.innerHeight - 40) continue;
      const probes = [[rect.left + rect.width / 2, rect.top + rect.height / 2], [rect.left + rect.width / 2, rect.bottom + 8]];
      const card = probes.map(([x, y]) => document.elementsFromPoint(x, y).find((node) => node.matches?.(cards))).find(Boolean);
      if (!card) continue;
      const box = card.getBoundingClientRect();
      return { key: deco.getAttribute("data-season-card"), x: box.left + box.width / 2, y: Math.max(box.top + 24, Math.min(box.bottom - 24, window.innerHeight - 60)) };
    }
    return null;
  }, selector);
}

async function open(page, season, now) {
  await quietGreetings(page);
  await mockSeason(page, activePayload({ season, now }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/events");
}

test.describe("Jahreszeiten IV, Variante B: Deko zusätzlich an Karten", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "nur mit Maus");

  test("Lichterkette (#1091): schwingt nur an der gehobenen Karte nach, ein Licht flackert; beim Loslassen in klein; Ruhezeit", async ({ page }) => {
    await open(page, christmas, "2026-12-24T18:00:00+01:00");
    await settle(page, "[data-testid='christmas-card-chain'][data-season-card]");
    const target = await decoCard(page, "[data-testid='christmas-card-chain'][data-season-card]");
    expect(target, "eine Karte mit Kette im Bild").not.toBeNull();
    const mine = page.locator(`[data-testid='christmas-card-chain'][data-season-card='${target.key}']`);
    const others = page.locator(`[data-testid='christmas-card-chain'][data-season-card]:not([data-season-card='${target.key}'])`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/kette-vorher.png` });
    // Drüberwischen löst nichts aus.
    await page.mouse.move(target.x, target.y);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await expect(page.locator("[data-testid='christmas-card-chain'][data-swing]")).toHaveCount(0);

    await page.mouse.move(target.x, target.y);
    await expect(mine).toHaveAttribute("data-season-lifted", "");
    await expect(mine).toHaveAttribute("data-swing", "lift");
    await expect(mine.locator("[data-blink='1']")).toHaveCount(1);
    await expect(others.and(page.locator("[data-swing]"))).toHaveCount(0);
    await page.waitForTimeout(250);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/kette-schwingt.png` });
    await expect(mine).not.toHaveAttribute("data-swing", "lift", { timeout: 2000 });
    await page.mouse.move(5, 5);
    await expect(mine).toHaveAttribute("data-swing", "leave");
    await expect(mine).not.toHaveAttribute("data-season-lifted", "");
    await expect(mine).not.toHaveAttribute("data-swing", /./, { timeout: 2000 });
    // Gleich noch einmal: zehn Sekunden Ruhe je Karte.
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(500);
    await expect(mine).not.toHaveAttribute("data-swing", /./);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/kette-nachher.png` });
  });

  test("Osterei (#1092): wackelt, rollt höchstens sechs Pixel zur Ecke und bleibt dort liegen", async ({ page }) => {
    await open(page, easter, "2027-03-24T11:00:00+01:00");
    await settle(page, "[data-testid='easter-card-egg'][data-season-card]");
    const target = await decoCard(page, "[data-testid='easter-card-egg'][data-season-card]");
    expect(target, "eine Karte mit Ei im Bild").not.toBeNull();
    const egg = page.locator(`[data-testid='easter-card-egg'][data-season-card='${target.key}']`);
    const left = async () => egg.locator(".tls-card-egg__body").evaluate((node) => node.getBoundingClientRect().left);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ei-vorher.png` });
    const before = await left();
    await page.mouse.move(target.x, target.y);
    await expect(egg).toHaveAttribute("data-roll", "1");
    await expect(egg).toHaveAttribute("data-season-lifted", "");
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ei-wackelt.png` });
    await expect(egg).not.toHaveAttribute("data-roll", "1", { timeout: 2000 });
    const offset = Number(await egg.getAttribute("data-offset"));
    expect(Math.abs(offset)).toBeGreaterThan(0);
    expect(Math.abs(offset)).toBeLessThanOrEqual(6);
    await page.mouse.move(5, 5);
    await expect(egg).not.toHaveAttribute("data-season-lifted", "");
    await page.waitForTimeout(400);
    // Es liegt dort, wohin es gerollt ist - genau um den Versatz verschoben.
    expect(Math.abs((await left()) - before - offset)).toBeLessThan(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ei-nachher.png` });
  });

  test("Luftschlange (#1093) und Wimpelkette (#1094): flattern einmal durch, nur an der gehobenen Karte", async ({ page }) => {
    await open(page, carnival, "2027-02-09T15:00:00+01:00");
    await settle(page, "[data-testid='carnival-card-streamer'][data-season-card]");
    const streamer = await decoCard(page, "[data-testid='carnival-card-streamer'][data-season-card]");
    expect(streamer, "eine Karte mit Luftschlange im Bild").not.toBeNull();
    const mine = page.locator(`[data-testid='carnival-card-streamer'][data-season-card='${streamer.key}']`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/luftschlange-vorher.png` });
    await page.mouse.move(streamer.x, streamer.y);
    await expect(mine).toHaveAttribute("data-flutter", "1");
    await expect(page.locator(`[data-testid='carnival-card-streamer'][data-flutter]:not([data-season-card='${streamer.key}'])`)).toHaveCount(0);
    await page.waitForTimeout(200);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/luftschlange-flattert.png` });
    await expect(mine).not.toHaveAttribute("data-flutter", "1", { timeout: 2000 });
    await page.mouse.move(5, 5);

    await open(page, birthday, "2027-03-01T11:00:00+01:00");
    await settle(page, "[data-testid='birthday-card-garland'][data-season-card]");
    const garland = await decoCard(page, "[data-testid='birthday-card-garland'][data-season-card]");
    expect(garland, "eine Karte mit Wimpeln im Bild").not.toBeNull();
    const pennants = page.locator(`[data-testid='birthday-card-garland'][data-season-card='${garland.key}']`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wimpel-vorher.png` });
    await page.mouse.move(garland.x, garland.y);
    await expect(pennants).toHaveAttribute("data-flutter", "1");
    await expect(page.locator(`[data-testid='birthday-card-garland'][data-flutter]:not([data-season-card='${garland.key}'])`)).toHaveCount(0);
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wimpel-flattern.png` });
    await expect(pennants).not.toHaveAttribute("data-flutter", "1", { timeout: 2000 });
  });

  test("„Bewegung reduzieren“: die Deko an Karten hängt, aber nichts schwingt, rollt oder flattert", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, christmas, "2026-12-24T18:00:00+01:00");
    await settle(page, "[data-testid='christmas-card-chain'][data-season-card]");
    const target = await decoCard(page, "[data-testid='christmas-card-chain'][data-season-card]");
    expect(target).not.toBeNull();
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(600);
    await expect(page.locator("[data-swing]")).toHaveCount(0);
    await expect(page.locator("[data-season-lifted]")).toHaveCount(0);
  });
});
