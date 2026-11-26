const { test, expect } = require("@playwright/test");
const { HOME, mockLongApi } = require("./fixtures/longTextMocks");

// Schrift-Treppe (#1302, #1303, #1304) mit schlimmen, aber echten Daten (break-ui): ein News-Titel mit 60 Zeichen und
// Umlauten, eine Rangliste mit langen Namen und Punkten in verschiedener Breite, ein Countdown in den letzten Minuten.
// Geprüft bei 390, 768, 1440 und 2560 px:
// - Der Titel steht auf Startseite, News-Liste und Artikel gleich geschrieben (wie eingetippt, nie GROSS) und läuft
//   nirgends aus seiner Fläche oder aus dem Bild.
// - Die Punkte der Rangliste stehen in der Zahlen-Schrift mit gleich breiten Ziffern: gleich viele Ziffern sind gleich
//   breit, die Spalte ist bündig.
// - Der Countdown wackelt nicht: „in 50 Minuten“ und „in 11 Minuten“ sind gleich breit.

const WIDTHS = [[390, 844], [768, 1024], [1440, 900], [2560, 1440]];
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const TITLE = "Finale in Wörgl: Überraschungssieg für Jörg im Kart-Cup 2026";
const NEWS = {
  id: "n60", slug: "grosses-finale-woergl", title: TITLE, category: "turnier", visibility: "public", pinned: true,
  published_at: "2026-11-19T10:00:00+00:00", created_at: "2026-11-19T10:00:00+00:00", author_name: "Orga-Team",
  excerpt: "Zwölf Stationen, 48 Fahrerinnen und Fahrer und ein Finale, das erst in der letzten Runde entschieden wurde.",
  content: "Was für ein Abend in Wörgl!\n\nDanke an alle, die mitgeholfen haben.", banner_url: "",
};

async function withNews(page) {
  await mockLongApi(page);
  await page.route(/\/api\/news(\?.*)?$/, (route) => route.fulfill(json([NEWS])));
  await page.route(`**/api/news/${NEWS.slug}`, (route) => route.fulfill(json(NEWS)));
  await page.route(/\/api\/home\/state(\?.*)?$/, (route) => route.fulfill(json({ ...HOME, news: [NEWS], featured_news: [NEWS] })));
}

/** Schreibweise, Großschreibung und Überlauf eines Titels - und ob die Seite seitlich scrollt. */
async function titleFacts(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const doc = document.documentElement;
    return {
      shown: node.innerText.replace(/\s+/g, " ").replace(/­/g, "").trim(),
      transform: style.textTransform,
      overflow: node.scrollWidth - node.clientWidth,
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      right: node.getBoundingClientRect().right - doc.clientWidth,
    };
  });
}

test.describe("Schrift-Treppe", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of WIDTHS) {
    test(`News-Titel mit 60 Zeichen bei ${width} px: überall gleich geschrieben, nichts läuft über`, async ({ page }) => {
      expect(TITLE).toHaveLength(60);
      await page.setViewportSize({ width, height });
      await withNews(page);
      const seen = [];
      for (const [path, locate] of [
        ["/", (p) => p.getByRole("heading", { name: TITLE }).first()],
        ["/news", (p) => p.getByRole("heading", { name: TITLE }).first()],
        [`/news/${NEWS.slug}`, (p) => p.getByRole("heading", { level: 1, name: TITLE })],
      ]) {
        await page.goto(path);
        const title = locate(page);
        await expect(title).toBeVisible();
        const facts = await titleFacts(title);
        expect(facts.transform, `${path}: Titel nie GROSS`).toBe("none");
        expect(facts.shown, `${path}: Titel wie eingetippt`).toBe(TITLE);
        expect(facts.overflow, `${path}: Titel läuft aus seiner Fläche`).toBeLessThanOrEqual(1);
        expect(facts.right, `${path}: Titel läuft aus dem Bild`).toBeLessThanOrEqual(1);
        expect(facts.pageOverflow, `${path}: Seite scrollt seitlich`).toBeLessThanOrEqual(1);
        seen.push(facts.shown);
      }
      expect(new Set(seen).size).toBe(1);
    });
  }

  const SEASON = { id: "s-26", slug: "jahreswertung-2026", name: "Jahreswertung 2026", status: "active", start_date: "2026-01-01", end_date: "2026-12-31", drop_worst: 1 };
  const NAMES = ["Aleksandra Wiśniewska-Kowalczyk", "Jo", "Ömer Yılmaz", "xX_Nebelwolf_Xx.Rudel", "Lena", "Bartholomäus Fitzgerald-Hinterberger"];
  // Ziffern mit verschiedener Breite in proportionalen Schriften: 1 ist schmal, 0 und 8 sind breit.
  const POINTS = [1888, 1111, 1080, 808, 111, 101];
  const STANDINGS = NAMES.map((name, index) => ({
    user_id: `u-${index}`, username: `spieler${index}`, display_name: name, rank: index + 1, points: POINTS[index],
    events_count: 12 - index, wins: Math.max(0, 4 - index), achievement_count: 3, profile_points: 10,
  }));

  for (const [width, height] of WIDTHS) {
    test(`Rangliste bei ${width} px: Punkte in Rajdhani, gleich viele Ziffern gleich breit, Spalte bündig`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockLongApi(page);
      await page.route(`**/api/seasons/${SEASON.slug}/standings**`, (route) => route.fulfill(json({ season: SEASON, standings: STANDINGS })));
      await page.goto(`/seasons/${SEASON.slug}`);
      const row = (id) => page.locator(`[data-testid="season-row-${id}"]:visible, [data-testid="season-item-${id}"]:visible`).first();
      await expect(row("u-5")).toBeVisible();
      const cells = await page.evaluate((ids) => ids.map((id) => {
        const root = document.querySelector(`[data-testid="season-row-${id}"]`)?.offsetParent
          ? document.querySelector(`[data-testid="season-row-${id}"]`)
          : document.querySelector(`[data-testid="season-item-${id}"]`);
        const cell = [...root.querySelectorAll(".tls-type-num")].find((node) => /^\d[\d.]*$/.test(node.textContent.trim()) && node.textContent.trim().replace(/\D/g, "").length >= 3);
        const range = document.createRange();
        range.selectNodeContents(cell);
        const box = range.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return { text: cell.textContent.trim(), width: box.width, right: box.right, family: style.fontFamily, numeric: style.fontVariantNumeric };
      }), STANDINGS.map((row_) => row_.user_id));
      for (const cell of cells) {
        expect(cell.family).toMatch(/Rajdhani/);
        expect(cell.numeric).toContain("tabular-nums");
      }
      // Gleich viele Ziffern, gleich breit: 1.888 / 1.111 / 1.080 und 808 / 111 / 101.
      const byDigits = new Map();
      for (const cell of cells) {
        const key = cell.text.length;
        byDigits.set(key, [...(byDigits.get(key) || []), cell.width]);
      }
      for (const widths of byDigits.values()) expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
      // Bündig: rechte Kanten gleich (die Spalte steht rechts).
      const rights = cells.map((cell) => cell.right);
      expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  for (const [width, height] of WIDTHS) {
    test(`Countdown bei ${width} px: „in 50 Minuten“ und „in 11 Minuten“ sind gleich breit`, async ({ page, context }) => {
      await page.setViewportSize({ width, height });
      const measure = async (now) => {
        const tab = await context.newPage();
        await tab.setViewportSize({ width, height });
        await mockLongApi(tab, { now });
        await tab.goto("/");
        const value = tab.getByTestId("home-countdown-value");
        await expect(value).toHaveText(/^in \d\d Minuten$/);
        const facts = await value.evaluate((node) => {
          const style = getComputedStyle(node);
          return { text: node.textContent, width: node.getBoundingClientRect().width, family: style.fontFamily, numeric: style.fontVariantNumeric };
        });
        await tab.close();
        return facts;
      };
      // Die Herbst-LAN beginnt um 17:00 Uhr UTC (fixtures/longTextMocks).
      const early = await measure("2026-11-27T16:10:00+00:00");
      const late = await measure("2026-11-27T16:49:00+00:00");
      expect(early.text).toBe("in 50 Minuten");
      expect(late.text).toBe("in 11 Minuten");
      expect(early.family).toMatch(/Rajdhani/);
      expect(early.numeric).toContain("tabular-nums");
      expect(Math.abs(early.width - late.width)).toBeLessThanOrEqual(0.5);
    });
  }
});
