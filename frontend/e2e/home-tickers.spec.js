const { test, expect } = require("@playwright/test");

// Logo-Bänder (#968, Nachzug vom 06.10.2026): auf der Startseite bleibt das große Sponsoren-Band mit Überschrift.
// Im Footer jeder Seite stehen die Sponsoren kompakt und direkt darunter, eine Stufe kleiner, die Partner (nur
// Partner mit Logo, das Logo führt auf die Partnerseite). Beide Footer-Bänder liegen auf demselben Grund, keines
// bringt eine eigene Fläche mit. Über jedem Band steht eine kleine Überschrift; über den Sponsoren ist so viel Luft
// wie unter den Partnern, dazwischen klarer Abstand, und die Partner stehen dichter als die Sponsoren.
// Jedes Logo füllt die Höhe seines Kastens - auch eine winzige Vorlage wächst mit.
// Ohne Partner-Logos kein zweites Band, ohne Sponsoren und Partner kein Block. Bei 390, 768, 1440 und 2560 px
// läuft nichts seitlich über; mit „Bewegung reduzieren“ stehen alle Bänder still. Bilder in SHOT_DIR.

const SHOTS = process.env.SHOT_DIR || "";
const WIDTHS = [390, 768, 1440, 2560];

// Bewusst gemischt wie echte Vereinslogos: Wortmarke quer, Emblem quadratisch, winzige Vorlage.
function wordmark(name, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240">`
    + `<rect x="8" y="8" width="624" height="224" rx="24" fill="${color}" opacity="0.9"/>`
    + `<text x="320" y="150" text-anchor="middle" font-family="Arial" font-size="72" font-weight="900" fill="#0A0A0A">${name}</text></svg>`;
}
function emblem(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">`
    + `<circle cx="200" cy="200" r="190" fill="${color}"/><circle cx="200" cy="200" r="120" fill="#0A0A0A"/></svg>`;
}
function tiny(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="40" height="30" rx="4" fill="${color}"/></svg>`;
}
const LOGOS = {
  raika: wordmark("RAIKA", "#FFD700"),
  energie: wordmark("ENERGIE", "#29B6E8"),
  print: wordmark("PRINT", "#9F7AEA"),
  heaven: wordmark("HEAVEN", "#00FF88"),
  vereinb: emblem("#FF8C42"),
  lancrew: tiny("#E0E0E0"),
};
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
const EMPTY = { events: [], tournaments: [], challenges: [] };
const HOME = { has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY, upcoming: EMPTY, news: [], featured_news: [], stats: {}, club_numbers: {} };

async function mockServer(page, { partners = PARTNERS, sponsors = SPONSORS } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }) }));
  await page.route("**/api/home/state", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(HOME) }));
  await page.route("**/api/sponsors**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(sponsors) }));
  await page.route("**/api/partners", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(partners) }));
  await page.route("**/api/static/uploads/public/logo-*", (route) => {
    const key = route.request().url().split("logo-")[1].split(".svg")[0];
    return route.fulfill({ contentType: "image/svg+xml", body: LOGOS[key] || LOGOS.raika });
  });
}

test.describe("Logo-Bänder: Sponsoren groß auf der Startseite, Sponsoren und Partner im Footer", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "die Breiten stellt der Test selbst ein");

  for (const width of WIDTHS) {
    test(`bei ${width} px: im Footer Sponsoren über Partnern, Partner kleiner, gleicher Grund, nichts läuft über`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      await mockServer(page);
      await page.goto("/");
      // Startseite: das große Band mit der Überschrift bleibt; ein eigenes Partner-Band hat sie nicht mehr.
      await expect(page.getByTestId("sponsor-ticker-title")).toHaveText("Sponsoren");
      const bands = page.locator("footer").getByTestId("footer-logo-bands");
      const sponsors = bands.getByTestId("sponsor-ticker");
      const partners = bands.getByTestId("partner-ticker");
      await expect(sponsors).toBeVisible();
      await expect(partners).toBeVisible();
      await expect(page.getByTestId("partner-ticker")).toHaveCount(1);
      await expect(partners).toHaveAttribute("aria-label", "Partner");
      await expect(partners.getByTitle("Ohne Logo")).toHaveCount(0);
      await expect(partners.getByTitle("Gamers Heaven").first()).toHaveAttribute("href", "/partners/gamers-heaven");

      const sponsorBox = await sponsors.boundingBox();
      const partnerBox = await partners.boundingBox();
      expect(partnerBox.y).toBeGreaterThanOrEqual(sponsorBox.y + sponsorBox.height - 1);
      const sponsorLogo = await sponsors.getByTitle("Raika").first().boundingBox();
      const partnerLogo = await partners.getByTitle("Gamers Heaven").first().boundingBox();
      expect(partnerLogo.height).toBeLessThan(sponsorLogo.height);

      // Kleine Überschriften trennen die Bänder. Über den Sponsoren ist so viel Luft wie unter den Partnern, zwischen
      // den Reihen liegt deutlich mehr als ein Zeilenabstand, und die kleineren Partner-Logos stehen dichter.
      const sponsorHeading = sponsors.getByTestId("sponsor-ticker-heading");
      const partnerHeading = partners.getByTestId("partner-ticker-heading");
      await expect(sponsorHeading).toHaveText("Sponsoren");
      await expect(partnerHeading).toHaveText("Partner");
      const bandsBox = await bands.boundingBox();
      const ctaBox = await page.getByTestId("footer-cta").boundingBox();
      const above = (await sponsorHeading.boundingBox()).y - (ctaBox.y + ctaBox.height);
      const below = bandsBox.y + bandsBox.height - (partnerLogo.y + partnerLogo.height);
      expect(Math.abs(above - below)).toBeLessThanOrEqual(6);
      expect((await partnerHeading.boundingBox()).y - (sponsorLogo.y + sponsorLogo.height)).toBeGreaterThanOrEqual(32);
      const sponsorPitch = (await sponsors.getByTitle("Energie Tirol").first().boundingBox()).x - sponsorLogo.x;
      const partnerPitch = Math.abs((await partners.getByTitle("eSport Verein B").first().boundingBox()).x - partnerLogo.x);
      expect(partnerPitch).toBeLessThan(Math.abs(sponsorPitch) * 0.75);

      // Gleicher Grund: keines der beiden Bänder bringt eine eigene Fläche oder Linie mit.
      const looks = await page.evaluate(() => ["sponsor-ticker", "partner-ticker"].map((id) => {
        const node = document.querySelector(`footer [data-testid="footer-logo-bands"] [data-testid="${id}"]`);
        const style = getComputedStyle(node);
        return `${style.backgroundColor}|${style.borderTopWidth}|${style.borderBottomWidth}`;
      }));
      expect(looks[0]).toBe("rgba(0, 0, 0, 0)|0px|0px");
      expect(looks[1]).toBe(looks[0]);

      // Jedes Logo füllt die Höhe seines Kastens - Wortmarke, Emblem und die winzige Vorlage gleich.
      for (const name of ["Gamers Heaven", "eSport Verein B", "LAN Crew"]) {
        const link = partners.getByTitle(name).first();
        const linkBox = await link.boundingBox();
        const drawn = await link.locator("canvas, img").first().boundingBox();
        expect(Math.abs(drawn.height - linkBox.height), name).toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

      if (SHOTS) {
        await bands.evaluate((node) => node.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(600);
        const shown = await bands.boundingBox();
        await page.screenshot({ path: `${SHOTS}/footer-logobaender-${width}.png`, clip: { x: 0, y: Math.max(0, Math.round(shown.y) - 16), width, height: Math.round(shown.height) + 32 } });
      }
    });
  }

  test("fährt die Maus über ein Logo, treten die anderen im selben Band zurück", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    const partners = page.locator("footer").getByTestId("partner-ticker");
    await partners.scrollIntoViewIfNeeded();
    // Das Band steht für die Messung still: ein laufendes Logo lässt sich nicht sicher treffen.
    await page.addStyleTag({ content: ".tls-logo-ticker__track { animation: none !important; }" });
    const heaven = partners.getByTitle("Gamers Heaven").first();
    const other = partners.getByTitle("eSport Verein B").first();
    await heaven.hover();
    await page.waitForTimeout(400);
    expect(Number(await heaven.evaluate((node) => getComputedStyle(node).opacity))).toBe(1);
    expect(Number(await other.evaluate((node) => getComputedStyle(node).opacity))).toBeCloseTo(0.4, 1);
    // Das Sponsoren-Band darüber bleibt, wie es ist.
    const sponsor = page.locator("footer").getByTestId("sponsor-ticker").getByTitle("Raika").first();
    expect(Number(await sponsor.evaluate((node) => getComputedStyle(node).opacity))).toBeCloseTo(0.8, 1);
  });

  test("ohne Partner mit Logo gibt es kein zweites Band", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { partners: [PARTNERS[3]] });
    await page.goto("/");
    await expect(page.getByTestId("footer-logo-bands").getByTestId("sponsor-ticker")).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("partner-ticker")).toHaveCount(0);
  });

  test("ohne Sponsoren und ohne Partner fällt der Block samt Linie weg", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { partners: [], sponsors: [] });
    await page.goto("/");
    await expect(page.getByTestId("footer-columns")).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("footer-logo-bands")).toBeHidden();
  });

  test("mit „Bewegung reduzieren“ stehen alle Bänder still", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockServer(page);
    await page.goto("/");
    await expect(page.getByTestId("partner-ticker")).toBeVisible();
    const states = await page.evaluate(() => [...document.querySelectorAll(".tls-logo-ticker__track")].map((track) => getComputedStyle(track).animationPlayState));
    // Sponsoren groß, Sponsoren im Footer, Partner im Footer - alle stehen.
    expect(states.length).toBeGreaterThanOrEqual(3);
    expect(states.every((state) => state === "paused")).toBe(true);
  });
});
