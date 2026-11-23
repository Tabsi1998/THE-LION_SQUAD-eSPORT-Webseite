const { test, expect } = require("@playwright/test");
const { mockLongApi, PAGES } = require("./fixtures/longTextMocks");

// Nichts Wichtiges mit „…“ (#1314, Teil 1): Auf Start, News, Events, Kalender, Verein, Galerie, Hilfe, Glocke, Kopf,
// Suche und Verwaltung steht bei 320, 390 und 1440 px kein Titel, Name, Datum, Ort, Zustand oder keine Rolle mit „…“ -
// mit langen, aber echten Werten (e2e/fixtures/longTextMocks.js). Gekürzt werden dürfen nur Vorschau-Texte (Absätze und
// Vorschau-Zeilen), die Balken im Monatsraster und der eigene Name im Kopf (beide ganz im title). Dazu: kein seitliches
// Scrollen. Die API ist nachgestellt, es geht nie ins Netz.

const WIDTHS = [[320, 700], [390, 844], [1440, 900]];

/** Sichtbare Elemente, deren Text abgeschnitten ist (text-overflow: ellipsis oder line-clamp), ohne die erlaubten. */
function cutTexts() {
  const allowed = (el) => el.matches("p")
    || /-preview-/.test(el.getAttribute("data-testid") || "")
    || Boolean(el.closest('[data-testid^="calendar-bar-"], [data-testid="nav-user"]'));
  const found = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!el.getClientRects().length) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden") continue;
    const ellipsis = style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
    const clamp = style.webkitLineClamp && style.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1;
    if (!ellipsis && !clamp) continue;
    const text = (el.textContent || "").trim();
    if (!text || allowed(el)) continue;
    found.push(`${el.closest("[data-testid]")?.getAttribute("data-testid") || el.tagName}: ${text.slice(0, 50)}`);
  }
  return found;
}

async function open(page, item) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockLongApi(page, { user: item.user });
  await page.goto(item.path);
  if (item.ready) await expect(page.getByTestId(item.ready).first()).toBeVisible({ timeout: 15_000 });
  else await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
  if (item.prepare) await item.prepare(page);
  await page.evaluate(() => document.fonts?.ready);
}

test.describe("Nichts Wichtiges mit „…“", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");
  test.use({ reducedMotion: "reduce" });

  for (const item of PAGES) {
    test(`${item.key}: kein Titel, Name oder Datum abgeschnitten, kein seitliches Scrollen`, async ({ page }) => {
      test.setTimeout(90_000);
      for (const [width, height] of WIDTHS) {
        await page.setViewportSize({ width, height });
        await open(page, item);
        expect(await page.evaluate(cutTexts), `${item.path} bei ${width} px`).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${item.path} bei ${width} px: kein Querlauf`).toBeLessThanOrEqual(1);
      }
    });
  }
});
