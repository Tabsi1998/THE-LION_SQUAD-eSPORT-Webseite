const { test, expect } = require("@playwright/test");

// Oberfläche, Welle 1 (#1070, #1072, #1073, #1083): Die Kopfleiste wird beim Scrollen flacher, ohne dass der Inhalt
// springt; der aktive Menüpunkt trägt eine Linie; das Handy-Menü gleitet; beim Seitenwechsel blendet der neue Inhalt
// ein; die Social-Logos im Footer heben sich und füllen sich in der Markenfarbe; die Suche dunkelt die ganze Seite ab.
// Karten heben sich überall gleich um 5 px (#1071) - außer sie tragen gerade Saison-Deko.
// Mit „Bewegung reduzieren“ bleibt alles an seinem Platz. Bilder in SHOT_DIR.

const SHOTS = process.env.SHOT_DIR || "";
const EMPTY = { events: [], tournaments: [], challenges: [] };
const HOME = { has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY, upcoming: EMPTY, news: [], featured_news: [], stats: {}, club_numbers: {} };
const NEWS = [
  { id: "n1", slug: "erste", title: "Rückblick aufs LAN-Wochenende", excerpt: "Drei Tage, zwei Turniere.", published_at: "2026-10-01T10:00:00+00:00", visibility: "public" },
  { id: "n2", slug: "zweite", title: "Winter Cup: Anmeldung offen", excerpt: "Jetzt Team melden.", published_at: "2026-09-28T10:00:00+00:00", visibility: "public" },
];
const SOCIALS = [
  { platform: "discord", label: "Discord", url: "https://discord.test/lions" },
  { platform: "instagram", label: "Instagram", url: "https://instagram.test/lions" },
  { platform: "x", label: "X", url: "https://x.test/lions" },
  { platform: "youtube", label: "YouTube", url: "https://youtube.test/lions" },
];

async function mockServer(page, { news = [] } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at", social_links: SOCIALS }) }));
  await page.route("**/api/home/state", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...HOME, news, featured_news: news.slice(0, 1) }) }));
}

function headerState(page) {
  return page.evaluate(() => {
    const header = document.querySelector("[data-testid='site-header']");
    const row = document.querySelector("[data-testid='site-header-row']");
    const bg = document.querySelector("[data-testid='site-header-bg']");
    return {
      pageHeight: document.documentElement.scrollHeight,
      headerHeight: Math.round(header.getBoundingClientRect().height),
      barHeight: Math.round(bg.getBoundingClientRect().height),
      rowTop: getComputedStyle(row).top,
    };
  });
}

test.describe("Oberfläche, Welle 1: Kopfleiste, Menü, Seitenwechsel, Social-Logos", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stellt der Test selbst ein");

  test("Kopfleiste: ab 24 px flacher, der Inhalt springt nicht, am Seitenanfang wieder voll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    const header = page.getByTestId("site-header");
    await expect(header).toHaveAttribute("data-compact", "0");
    const before = await headerState(page);
    expect(before.barHeight).toBe(before.headerHeight);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/kopf-voll-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 130 } });

    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(header).toHaveAttribute("data-compact", "1");
    await page.waitForTimeout(450);
    const compact = await headerState(page);
    // Kein Sprung: die Seite ist gleich hoch, der Kopf behält im Fluss seine Höhe - nur die Fläche ist flacher.
    expect(compact.pageHeight).toBe(before.pageHeight);
    expect(compact.headerHeight).toBe(before.headerHeight);
    expect(compact.barHeight).toBe(Math.round(before.headerHeight * 0.8));
    expect(compact.rowTop).toBe("-8px");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/kopf-flach-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 130 } });

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toHaveAttribute("data-compact", "0");
  });

  test("der aktive Menüpunkt trägt die Linie, die anderen nicht", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/tournaments");
    await expect(page.locator("header .tls-nav-link").first()).toBeVisible();
    const lines = await page.evaluate(() => [...document.querySelectorAll("header .tls-nav-link")].map((link) => ({
      active: link.dataset.active === "1" || link.getAttribute("aria-current") === "page",
      line: getComputedStyle(link, "::after").transform,
    })));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.filter((entry) => entry.active)).toHaveLength(1);
    await page.waitForTimeout(400);
    const settled = await page.evaluate(() => [...document.querySelectorAll("header .tls-nav-link")].map((link) => ({
      active: link.dataset.active === "1" || link.getAttribute("aria-current") === "page",
      line: getComputedStyle(link, "::after").transform,
    })));
    for (const entry of settled) expect(entry.line).toBe(entry.active ? "matrix(1, 0, 0, 1, 0, 0)" : "matrix(0, 0, 0, 1, 0, 0)");
  });

  test("Handy-Menü: gleitet herein, hält die Leiste in voller Höhe und verschwindet nach dem Schließen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockServer(page);
    await page.goto("/");
    const header = page.getByTestId("site-header");
    await page.evaluate(() => window.scrollTo(0, 200));
    await expect(header).toHaveAttribute("data-compact", "1");
    await page.getByTestId("nav-mobile-toggle").click();
    const menu = page.locator("#mobile-navigation");
    await expect(menu).toBeVisible();
    await expect(header).toHaveAttribute("data-compact", "0");
    await page.waitForTimeout(400);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/handy-menue-390.png` });
    await page.getByTestId("nav-mobile-toggle").click();
    await expect(menu).toHaveCount(0);
    await expect(header).toHaveAttribute("data-compact", "1");
  });

  test("Seitenwechsel ohne Übergangs-Funktion: der neue Inhalt blendet ein, der erste Aufbau nicht", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Browser ohne View Transitions (#1073): dann blendet der Inhalt selbst ein (page-transitions.spec.js für mit).
    await page.addInitScript(() => { delete Document.prototype.startViewTransition; });
    await mockServer(page);
    await page.goto("/");
    const main = page.locator("main#main-content");
    await expect(page.getByTestId("footer-imprint")).toBeVisible();
    await expect(main).not.toHaveAttribute("data-route-fade", /.+/);
    await page.getByTestId("footer-imprint").click();
    await expect(page).toHaveURL(/\/imprint$/);
    await expect(main).toHaveAttribute("data-route-fade", /^[ab]$/);
    expect(await main.evaluate((node) => getComputedStyle(node).animationName)).toMatch(/^tls-route-in-[ab]$/);
    // Nach dem Einblenden ist der Inhalt voll da und bildet keine eigene Ebene mehr.
    await page.waitForTimeout(400);
    expect(await main.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(main).toHaveAttribute("data-route-fade", /^[ab]$/);
  });

  test("Social-Logos (Variante D): Logo in Markenfarbe, die Eckwinkel schließen sich zum Rahmen, das Schild nennt den Namen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    const look = (testId) => page.getByTestId(testId).evaluate((node) => {
      const style = getComputedStyle(node);
      const name = getComputedStyle(node.querySelector(".tls-social__name"));
      const logo = getComputedStyle(node.querySelector("svg"));
      return { color: style.color, size: style.backgroundSize.split(",")[0].trim(), fill: style.backgroundColor, logo: logo.transform, name: name.opacity };
    });
    const discord = page.getByTestId("footer-discord");
    await discord.scrollIntoViewIfNeeded();
    const rest = await look("footer-discord");
    expect(rest.color).toBe("rgb(88, 101, 242)");
    expect(rest.size).toBe("9px 2px");
    expect(rest.fill).toBe("rgba(0, 0, 0, 0)");
    expect(rest.logo).toBe("none");
    expect(rest.name).toBe("0");

    await discord.hover();
    await page.waitForTimeout(500);
    const hovered = await look("footer-discord");
    // Die Winkel sind bis zur Mitte jeder Kante gewachsen - der Rahmen ist geschlossen.
    expect(hovered.size).toBe("51% 2px");
    expect(hovered.fill).not.toBe("rgba(0, 0, 0, 0)");
    expect(hovered.logo).toBe("matrix(1.18, 0, 0, 1.18, 0, 0)");
    expect(hovered.name).toBe("1");
    await expect(discord).toHaveAttribute("aria-label", "Discord");
    await expect(discord).toHaveAttribute("href", "https://discord.test/lions");
    if (SHOTS) {
      const bands = await page.getByTestId("footer-socials").boundingBox();
      await page.screenshot({ path: `${SHOTS}/social-logos-1440.png`, clip: { x: bands.x - 16, y: bands.y - 48, width: bands.width + 32, height: bands.height + 72 } });
    }
    // X ist eine helle Marke: Logo und Winkel in Weiß.
    expect((await look("footer-x")).color).toBe("rgb(255, 255, 255)");
  });

  test("Karten: 5 px anheben mit Rand in der Akzentfarbe; mit Saison-Deko bleibt die Karte stehen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { news: NEWS });
    await page.goto("/");
    const card = page.getByTestId("home-featured-news-erste");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveClass(/(^| )tls-card( |$)/);
    const look = () => card.evaluate((node) => ({ transform: getComputedStyle(node).transform, border: getComputedStyle(node).borderTopColor }));
    expect((await look()).transform).toBe("none");
    await card.hover();
    await page.waitForTimeout(450);
    expect(await look()).toEqual({ transform: "matrix(1, 0, 0, 1, 0, -5)", border: "rgba(41, 182, 232, 0.55)" });
    if (SHOTS) {
      const box = await card.boundingBox();
      await page.screenshot({ path: `${SHOTS}/karte-hover-1440.png`, clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 24), width: Math.min(1440, box.width + 48), height: box.height + 60 } });
    }
    // Trägt die Karte Saison-Deko (die Saison-Bühne meldet das am Wurzelelement), bleibt sie stehen - der Rand reagiert.
    await page.mouse.move(2, 2);
    await page.waitForTimeout(450);
    await page.evaluate(() => { document.documentElement.dataset.seasonIntensity = "normal"; });
    await card.hover();
    await page.waitForTimeout(450);
    expect(await look()).toEqual({ transform: "none", border: "rgba(41, 182, 232, 0.55)" });
  });

  test("Einblenden auf Listen (#1074): das Raster blendet seine Karten nacheinander ein", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    const list = ["herbst-cup", "winter-cup", "sommer-cup"].map((slug, index) => ({
      id: `t${index}`, slug, title: slug.replace("-", " "), status: "registration_open", registration_enabled: true, format: "single_elim",
      start_date: "2026-11-14T10:00:00+01:00", max_participants: 16, participant_count: 4 + index, banner_url: "/api/static/uploads/public/cup.svg",
    }));
    await page.route("**/api/tournaments?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(list) }));
    await page.route("**/api/static/uploads/public/cup.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#29B6E8"/></svg>' }));
    await page.goto("/tournaments");
    const grid = page.locator(".tls-reveal-grid").first();
    await expect(grid).toHaveAttribute("data-reveal", /hidden|shown/);
    const cards = grid.locator("> a");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toHaveClass(/tls-reveal-item/);
    // Jede Karte kennt ihre Stelle im Raster - daraus wird der Versatz beim Einblenden.
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).getPropertyValue("--tls-i").trim()))).toEqual(["0", "1", "2"]);
    await expect(grid).toHaveAttribute("data-reveal", "shown");
    await expect.poll(() => cards.last().locator("> *").first().evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  });

  test("Hero (#1075): Körnung über dem Grund, das Glühen wandert und steht außerhalb des Bildes still", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { news: NEWS });
    await page.goto("/");
    const grain = page.getByTestId("home-hero-grain");
    await expect(grain).toBeAttached();
    expect(Number(await grain.evaluate((node) => getComputedStyle(node).opacity))).toBeGreaterThan(0.05);
    const drift = page.getByTestId("home-hero-drift");
    const look = () => drift.evaluate((node) => ({ name: getComputedStyle(node).animationName, state: getComputedStyle(node).animationPlayState }));
    expect(await look()).toEqual({ name: "tls-glow-drift", state: "running" });
    // Das Glühen selbst folgt weiter dem Zeiger (Hülle und Glühen sind getrennt).
    await expect(page.getByTestId("home-hero-glow")).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => (await look()).state).toBe("paused");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await look()).state).toBe("running");
  });

  test("die Suche dunkelt die ganze Seite ab, nicht nur die Kopfleiste", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(page.getByTestId("site-header")).toHaveAttribute("data-compact", "1");
    await page.getByTestId("global-search-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(Math.round(box.width)).toBe(1440);
    expect(Math.round(box.height)).toBe(900);
  });

  test("mit „Bewegung reduzieren“ bleibt alles an seinem Platz", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockServer(page);
    await page.goto("/");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tls-motion-on").trim())).toBe("0");
    const before = await headerState(page);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(page.getByTestId("site-header")).toHaveAttribute("data-compact", "1");
    await page.waitForTimeout(100);
    const scrolled = await headerState(page);
    expect(scrolled.barHeight).toBe(before.headerHeight);
    expect(scrolled.rowTop).toBe("0px");
    const discord = page.getByTestId("footer-discord");
    await discord.scrollIntoViewIfNeeded();
    await discord.hover();
    await page.waitForTimeout(100);
    const style = await discord.evaluate((node) => ({ logo: getComputedStyle(node.querySelector("svg")).transform, size: getComputedStyle(node).backgroundSize.split(",")[0].trim() }));
    // Die Winkel schließen sich weiter (sofort, das ist Farbe), das Logo wächst nicht.
    expect(style.logo).toBe("matrix(1, 0, 0, 1, 0, 0)");
    expect(style.size).not.toBe("9px 2px");
    // Auch das Glühen im Hero wandert nicht.
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.getByTestId("home-hero-drift").evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  });
});
