const { test, expect } = require("@playwright/test");

// Die Vereinsschriften (#1228): nach dem Laden sind Unbounded, Outfit und Rajdhani wirklich da, jede Schrift kommt
// vom eigenen Server (keine Anfrage bei Google), und die Ziffern von Rajdhani sind gleich breit.

const OWN_HOSTS = new Set(["127.0.0.1", "localhost"]);
const CUTS = ["400 16px Outfit", "800 16px Outfit", "700 20px Unbounded", "800 20px Unbounded", "600 20px Rajdhani", "700 20px Rajdhani"];

async function mockQuiet(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/settings/public")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }) });
    }
    if (url.includes("/api/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    if (url.includes("/api/home/state")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, news: [], featured_news: [], stats: {}, club_numbers: {} }) });
    return route.abort();
  });
}

test("die drei Vereinsschriften kommen vom eigenen Server und sind nach dem Laden da", async ({ page }) => {
  const foreign = [];
  const fontFiles = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const type = request.resourceType();
    if (type === "font") fontFiles.push(url.pathname);
    if ((type === "font" || type === "stylesheet" || /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) && !OWN_HOSTS.has(url.hostname)) {
      foreign.push(request.url());
    }
  });
  await mockQuiet(page);
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();

  const state = await page.evaluate(async (cuts) => {
    await document.fonts.ready;
    // Rajdhani und Unbounded 700 holt der Browser erst, wenn eine Seite sie zeigt - hier gezielt anfordern.
    await Promise.all(cuts.map((cut) => document.fonts.load(cut)));
    const loaded = [...document.fonts].filter((face) => face.status === "loaded").map((face) => `${face.family.replace(/["']/g, "")} ${face.weight}`);
    const context = document.createElement("canvas").getContext("2d");
    const width = (font, text) => {
      context.font = font;
      return context.measureText(text).width;
    };
    return {
      loaded,
      ready: cuts.map((cut) => document.fonts.check(cut)),
      heading: getComputedStyle(document.querySelector("h1")).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
      digits: ["600 40px Rajdhani", "700 40px Rajdhani"].map((font) => [width(font, "1111"), width(font, "8888"), width(font, "0000")]),
      // Gegenprobe, dass wirklich Rajdhani misst: Rajdhani ist schmal geschnitten, jede Ersatzschrift setzt dasselbe
      // Wort deutlich breiter. Ziffern taugen dafür nicht - unter Linux ist „8888“ in der Ersatzschrift fast gleich breit.
      word: ["700 40px Rajdhani", "700 40px sans-serif"].map((font) => width(font, "Wettkampf Rangliste")),
    };
  }, CUTS);

  expect(state.loaded).toEqual(expect.arrayContaining(["Outfit 400 800", "Unbounded 700", "Unbounded 800", "Rajdhani 600", "Rajdhani 700"]));
  expect(state.ready).toEqual(CUTS.map(() => true));
  expect(state.heading).toMatch(/^"?Unbounded"?/);
  expect(state.body).toMatch(/^"?Outfit"?/);
  for (const [ones, eights, zeros] of state.digits) {
    expect(Math.abs(ones - eights)).toBeLessThan(0.5);
    expect(Math.abs(zeros - eights)).toBeLessThan(0.5);
  }
  const [rajdhaniWord, fallbackWord] = state.word;
  expect(fallbackWord - rajdhaniWord).toBeGreaterThan(fallbackWord * 0.1);
  expect(fontFiles.length).toBeGreaterThan(0);
  for (const file of fontFiles) expect(file).toMatch(/^\/fonts\/[a-z0-9-]+\.woff2$/);
  expect(foreign).toEqual([]);
});
