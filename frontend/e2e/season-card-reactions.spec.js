const { test, expect } = require("@playwright/test");
const { activePayload, mockSeason } = require("./seasonQa");

// Jahreszeiten IV (#1087–#1094): Deko an einer Karte reagiert, wenn sich die Karte hebt - nur genau diese Karte, erst
// nach einer Viertelsekunde, nur mit Maus, nie mit „Bewegung reduzieren“. Schnee rutscht ab und wächst nach, ein Netz
// reißt, eine Fledermaus flattert auf; die Deko fährt mit der Karte hoch und wieder herunter. Bilder in SHOT_DIR.

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
