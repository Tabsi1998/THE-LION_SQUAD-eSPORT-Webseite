const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { test, expect } = require("@playwright/test");

// Erlaubte Ausrüstung als Tabelle je Kategorie (#2305, layout 5) im echten Browser, Server nachgestellt: Regelwerk im Web mit je Waffe
// Bild · Name · Ausnahmen nach Slot, „nur erlaubt“ an der langen Sniper-Zeile; am Handy stapelt die Tabelle ohne seitliches Scrollen.
// Ligaseite: aufgeklappt steht „Gesperrt: …“ ganz oben im Kasten. Bei 390 und 1440 px. Daten aus fixtures/allowed-tabelle.json - so
// rechnet der Server (scratch: gen_tabelle). Nur erfundene Namen. `SHOTS_DIR` legt die Bilder zusätzlich dort ab.

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "allowed-tabelle.json"), "utf8"));
const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const PUBLIC_SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { id: "s1", name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 1, loss: 0 }, blocked_periods: [] },
  look: {}, prizes: [], map_pool: null, divisions: [], rules: null, application: null, loadout_bans: null, allowed_equipment: FIXTURE.allowed,
};
const V3 = { id: "r3", scope: "league_season", version: 3, label: "Version 3", title: "Regelwerk", valid_from: "2026-11-05", published_at: "2026-11-05T10:00:00+00:00",
  change_reason: "Tabelle je Kategorie", is_current: true, pdf_url: "/api/league-rules/seasons/probe-liga/season-1/versions/r3/pdf" };
const RULES_PAGE = {
  league: { slug: "probe-liga", name: "Probe-Liga" }, season: { id: "s1", slug: "season-1", name: "Season 1", number: 1, status: "active" }, look: {}, public: true,
  source: "rules", version: V3, versions: [V3], upcoming: null, seasons: [], fallback_text: null, consent: null, changes: null,
  sections: [
    { anchor: "einleitung", title: null, level: 0, kind: "main", body_md: "Vorwort der Probe-Liga.", mark: null },
    { anchor: "anlage-a", title: "Anlage A: Erlaubte Ausrüstung", level: 1, kind: "annex", body_md: FIXTURE.block_md, mark: null },
  ],
};
const SNIPER = "Falke 50 Präzisionsgewehr mit langem Namen";

/** Ein erfundenes Bild als echtes PNG (zwei Farbflächen). */
function png(width, height, color) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) row.set(x < width * 0.6 ? color : [24, 24, 28], 1 + x * 3);
    rows.push(row);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const PICTURE = png(160, 90, [41, 182, 232]);
const SMALL = png(160, 90, [126, 226, 168]);
const ICON = png(32, 32, [255, 159, 10]);

async function mock(page) {
  await page.addInitScript(CONSENT);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.startsWith("/static/uploads/")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: url.includes("klasse") ? ICON : url.includes("bild-a") ? SMALL : PICTURE });
    }
    if (url.startsWith("/changes")) return route.abort();
    if (url === "/auth/me") return json({ detail: "Nicht angemeldet" }, 401);
    if (url === "/leagues/probe-liga/season-1") return json(PUBLIC_SEASON);
    if (url.startsWith("/league-rules/seasons/probe-liga/season-1")) return json(RULES_PAGE);
    if (route.request().method() !== "GET") return json({ ok: true });
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active", "/friends"];
    return json(objects.includes(url) ? {} : []);
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(locator, name) {
  // Für die Bilder: feste Leisten (Kopf, Navigation am Handy) liegen sonst über dem Ausschnitt.
  const hide = (hidden) => locator.page().evaluate((on) => {
    for (const node of document.querySelectorAll("body *")) {
      if (["fixed", "sticky"].includes(getComputedStyle(node).position)) node.style.visibility = on ? "hidden" : "";
    }
  }, hidden);
  await hide(true);
  await locator.screenshot({ path: test.info().outputPath(name) });
  if (process.env.SHOTS_DIR) await locator.screenshot({ path: path.join(process.env.SHOTS_DIR, name) });
  await hide(false);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test.describe(`Ausrüstung als Tabelle (${width} px)`, () => {
    test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

    test("Regelwerk im Web: je Kategorie eine Tabelle, Ausnahmen je Slot, „nur erlaubt“, wo es kürzer ist", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page);
      await page.goto("/liga/probe-liga/season-1/regeln");
      const annex = page.locator("[id='anlage-a']");
      const table = annex.locator(".prose-cms-table").filter({ has: page.locator("th u") });
      await expect(table).toHaveCount(1);
      const sniper = table.locator("tr").filter({ hasText: SNIPER });
      const cells = sniper.locator("td");
      await expect(cells.nth(0).locator("img[alt='Ausrüstung']")).toBeVisible();
      await expect(cells.nth(2).locator("em").first()).toHaveText("nur erlaubt:");
      // Je Slot eine eigene Zeile.
      const slots = cells.nth(2).locator("u");
      await expect(slots).toHaveCount(6);
      await expect(slots.nth(2)).toHaveText("Optik: Zielfernrohr 12x Variabel (nur in Suchen & Zerstören), Zielfernrohr 8x");
      const tops = await slots.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
      for (let index = 1; index < tops.length; index += 1) expect(tops[index]).toBeGreaterThan(tops[index - 1]);
      const habicht = table.locator("tr").filter({ hasText: "Habicht 7" }).locator("td").nth(2);
      await expect(habicht.locator("strong")).toHaveText(["gesperrt:", "eingeschränkt:"]);
      await expect(habicht).toContainText("Optik: Thermalvisier (nicht in Suchen & Zerstören)");
      await expect(table.locator("tr").filter({ hasText: "Blitz 9" }).locator("td").nth(2)).toHaveText("alle passenden Aufsätze erlaubt");
      await expect(table.locator("tr").filter({ hasText: "Schrotflinte" })).toContainText("nicht erlaubt (Bö, Hagel)");
      await expect(annex.locator("p").filter({ hasText: "An keiner Waffe erlaubt:" })).toHaveText("An keiner Waffe erlaubt: Kompensator");
      // Kategorien ohne Waffen bleiben Karten.
      expect(await annex.locator("ul").filter({ has: page.locator("u") }).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).display))).toEqual(["grid"]);
      const display = await sniper.evaluate((node) => getComputedStyle(node).display);
      if (width < 640) {
        // Am Handy: jede Zeile ein Raster - Bild und Name oben, die Aufsätze darunter über die ganze Breite.
        expect(display).toBe("grid");
        const [image, name, rest] = await cells.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
        expect(Math.abs(image.top - name.top)).toBeLessThanOrEqual(2);
        expect(rest.top).toBeGreaterThan(name.top);
        expect(rest.width).toBeGreaterThan(name.width);
        await expect(table.locator("thead")).toHaveCSS("position", "absolute");
      } else {
        // Am PC ein Raster: Bild, Name und Aufsätze nebeneinander, der Kopf einer Waffenklasse reicht über Name und Aufsätze.
        expect(display).toBe("contents");
        const [image, name, rest] = await cells.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
        expect(Math.abs(image.top - name.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(name.top - rest.top)).toBeLessThanOrEqual(1);
        expect(rest.width).toBeGreaterThan(name.width * 1.5);
        const head = await table.locator("tr").filter({ hasText: "Scharfschützengewehr" }).locator("td").nth(1).boundingBox();
        expect(head.width).toBeGreaterThan(name.width + rest.width - 2);
        expect(head.height).toBeLessThan(52);
        const box = await table.boundingBox();
        const doc = await annex.boundingBox();
        expect(box.width).toBeGreaterThan(doc.width - 40);
      }
      await noSideScroll(page);
      await table.scrollIntoViewIfNeeded();
      await shot(table, `regelwerk-tabelle-${width}.png`);
      // Am PC ist die Zeile `display: contents` (ohne eigene Fläche) - das Bild umfasst ihre drei Zellen.
      await sniper.scrollIntoViewIfNeeded();
      const boxes = await cells.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
      const clip = { x: Math.min(...boxes.map((box) => box.x)), y: Math.min(...boxes.map((box) => box.y)) };
      clip.width = Math.max(...boxes.map((box) => box.right)) - clip.x;
      clip.height = Math.max(...boxes.map((box) => box.bottom)) - clip.y;
      await page.screenshot({ path: test.info().outputPath(`regelwerk-sniper-${width}.png`), clip });
      if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `regelwerk-sniper-${width}.png`), clip });
    });

    test("Ligaseite: aufgeklappt steht „Gesperrt: …“ ganz oben im Kasten", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mock(page);
      await page.goto("/liga/probe-liga/season-1");
      const block = page.getByTestId("league-allowed-equipment");
      const habicht = block.getByTestId("allowed-weapon-toggle").filter({ hasText: "Habicht 7" });
      await habicht.click();
      const panel = block.getByTestId("allowed-attachments");
      const banned = panel.getByTestId("allowed-attachments-banned");
      await expect(banned).toHaveText("Gesperrt: Holo-Visier, Kein Schaft, Kurzer Lauf, Rotpunkt, Trommelmagazin · dazu 1 Aufsatz, der an keiner Waffe erlaubt ist");
      const bannedBox = await banned.boundingBox();
      const firstSlot = await panel.getByTestId("allowed-slot").first().boundingBox();
      expect(bannedBox.y + bannedBox.height).toBeLessThanOrEqual(firstSlot.y + 1);
      await expect(panel.getByText("nur erlaubt", { exact: false })).toHaveCount(0);
      await noSideScroll(page);
      await panel.scrollIntoViewIfNeeded();
      await shot(panel, `ligaseite-gesperrt-oben-${width}.png`);
    });
  });
}
