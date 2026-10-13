const { test, expect } = require("@playwright/test");

// Das Event als Klammer (#1182): auf /events ist die Herbst-LAN eine Karte, ihre Turniere klappen darin auf; ein
// Online-Cup ohne Event steht für sich. Bei 390 px und 1440 px läuft nichts aus dem Bild. Die API ist nachgestellt.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const EVENTS = [
  { id: "e-lan", slug: "herbst-lan", name: "Herbst-LAN", event_type: "lan_party", status: "registration_open", visibility: "public", start_date: "2026-12-17T10:00:00+01:00", location: "Vereinsheim" },
];
const TOURNAMENTS = [
  { id: "t-rocket", slug: "rocket-cup", title: "Rocket Cup mit einem ziemlich langen Namen für schmale Bildschirme", event_id: "e-lan", status: "registration_open", start_date: "2026-12-18T14:00:00+01:00", team_mode: "team", game: { name: "Rocket League" } },
  { id: "t-kart", slug: "kart-cup", title: "Kart Cup", event_id: "e-lan", status: "registration_open", start_date: "2026-12-17T12:00:00+01:00", team_mode: "solo", game: { name: "Mario Kart 8" } },
  { id: "t-online", slug: "online-cup", title: "Online-Cup", status: "registration_open", start_date: "2026-12-10T19:00:00+01:00", team_mode: "solo" },
];
const FASTLAPS = [{ id: "f-lan", slug: "lan-lap", title: "LAN Fast Lap", event_id: "e-lan", status: "scheduled", start_date: "2026-12-17T10:00:00+01:00" }];

async function mockApi(page) {
  await page.clock.setFixedTime(new Date("2026-12-02T10:00:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/meta") return route.fulfill(json({ types: [{ k: "lan_party", l: "LAN-Party" }], statuses: [] }));
    if (path === "/api/events") return route.fulfill(json(EVENTS));
    if (path === "/api/tournaments") return route.fulfill(json(TOURNAMENTS));
    if (path === "/api/f1/challenges") return route.fulfill(json(FASTLAPS));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    return route.abort();
  });
}

test.describe("Events als Klammer", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [390, 1440]) {
    test(`bei ${width} px: eine Karte für die LAN, Turniere aufklappbar, nichts läuft über`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await page.goto("/events");
      const lan = page.getByTestId("event-card-herbst-lan");
      await expect(lan).toBeVisible();
      await expect(page.getByTestId("tournament-card-online-cup")).toBeVisible();
      await expect(page.getByTestId("tournament-card-rocket-cup")).toHaveCount(0);
      const toggle = lan.getByTestId("event-card-toggle-herbst-lan");
      await expect(toggle).toContainText("2 Turniere · 1 Fast Lap");
      await toggle.click();
      await expect(lan.getByTestId("event-child-tournament-t-rocket")).toContainText("Rocket League · Team");
      await expect(lan.getByTestId("event-child-tournament-t-kart")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // Die Karten blenden weich ein (Reveal) - das Bild erst danach.
      await page.waitForTimeout(900);
      await testInfo.attach(`events-klammer-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
