const path = require("path");
const { test, expect } = require("@playwright/test");

// Liga auf der Startseite (#2324) bei 390 und 1440 px, Server nachgestellt, nur erfundene Namen: Hinweis bei offener Anmeldung unter
// dem Kopf und die Season in „Nächste Termine“. Kein seitliches Scrollen. Mit SHOTS_DIR legt der Test Bilder für die Abnahme ab.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const WIDTHS = [[390, 844], [1440, 900]];
const DAY = 24 * 60 * 60 * 1000;
const BRAND = path.join(__dirname, "..", "public", "assets", "brand");
const IMAGES = { "probe-banner.png": path.join(BRAND, "og-default.png"), "probe-emblem.png": path.join(BRAND, "tls-favicon.png") };

const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

function season({ id, slug, title, closesIn = 12, banner = true, slotsFree = 3 }) {
  const closes = iso(closesIn);
  return {
    id, kind: "league", slug, title, league_name: title.split(" · ")[0], season_name: "Season 1",
    url: `/liga/${slug}/season-1`, apply_url: `/liga/${slug}/season-1/anmelden`,
    start_date: iso(closesIn + 4), end_date: iso(closesIn + 74), sort_at: closes,
    public_phase: { state: "registration_open", label: "Anmeldung offen", target_at: closes, countdown_kind: "registration_closes" },
    application: { state: "open", opens_at: iso(-5), closes_at: closes, slots: 16, slots_free: slotsFree, waitlist: true, waitlist_full: false, entry_policy: "all" },
    emblem_url: "/api/static/uploads/probe-emblem.png",
    banner: banner ? { url: "/api/static/uploads/probe-banner.png", x: 50, y: 50, mobile_x: 50, mobile_y: 50 } : null,
    accent_color: null,
  };
}

const OPEN = season({ id: "s1", slug: "probe-liga", title: "Probe-Liga Tirol · Season 1" });
const ANNOUNCED = {
  ...season({ id: "s2", slug: "zweite-liga", title: "Zweite Probe-Liga · Season 1", banner: false }),
  application: null, sort_at: iso(30), start_date: iso(30), end_date: iso(100),
  public_phase: { state: "announced", label: "Angekündigt", target_at: iso(30), countdown_kind: "starts" },
};
const CUP = { id: "t1", slug: "herbst-cup", title: "Herbst-Cup", status: "registration_open", start_date: iso(5),
  public_phase: { state: "registration_open", label: "Anmeldung offen", target_at: iso(4), countdown_kind: "registration_closes" },
  live_counts: { registered: 12, capacity: 16, running_matches: 0 } };

function homeState(leagues) {
  return { has_live: false, live: {}, today: {}, soon: { tournaments: [CUP] }, upcoming: {}, leagues, news: [], featured_news: [], stats: {} };
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function mock(page, state) {
  await page.addInitScript(CONSENT);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname.startsWith("/changes")) return route.abort();
    const image = IMAGES[pathname.split("/").pop()];
    if (pathname.startsWith("/static/uploads/") && image) return route.fulfill({ path: image });
    if (pathname === "/auth/me") return json(null);
    if (pathname === "/home/state") return json(state);
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active", "/friends"];
    return json(objects.includes(pathname) ? {} : []);
  });
}

for (const [width, height] of WIDTHS) {
  test.describe(`Liga auf der Startseite bei ${width} px`, () => {
    test.use({ viewport: { width, height } });

    test("offene Anmeldung: Hinweis unter dem Kopf, Season in „Nächste Termine“", async ({ page }) => {
      await mock(page, homeState([OPEN, ANNOUNCED]));
      await page.goto("/");
      const promo = page.getByTestId("home-league-promo-probe-liga");
      await expect(promo).toBeVisible();
      await expect(promo).toContainText("Probe-Liga Tirol · Season 1");
      await expect(page.getByTestId("home-league-promo-seats-probe-liga")).toHaveText("3 von 16 Startplätzen frei");
      await expect(page.getByTestId("home-league-promo-apply-probe-liga")).toHaveAttribute("href", "/liga/probe-liga/season-1/anmelden");
      await expect(page.getByTestId("home-league-promo-zweite-liga")).toHaveCount(0);

      const row = page.getByTestId("home-next-league-probe-liga");
      await expect(row).toContainText("Anmeldung offen · endet");
      await expect(row).toHaveAttribute("href", "/liga/probe-liga/season-1");
      await expect(page.getByTestId("home-next-league-zweite-liga")).toContainText("Angekündigt");
      await noSideScroll(page);

      if (process.env.SHOTS_DIR) {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(900); // Einblenden (Reveal) abwarten
        await promo.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `startseite-liga-hinweis-${width}.png`), fullPage: false });
        await page.getByTestId("home-next-up").scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await page.getByTestId("home-next-up").screenshot({ path: path.join(process.env.SHOTS_DIR, `startseite-naechste-termine-${width}.png`) });
      }

      await page.getByTestId("home-league-promo-page-probe-liga").click();
      await expect(page).toHaveURL(/\/liga\/probe-liga\/season-1$/);
    });

    test("zwei offene Seasons stehen kompakt, voll ohne Warteliste nur „Zur Ligaseite“", async ({ page }) => {
      const full = { ...season({ id: "s3", slug: "volle-liga", title: "Volle Probe-Liga mit einem sehr langen Namen · Season 1", banner: false, slotsFree: 0 }) };
      full.application = { ...full.application, waitlist: false };
      await mock(page, homeState([OPEN, full]));
      await page.goto("/");
      await expect(page.getByTestId("home-league-promo-volle-liga")).toBeVisible();
      await expect(page.getByTestId("home-league-promo-volle-liga")).toHaveAttribute("data-compact", "true");
      await expect(page.getByTestId("home-league-promo-apply-volle-liga")).toHaveCount(0);
      await expect(page.getByTestId("home-league-promo-seats-volle-liga")).toHaveText("Alle 16 Startplätze vergeben");
      await noSideScroll(page);
    });
  });
}
