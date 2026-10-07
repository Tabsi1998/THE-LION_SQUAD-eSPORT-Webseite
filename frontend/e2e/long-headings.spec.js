const { test, expect } = require("@playwright/test");

// Lange Überschriften und Namen am Handy (#1218): bei 360, 390 und 768 px läuft auf Startseite, Vereinsmitglieder,
// Benachrichtigungen, Verwaltung und in beiden Profilen kein Wort aus dem Bild; ein Name mit 24 Zeichen steht im
// Profilkopf in höchstens zwei Zeilen. Die API ist nachgestellt, die Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const LONG_NAME = "NachtfalkeDerSuperliga24";
const PLAYER = { id: "u1", username: "pixelpanther", display_name: "PixelPanther", role: "player", roles: ["player"], areas: [], email_verified: true };
const ADMIN = { id: "u9", username: "orga-test", display_name: "Orga Test", role: "club_admin", roles: ["club_admin"], areas: ["tournaments", "content", "club", "finance", "system", "moderation"], email_verified: true, mfa_enabled: true, auth_mfa_verified: true };
const MEMBER = { id: "mp1", slug: "nachtfalke", display_name: LONG_NAME, gamertag: LONG_NAME, role_title: "Kassier", bio: "", games: [], platforms: [], references: [], reference_stats: {} };
const PROFILE = { id: "u5", username: "nachtfalke24", display_name: LONG_NAME, role: "player", country: "AT", created_at: "2025-03-01T10:00:00+00:00", stats: {}, teams: [], tournaments: [], awards: [], achievement_level: { level: 7, progress: 40 } };

const PAGES = [
  { path: "/", user: null },
  { path: "/members", user: null },
  { path: "/notifications", user: PLAYER },
  { path: "/admin", user: ADMIN },
  { path: "/members/nachtfalke", user: null, name: "member-head-name" },
  { path: "/u/nachtfalke24", user: null, name: "profile-head-name" },
];

async function mockApi(page, user) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return user ? route.fulfill(json(user)) : route.fulfill(json({ detail: "anonym" }, 401));
    if (path === "/api/home/state") return route.fulfill(json({ has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, news: [], featured_news: [], stats: {}, club_numbers: {} }));
    if (path === "/api/membership/profiles") return route.fulfill(json([MEMBER]));
    if (path === "/api/membership/profiles/nachtfalke") return route.fulfill(json(MEMBER));
    if (path === "/api/users/public/nachtfalke24") return route.fulfill(json(PROFILE));
    if (path === "/api/streams/live") return route.fulfill(json([]));
    return route.abort();
  });
}

/** Überschriften und Namen, die breiter sind als ihr Kasten oder rechts aus dem Bild ragen. */
async function overflowingHeadings(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll("h1, h2")]
      .filter((el) => el.getClientRects().length)
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > width + 1)
      .map((el) => `${el.tagName}: ${el.textContent.trim().slice(0, 40)} (${el.scrollWidth} > ${el.clientWidth})`);
  });
}

test.describe("Lange Überschriften und Namen", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const width of [360, 390, 768]) {
    test(`bei ${width} px läuft keine Überschrift aus dem Bild, ein langer Name hat höchstens zwei Zeilen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const item of PAGES) {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await mockApi(page, item.user);
        await page.goto(item.path);
        await expect(page.locator("h1").first()).toBeVisible();
        if (item.name) await expect(page.getByTestId(item.name)).toHaveText(LONG_NAME);
        expect(await overflowingHeadings(page), `${item.path} bei ${width} px`).toEqual([]);
        const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(pageOverflow, `${item.path}: kein Querlauf`).toBeLessThanOrEqual(1);
        if (item.name) {
          const lines = await page.getByTestId(item.name).evaluate((el) => {
            const style = window.getComputedStyle(el);
            const inner = el.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            return Math.round(inner / parseFloat(style.lineHeight));
          });
          expect(lines, `${item.path}: Name in höchstens zwei Zeilen`).toBeLessThanOrEqual(2);
        }
      }
    });
  }
});
