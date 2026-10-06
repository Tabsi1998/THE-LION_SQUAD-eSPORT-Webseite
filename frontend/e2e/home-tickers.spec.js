const { test, expect } = require("@playwright/test");

// Startseite (#968): oben das Sponsoren-Laufband (etwas größer, Überschrift „Sponsoren“), darunter das
// kleinere Partner-Laufband („Partner“, nur Partner mit Logo, Logo führt auf die Partnerseite). Ohne
// Partner-Logos kein zweites Band. Bei 390, 768, 1440 und 2560 px kein seitliches Überlaufen; mit
// „Bewegung reduzieren“ stehen beide Bänder still. Bilder in SHOT_DIR.

const SHOTS = process.env.SHOT_DIR || "";
const WIDTHS = [390, 768, 1440, 2560];

function logo(name, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240">`
    + `<rect x="8" y="8" width="624" height="224" rx="24" fill="${color}" opacity="0.9"/>`
    + `<text x="320" y="150" text-anchor="middle" font-family="Arial" font-size="72" font-weight="900" fill="#0A0A0A">${name}</text></svg>`;
}
const SPONSORS = [
  { id: "s1", name: "Raika", tier: "main", link: "https://raika.test", logo_url: "/api/static/uploads/public/logo-raika.svg" },
  { id: "s2", name: "Energie Tirol", tier: "gold", link: "https://energie.test", logo_url: "/api/static/uploads/public/logo-energie.svg" },
  { id: "s3", name: "Pixel Print", tier: "silver", link: "https://print.test", logo_url: "/api/static/uploads/public/logo-print.svg" },
];
const PARTNERS = [
  { id: "p1", slug: "gamers-heaven", name: "Gamers Heaven", logo_url: "/api/static/uploads/public/logo-heaven.svg", link: "https://heaven.test", channels: [] },
  { id: "p2", slug: "esport-verein-b", name: "eSport Verein B", logo_url: "/api/static/uploads/public/logo-vereinb.svg", channels: [] },
  { id: "p3", slug: "lan-crew", name: "LAN Crew", logo_url: "/api/static/uploads/public/logo-lancrew.svg", channels: [] },
  { id: "p4", slug: "ohne-logo", name: "Ohne Logo", logo_url: null, channels: [] },
];
const COLORS = { raika: "#FFD700", energie: "#29B6E8", print: "#9F7AEA", heaven: "#00FF88", vereinb: "#FF8C42", lancrew: "#E0E0E0" };
const EMPTY = { events: [], tournaments: [], challenges: [] };
const HOME = { has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY, upcoming: EMPTY, news: [], featured_news: [], stats: {}, club_numbers: {} };

async function mockServer(page, { partners = PARTNERS } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }) }));
  await page.route("**/api/home/state", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(HOME) }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(SPONSORS) }));
  await page.route("**/api/partners", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(partners) }));
  await page.route("**/api/static/uploads/public/logo-*", (route) => {
    const key = (route.request().url().match(/logo-([a-z]+)\.svg/) || [0, "raika"])[1];
    return route.fulfill({ contentType: "image/svg+xml", body: logo(key.toUpperCase(), COLORS[key] || "#FFFFFF") });
  });
}

test.describe("Startseite: Sponsoren und Partner als zwei Laufbänder", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stellt der Test selbst ein");

  for (const width of WIDTHS) {
    test(`bei ${width} px: Sponsoren über Partnern, Partner kleiner, nichts läuft über`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await mockServer(page);
      await page.goto("/");
      // Das kompakte Band im Footer trägt dieselbe Kennung - gemeint ist das große mit der Überschrift.
      const sponsors = page.getByTestId("sponsor-ticker").filter({ has: page.getByTestId("sponsor-ticker-title") });
      const partners = page.getByTestId("partner-ticker");
      await expect(sponsors).toBeVisible();
      await expect(partners).toBeVisible();
      await expect(sponsors.getByTestId("sponsor-ticker-title")).toHaveText("Sponsoren");
      await expect(partners.locator("span").first()).toHaveText("Partner");
      await expect(partners.getByTitle("Ohne Logo")).toHaveCount(0);
      await expect(partners.getByTitle("Gamers Heaven").first()).toHaveAttribute("href", "/partners/gamers-heaven");

      const sponsorBox = await sponsors.boundingBox();
      const partnerBox = await partners.boundingBox();
      expect(partnerBox.y).toBeGreaterThanOrEqual(sponsorBox.y + sponsorBox.height - 1);
      const sponsorLogo = await sponsors.getByTitle("Raika").first().boundingBox();
      const partnerLogo = await partners.getByTitle("Gamers Heaven").first().boundingBox();
      expect(partnerLogo.height).toBeLessThan(sponsorLogo.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

      if (SHOTS) {
        // Bild aus dem sichtbaren Bereich: unter den klebenden Kopf scrollen, damit weder Kopf noch
        // die feste Leiste unten am Handy im Ausschnitt liegen.
        const header = await page.locator("header").first().boundingBox();
        const headerHeight = header ? Math.ceil(header.height) : 0;
        await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, Math.round(sponsorBox.y) - headerHeight - 8));
        await page.waitForTimeout(400);
        const shownSponsors = await sponsors.boundingBox();
        const shownPartners = await partners.boundingBox();
        const top = Math.max(0, Math.round(shownSponsors.y) - 8);
        await page.screenshot({ path: `${SHOTS}/startseite-laufband-${width}.png`, clip: { x: 0, y: top, width, height: Math.round(shownSponsors.height + shownPartners.height) + 16 } });
      }
    });
  }

  test("ohne Partner mit Logo gibt es kein zweites Band", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { partners: [PARTNERS[3]] });
    await page.goto("/");
    await expect(page.getByTestId("sponsor-ticker-title")).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("partner-ticker")).toHaveCount(0);
  });

  test("mit „Bewegung reduzieren“ stehen beide Bänder still", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockServer(page);
    await page.goto("/");
    await expect(page.getByTestId("partner-ticker")).toBeVisible();
    const states = await page.evaluate(() => [...document.querySelectorAll(".tls-logo-ticker__track")].map((track) => getComputedStyle(track).animationPlayState));
    // Sponsoren, Partner und das kompakte Band im Footer - alle stehen.
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states.every((state) => state === "paused")).toBe(true);
  });
});
