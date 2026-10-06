const { test, expect } = require("@playwright/test");

// Startseite I (#832): News-Raster ohne Lücke (die große Karte füllt die Höhe der zwei kleinen), Plakette in
// „Nächste Termine“ einzeilig, Inhalte blenden beim Hereinscrollen ein (nur Deckkraft - keine Layout-
// Verschiebung), Karten zeigen beim Darüberfahren Tiefe, das Licht hinter dem Löwen folgt dem Zeiger; mit
// „Bewegung reduzieren“ steht alles still und ist sofort da. Kein seitliches Überlaufen bei 390 px.

const SHOTS = process.env.SHOT_DIR || "";
const COLORS = ["#29B6E8", "#9F7AEA", "#FFD700"];

function banner(index) {
  const color = COLORS[index % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0A0A0A"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/>`
    + `<text x="80" y="820" font-family="Arial" font-size="96" font-weight="900" fill="rgba(255,255,255,0.75)">NEWS ${index + 1}</text></svg>`;
}

const NEWS = [
  { id: "n1", slug: "saisonfinale", title: "Saisonfinale im Vereinsheim – die Jahreswertung wird entschieden", excerpt: "Am Samstag fällt die Entscheidung: acht Spiele, ein Abend, eine Siegerehrung.", category: "events", banner_url: "/api/static/uploads/public/banner-0.svg", created_at: "2026-10-01T10:00:00Z", published_at: "2026-10-01T10:00:00Z" },
  { id: "n2", slug: "anmeldung-cup", title: "Anmeldung für den Herbst-Cup ist offen", excerpt: "Sechzehn Plätze, Rocket League im Zweierteam – jetzt anmelden.", category: "announcement", banner_url: "/api/static/uploads/public/banner-1.svg", created_at: "2026-09-28T10:00:00Z", published_at: "2026-09-28T10:00:00Z" },
  { id: "n3", slug: "neue-trikots", title: "Neue Trikots sind da", excerpt: "Abholung beim nächsten Vereinsabend.", category: "club", banner_url: "/api/static/uploads/public/banner-2.svg", created_at: "2026-09-20T10:00:00Z", published_at: "2026-09-20T10:00:00Z" },
  { id: "n4", slug: "rueckblick", title: "Rückblick: Gamers Heaven 2026", excerpt: "Zwei Tage, drei Turniere, viele neue Gesichter.", category: "club", banner_url: "/api/static/uploads/public/banner-0.svg", created_at: "2026-09-10T10:00:00Z", published_at: "2026-09-10T10:00:00Z" },
];
const PHASE = { state: "announced", label: "Angekündigt", target_at: "2027-03-11T10:00:00+01:00", countdown_kind: "starts" };
const EMPTY = { events: [], tournaments: [], challenges: [] };
const HOME = {
  has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY,
  upcoming: {
    events: [
      { id: "e1", slug: "fruehjahrsmesse", name: "Tiroler Frühjahrsmesse 2027", status: "scheduled", public_phase: PHASE, start_date: "2027-03-11T10:00:00+01:00" },
      { id: "e2", slug: "gamers-heaven", name: "Gamers Heaven 2027", status: "scheduled", public_phase: { ...PHASE, target_at: "2027-06-19T10:00:00+02:00" }, start_date: "2027-06-19T10:00:00+02:00" },
    ],
    tournaments: [], challenges: [],
  },
  news: NEWS, featured_news: [NEWS[0]], stats: {},
  club_numbers: { members: 15, tournaments: 3, events: 0, participations: 0, prizes: 10, years: 3 }, club_numbers_shown: ["prizes", "tournaments", "members", "years"],
};
const BOARD = ["Obfrau", "Stellvertretung", "Kassier", "Schriftführung"].map((title, index) => ({
  id: `p${index}`, is_active: true, display_title: title, user: { display_name: `Person ${index + 1}`, slug: `person-${index + 1}` },
}));

async function mockServer(page) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/home/state", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(HOME) }));
  await page.route("**/api/board?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(BOARD) }));
  await page.route("**/api/static/uploads/public/banner-*", (route) => {
    const index = Number((route.request().url().match(/banner-(\d)/) || [0, 0])[1]);
    return route.fulfill({ contentType: "image/svg+xml", body: banner(index) });
  });
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await consent.count()) await consent.click();
}

async function layoutShifts(page) {
  await page.addInitScript(() => {
    window.__shift = 0;
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Bildschirmfoto für die Abnahme (nur mit SHOT_DIR) - feste Leisten ausgeblendet, durchgescrollt. */
async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 80));
    }
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (getComputedStyle(element).position === "fixed" && rect.bottom >= window.innerHeight - 2 && rect.height < 140) element.style.visibility = "hidden";
    }
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("1440: Raster ohne Lücke, Plakette einzeilig, Einblenden beim Scrollen ohne Verschiebung, Tiefe und Licht", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await layoutShifts(page);
  await mockServer(page);
  await page.goto("/");
  await acceptCookies(page);

  // Raster: die große Karte links über zwei Zeilen, rechts zwei kleine übereinander, gleiche Gesamthöhe.
  const grid = page.getByTestId("home-news-grid");
  await expect(grid.locator("> a")).toHaveCount(3);
  const [big, first, second] = await Promise.all([0, 1, 2].map((index) => grid.locator("> a").nth(index).boundingBox()));
  expect(first.x).toBeGreaterThan(big.x + big.width);
  expect(Math.abs(first.x - second.x)).toBeLessThan(2);
  expect(second.y).toBeGreaterThan(first.y + first.height);
  expect(Math.abs((big.y + big.height) - (second.y + second.height))).toBeLessThan(3);
  // Das hohe Bild zeigt das ganze Banner (nichts abgeschnitten), die Fläche daneben füllt dieselbe Grafik unscharf.
  const media = page.getByTestId("home-news-tall-media");
  expect(await media.locator("img").last().evaluate((node) => getComputedStyle(node).objectFit)).toBe("contain");
  expect(await media.locator("img").first().evaluate((node) => getComputedStyle(node).filter)).toContain("blur");

  // Plakette einzeilig.
  for (const row of await page.locator("[data-testid^='home-next-event-']").all()) {
    const badge = await row.locator("span").filter({ hasText: /Angekündigt/i }).first().boundingBox();
    expect(badge.height).toBeLessThan(30);
  }

  // Einblenden: die News liegen unter dem Bildrand - erst beim Hereinscrollen sichtbar, gestaffelt.
  const news = page.getByTestId("home-news");
  await expect(news).toHaveAttribute("data-reveal", "hidden");
  const card = grid.locator("> a").first();
  expect(await card.locator("> *").first().evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
  await news.scrollIntoViewIfNeeded();
  await expect(news).toHaveAttribute("data-reveal", "shown");
  await expect.poll(() => card.locator("> *").first().evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  expect(await card.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");

  // Tiefe beim Darüberfahren (#1071): die Karte hebt sich um 5 px und bekommt einen Schatten. Trägt sie gerade
  // Saison-Deko, bleibt sie, wo sie ist - die Deko hängt an ihrer gemessenen Kante. Ohne Maus (Touch) gibt es keinen
  // Hover, der hängen bleiben könnte.
  // Gemessen in Seitenkoordinaten, damit ein Scrollen beim Hover die Zahl nicht verfälscht.
  const pageY = async () => (await card.boundingBox()).y + (await page.evaluate(() => window.scrollY));
  const before = await pageY();
  const canHover = await page.evaluate(() => window.matchMedia("(hover: hover)").matches);
  await card.hover();
  if (canHover) {
    await expect.poll(() => card.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
    await expect.poll(async () => Math.round(before - (await pageY()))).toBe(5);
    await page.mouse.move(2, 2);
    await expect.poll(async () => Math.round(before - (await pageY()))).toBe(0);
    await page.evaluate(() => { document.documentElement.dataset.seasonIntensity = "normal"; });
    await card.hover();
    await expect.poll(() => card.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
    await page.waitForTimeout(350);
    expect(Math.abs((await pageY()) - before)).toBeLessThan(0.5);
    await page.evaluate(() => { delete document.documentElement.dataset.seasonIntensity; });
  } else {
    await page.waitForTimeout(350);
    expect(Math.abs((await pageY()) - before)).toBeLessThan(0.5);
  }

  // Das Licht hinter dem Löwen folgt dem Mauszeiger - mit Touch bleibt es still (dort gibt es keinen Zeiger).
  await page.evaluate(() => window.scrollTo(0, 0));
  const finePointer = await page.evaluate(() => window.matchMedia("(pointer: fine)").matches);
  await page.mouse.move(1400, 120);
  await page.mouse.move(1420, 140);
  const glowX = () => page.getByTestId("home-hero-glow").evaluate((node) => node.style.getPropertyValue("--tls-glow-x"));
  if (finePointer) await expect.poll(glowX).toMatch(/^\d+px$/);
  else expect(await glowX()).toBe("");

  // Einblenden ändert nur die Deckkraft: keine Layout-Verschiebung über die ganze Seite.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 60));
    }
  });
  expect(await page.evaluate(() => window.__shift)).toBeLessThan(0.02);
  await shot(page, "home-motion-1440");
});

test("390: eine Spalte, kein seitliches Überlaufen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServer(page);
  await page.goto("/");
  await acceptCookies(page);
  const grid = page.getByTestId("home-news-grid");
  await expect(grid.locator("> a")).toHaveCount(3);
  const [big, first] = await Promise.all([0, 1].map((index) => grid.locator("> a").nth(index).boundingBox()));
  expect(Math.abs(first.x - big.x)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await shot(page, "home-motion-390");
});

test("Bewegung reduzieren: alles sofort da, nichts atmet, nichts folgt dem Zeiger", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockServer(page);
  await page.goto("/");
  await acceptCookies(page);
  await expect(page.getByTestId("home-news")).toHaveAttribute("data-reveal", "shown");
  const card = page.getByTestId("home-news-grid").locator("> a").first();
  expect(await card.locator("> *").first().evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  const glow = page.getByTestId("home-hero-glow");
  expect(await glow.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  await page.mouse.move(1400, 120);
  await page.mouse.move(1420, 140);
  expect(await glow.evaluate((node) => node.style.getPropertyValue("--tls-glow-x"))).toBe("");
});
