const { test, expect } = require("@playwright/test");
const { activePayload, defineSeasonQa, mockSeason } = require("./seasonQa");

// Silvester (S9 #640, N1–N6 #739–#744) über den Abnahme-Standard (C6, seasonQa.js): in der Show kein Überlauf, keine
// Deko über Text (das Feuerwerk liegt auf der Himmelsfläche, Countdown und Gruß sind Karten), Reduced Motion ohne
// Raketen und ohne Bewegung, Saison aus = nichts. Dazu der Countdown nach der Serveruhr bis zum Gruß um 00:00 und
// die neue Jahreszahl aus Funken (#853) - bei „Bewegung reduzieren“ ruhig, ohne Salve.

const SHOTS = process.env.SHOT_DIR || "";

function newYear(phase, overrides = {}) {
  return { key: "new_year", label: "Silvester", phase, intensity: "full", channels: ["web", "app"], texts: { greeting: "Frohes neues Jahr wünscht THE LION SQUAD" }, starts_at: "2026-12-29T18:00:00+01:00", ends_at: "2027-01-01T23:59:59+01:00", forced: false, data: { seed: 2027000, salvos: [5, 9, 14, 20, 26, 33, 41, 50], rate_per_hour: { min: 720, max: 1440 }, show_start: "2027-01-01T00:00:00+01:00" }, ...overrides };
}

defineSeasonQa({
  title: "Silvester: Abnahme auf Hauptseiten und Breakpoints",
  seasonKey: "new_year",
  now: "2027-01-01T00:00:03+01:00",
  season: newYear("show"),
  pieces: "[data-testid='new-year-widget']",
  // Das Kopf-Element zählt mit seinem eigenen Knopf nicht als Untergrund - geprüft wird, dass es nichts anderes verdeckt.
  layers: "[data-testid='new-year-widget'], [data-testid='new-year-countdown'], [data-testid='new-year-zero'], [data-testid='new-year-toast']",
  offPieces: "[data-testid^='new-year-']",
  settleMs: 2500,
  countPieces: () => ({ widgets: document.querySelectorAll("[data-testid='new-year-widget']").length }),
  mobileLimits: (counts, viewport, path) => {
    expect(counts.widgets, `höchstens ein Silvester-Platz im Kopf (${path}, ${viewport.width}px)`).toBeLessThanOrEqual(1);
  },
  reducedMotionState: () => ({
    animated: [...document.querySelectorAll(".tls-ny-countdown, .tls-ny-countdown *, .tls-ny-toast, .tls-ny-toast *, .tls-ny-year")].filter((el) => getComputedStyle(el).animationName !== "none").length,
  }),
  reducedMotion: (state) => {
    expect(state.animated).toBe(0);
  },
});

test.describe("Silvester: Countdown und Gruß", () => {
  test("Countdown nach der Serveruhr: ruhig, Puls in den letzten zehn Sekunden, um 00:00 der Gruß; Ton aus", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await mockSeason(page, activePayload({ season: newYear("countdown"), now: "2026-12-31T23:59:45+01:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const countdown = page.getByTestId("new-year-countdown");
    await expect(countdown).toBeVisible({ timeout: 8000 });
    await expect(countdown).toHaveAttribute("role", "timer");
    await expect(page.getByTestId("new-year-countdown-sound")).toHaveAttribute("aria-pressed", "false");
    await expect(countdown).toHaveAttribute("data-stage", "pulse", { timeout: 8000 });
    await testInfo.attach("silvester-countdown.png", { body: await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 400 } }), contentType: "image/png" });
    const zero = page.getByTestId("new-year-zero");
    await expect(zero).toBeVisible({ timeout: 15000 });
    await expect(zero).toContainText("Frohes neues Jahr 2027!");
    // Nie blockierend: die Navigation bleibt bedienbar, während der Gruß steht.
    const link = page.locator("header nav a").first();
    const point = await link.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("header")), point)).toBe(true);
  });
});

/** Wo die Ziffern stehen (CSS-Pixel) - dieselbe Rechnung wie `glyphSpot` in yearDigits.js. */
function digitBoxes(width, height, slots = 4) {
  const glyph = Math.max(40, Math.min(height * 0.17, (width * 0.8) / (0.6 + (slots - 1) * 0.82)));
  const y = Math.max(height * 0.42, 240 + glyph / 2);
  return Array.from({ length: slots }, (_, slot) => {
    const x = width / 2 + (slot - (slots - 1) / 2) * 0.82 * glyph;
    return { left: x - glyph * 0.3, right: x + glyph * 0.3, top: y - glyph / 2, bottom: y + glyph / 2 + 8 };
  });
}

/** Leuchtende Pixel im Himmel je Kasten (CSS-Pixel) - die Ebene ist durchsichtig, wo nichts brennt. */
async function litPixels(page, boxes) {
  return page.evaluate((list) => {
    const canvas = document.querySelector("[data-testid='season-sky']");
    if (!canvas) return list.map(() => -1);
    const ratio = canvas.width / canvas.clientWidth;
    const ctx = canvas.getContext("2d");
    return list.map((box) => {
      const x = Math.max(0, Math.floor(box.left * ratio));
      const y = Math.max(0, Math.floor(box.top * ratio));
      const w = Math.max(1, Math.floor((box.right - box.left) * ratio));
      const h = Math.max(1, Math.floor((box.bottom - box.top) * ratio));
      const data = ctx.getImageData(x, y, w, h).data;
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 90) lit += 1;
      return Math.round(lit / (ratio * ratio));
    });
  }, boxes);
}

test.describe("Silvester: die neue Jahreszahl um 00:00 (#853)", () => {
  for (const view of [{ name: "pc", width: 1440, height: 900 }, { name: "handy", width: 390, height: 844 }]) {
    test(`aus Funken lesbar am Himmel, Ziffer für Ziffer getrennt – ${view.width} px`, async ({ page, isMobile }, testInfo) => {
      test.skip(Boolean(isMobile), "eigene Größen");
      // Ohne Raketen der Stunde: am Himmel steht dann nur, was die Jahreszahl zeichnet.
      const season = newYear("countdown");
      await mockSeason(page, activePayload({ season: { ...season, data: { ...season.data, salvos: [] } }, now: "2026-12-31T23:59:58+01:00" }));
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("new-year-zero")).toBeVisible({ timeout: 10000 });
      // Ab 00:00 steigen die Ziffern (je 0,16 s versetzt), zerplatzen nach 1,35 s und stehen nach 0,7 s geformt da.
      await page.waitForTimeout(3300);
      const boxes = digitBoxes(view.width, view.height);
      const inside = await litPixels(page, boxes);
      // Zwischen den Ziffern bleibt der Himmel dunkel - sonst verschwimmt die Zahl.
      const gaps = boxes.slice(1).map((box, i) => {
        const middle = (boxes[i].right + box.left) / 2;
        return { left: middle - 2, right: middle + 2, top: box.top + 6, bottom: box.bottom - 14 };
      });
      const between = await litPixels(page, gaps);
      const shot = await page.screenshot();
      await testInfo.attach(`silvester-jahreszahl-${view.name}.png`, { body: shot, contentType: "image/png" });
      if (SHOTS) require("fs").writeFileSync(`${SHOTS}/silvester-jahreszahl-${view.name}.png`, shot);
      inside.forEach((lit, slot) => expect(lit, `Ziffer ${slot + 1} leuchtet`).toBeGreaterThan(view.width > 600 ? 300 : 120));
      // Die Gruß-Karte verdeckt die Zahl nicht - auch am Handy steht der Gruß kompakt darüber.
      const card = await page.getByTestId("new-year-zero").boundingBox();
      expect(card.y + card.height, "Karte endet über der Zahl").toBeLessThanOrEqual(boxes[0].top);
      between.forEach((lit, slot) => expect(lit, `Lücke ${slot + 1} bleibt dunkel`).toBeLessThan(6));
      // Nie blockierend: die Navigation bleibt bedienbar, während die Zahl steht.
      const point = await page.locator("header a").first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("header")), point)).toBe(true);
    });
  }

  test("„Bewegung reduzieren“: die Zahl steht ruhig am Himmel – ohne Raketen, ohne Bewegung", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockSeason(page, activePayload({ season: newYear("countdown"), now: "2026-12-31T23:59:58+01:00" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const calm = page.getByTestId("new-year-calm-year");
    await expect(calm).toBeVisible({ timeout: 10000 });
    expect(await calm.locator("circle").count()).toBeGreaterThan(100);
    expect(await calm.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await calm.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    await expect(page.getByTestId("new-year-zero")).toContainText("Frohes neues Jahr 2027!");
    // Die aufbrechende Null gehört zur Bewegung - ohne sie stünde eine große „0“ mitten im Gruß.
    await expect(page.locator(".tls-ny-countdown__burst")).toBeHidden();
    const sky = await litPixels(page, digitBoxes(1440, 900));
    sky.forEach((lit) => expect(lit).toBeLessThanOrEqual(0));
    const shot = await page.screenshot();
    await testInfo.attach("silvester-jahreszahl-ruhig.png", { body: shot, contentType: "image/png" });
    if (SHOTS) require("fs").writeFileSync(`${SHOTS}/silvester-jahreszahl-ruhig.png`, shot);
    // Nach dem Gruß ist auch die ruhige Zahl wieder weg.
    await expect(calm).toHaveCount(0, { timeout: 12000 });
  });
});
