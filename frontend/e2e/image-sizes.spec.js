const { test, expect } = require("@playwright/test");
const { routeFakeUploads } = require("./fixtures/fakeUploads");

// Bilder in passender Größe (#1227): Kopf (Logo), Startseite, Vereinsmitglieder, News-Artikel, Partner und
// Galerie holen jedes hochgeladene Bild in einer Fassung, die höchstens doppelt so breit ist wie seine Anzeige
// (am Handy mit dreifacher Pixeldichte gerechnet; die kleinste Fassung ist 160) - nie das Original. Der
// Netzwerk-Mitschnitt zählt die Bilder des ersten Ladens gegen eine Grenze; das Logo im Kopf bleibt unter 30 KB. Die Programmdateien
// liefert im Test der Entwicklungsserver ungebündelt - ihre Größe im Betrieb zeigt der Build.

// Höchstens so viel an Bildern je Seite beim ersten Laden (nachgestellte Gewichte, siehe fixtures/fakeUploads.js) -
// am Handy bleiben die Seiten mit den Programmdateien (rund 600 KB) so unter den Grenzen aus #1227: Startseite
// 1,2 MB, News-Artikel und Vereinsmitglieder 1,5 MB. Der PC darf größere Fassungen nehmen.
const KB = 1024;
const DEVICES = [
  { name: "Handy", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, budget: (path) => (path === "/" ? 600 * KB : 900 * KB) },
  { name: "PC", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, budget: () => 1200 * KB },
];
const LOGO_BUDGET = 30 * KB;

const up = (name) => `/api/static/uploads/${name}`;
const EMPTY = { events: [], tournaments: [], challenges: [] };
const NEWS = Array.from({ length: 6 }, (_, index) => ({
  id: `n${index}`, slug: `news-${index}`, title: `Vereinsnews ${index + 1}`, excerpt: "Kurz und knapp.", category: "verein",
  banner_url: up(`banner-${index}.png`), published_at: "2026-10-01T10:00:00Z", created_at: "2026-10-01T10:00:00Z",
}));
const MEMBERS = Array.from({ length: 6 }, (_, index) => ({
  id: `m${index}`, slug: `mitglied-${index}`, gamertag: `Lion${index}`, display_name: `Lion${index}`, photo_url: up(`photo-${index}.png`), games: [], platforms: [],
}));
const PROFILE = {
  id: "m0", slug: "mitglied-0", gamertag: "Lion0", display_name: "Lion0", bio: "Spielt seit 2019 im Verein.",
  photo_url: up("photo-0.png"), cover_url: up("cover-0.png"), references: [], reference_stats: {},
  account: { avatar_url: up("avatar-0.png"), profile_url: "/u/lion0", level: 5 },
};
const PARTNERS = Array.from({ length: 4 }, (_, index) => ({
  id: `p${index}`, slug: `partner-${index}`, name: `Partner ${index + 1}`, logo_url: up(`partner-${index}.png`), channels: [], kind: "verein",
}));
const PARTNER = {
  ...PARTNERS[0], description: "Ein befreundeter Verein.", about: "", since_year: 2024,
  tools: [{ id: "t1", title: "Turnier-Tool", description: "Hilft beim Planen.", image_url: up("tool-1.png"), url: "https://tool.example.test" }],
  news: NEWS.slice(0, 2), shared: [],
};
const ARTICLE = {
  ...NEWS[0], content: "<p>Ein Bericht vom letzten Turnier.</p>",
  mentioned_users: [{ id: "u1", username: "lion1", display_name: "Lion1", avatar_url: up("avatar-1.png") }],
};
const ALBUMS = Array.from({ length: 6 }, (_, index) => ({ id: `a${index}`, slug: `album-${index}`, title: `Album ${index + 1}`, cover_url: up(`album-${index}.png`), count: 12 }));
const BOARD = [1, 2].map((index) => ({ id: `b${index}`, display_title: "Vorstand", is_active: true, user: { display_name: `Lion${index}`, avatar_url: up(`avatar-b${index}.png`), slug: `mitglied-${index}` } }));
const SPONSORS = [1, 2, 3].map((index) => ({ id: `s${index}`, name: `Sponsor ${index}`, tier: index === 1 ? "main" : "gold", logo_url: up(`sponsor-${index}.png`), link: "https://sponsor.example.test" }));

const PAGES = ["/", "/members", "/members/mitglied-0", "/news/news-0", "/partners", "/partners/partner-0", "/galerie"];

async function mockSite(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const json = (body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at", logo_url: up("logo-wordmark.png"), logo_dark_url: up("logo-wordmark.png"), mascot_url: up("mascot-lion.png") });
    if (path === "/home/state") return json({ has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY, upcoming: EMPTY, news: NEWS, featured_news: [NEWS[0]], stats: {}, club_numbers: {} });
    if (path === "/board") return json(BOARD);
    if (path === "/sponsors") return json(SPONSORS);
    if (path === "/partners") return json(PARTNERS);
    if (path === "/partners/partner-0") return json(PARTNER);
    if (path === "/membership/profiles") return json(MEMBERS);
    if (path === "/membership/profiles/mitglied-0") return json(PROFILE);
    if (path === "/news/news-0") return json(ARTICLE);
    if (path === "/news") return json(NEWS);
    if (path === "/gallery") return json(ALBUMS);
    if (path.startsWith("/static/uploads/")) return route.fallback();
    return route.abort();
  });
}

async function scrollThrough(page) {
  // Bilder weiter unten laden erst beim Hinscrollen - einmal bis ans Ende und zurück.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.waitForLoadState("networkidle");
}

// Beide Geräte stellt der Test selbst ein - im Handy-Projekt liefe er doppelt.
test.skip(({ isMobile }) => Boolean(isMobile), "die Geräte stellt der Test selbst ein");

for (const device of DEVICES) {
  test(`${device.name}: jedes Bild in passender Größe, nie das Original`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });
    const page = await context.newPage();
    const uploads = await routeFakeUploads(page);
    await mockSite(page);
    const report = [];
    for (const path of PAGES) {
      uploads.length = 0;
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      // Erstes Laden: nur, was im ersten Bildschirm steht (der Rest lädt erst beim Hinscrollen).
      const firstLoad = uploads.reduce((sum, entry) => sum + entry.bytes, 0);
      expect(firstLoad, `${path}: ${Math.round(firstLoad / 1024)} KB Bilder beim ersten Laden`).toBeLessThanOrEqual(device.budget(path));
      const logo = uploads.filter((entry) => entry.name.startsWith("logo-"));
      expect(logo.length, `${path}: Logo geladen`).toBeGreaterThan(0);
      for (const entry of logo) expect(entry.bytes, `${path}: Logo ${entry.w} px`).toBeLessThanOrEqual(LOGO_BUDGET);
      await scrollThrough(page);
      const shown = await page.evaluate(() => [...document.images]
        .filter((img) => img.currentSrc.includes("/api/static/uploads/") && img.complete && img.getBoundingClientRect().width > 0)
        .map((img) => ({ src: img.currentSrc, natural: img.naturalWidth, rendered: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height, dpr: window.devicePixelRatio })));
      for (const img of shown) {
        const allowed = Math.max(160, 2 * Math.max(img.rendered, img.height) * img.dpr);
        expect(img.natural, `${path}: ${img.src} ist ${img.natural} px breit für ${Math.round(img.rendered)} px Anzeige`).toBeLessThanOrEqual(allowed);
      }
      const originals = uploads.filter((entry) => !entry.w);
      expect(originals.map((entry) => entry.path), `${path}: Originale geladen`).toEqual([]);
      const total = uploads.reduce((sum, entry) => sum + entry.bytes, 0);
      report.push(`${path}: ${shown.length} Bilder, erstes Laden ${Math.round(firstLoad / 1024)} KB, ganz gescrollt ${Math.round(total / 1024)} KB`);
    }
    await test.info().attach(`bilder-${device.name}.txt`, { body: report.join("\n"), contentType: "text/plain" });
    await context.close();
  });
}
