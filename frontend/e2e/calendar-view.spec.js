const { test, expect } = require("@playwright/test");

// Kalender-Ansicht (#1271, #1190): bei 390 px startet die Liste, eine dreitägige LAN ist eine Zeile; bei 1440 px der
// aktuelle Monat mit „Heute“, die LAN als ein Balken über ihre Tage und die Versammlung eines Mitglieds als grüner Punkt.
// Die API ist nachgestellt, die Uhr steht fest.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const LAN = [17, 18, 19].map((day, index) => ({
  id: `e-lan-tag-${index + 1}`, kind: "event", slug: "lan", title: `Herbst-LAN – Tag ${index + 1}/3`, start: `2026-12-${day}T10:00:00+01:00`, end: `2026-12-${day}T22:00:00+01:00`,
  status: "scheduled", phase: null, location: "Vereinsheim", path: "/events/lan", visibility: "public", mine: false, marker: "event_day", event_id: "e-lan", event_name: "Herbst-LAN",
}));

const MEETING = {
  id: "meeting-7", kind: "club", club_kind: "meeting", title: "Generalversammlung 2026", start: "2026-12-05T17:00:00+00:00", end: "2026-12-05T19:00:00+00:00", all_day: false,
  day: "2026-12-05", status: "invited", phase: { label: "Eingeladen", state: "invited" }, location: "Vereinsheim", path: "/members/meetings?meeting=7", visibility: "members", mine: false, marker: "meeting",
};

async function mockApi(page) {
  await page.clock.setFixedTime(new Date("2026-12-02T10:00:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/calendar") return route.fulfill(json({ items: [...LAN, MEETING], signed_in: true, feed_path: "/api/calendar/feed.ics" }));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    return route.abort();
  });
}

test.describe("Kalender-Ansicht", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("bei 390 px startet die Liste, die LAN ist eine Zeile", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto("/calendar");
    const list = page.getByTestId("calendar-list");
    await expect(list).toBeVisible();
    await expect(page.getByTestId("calendar-grid")).toHaveCount(0);
    await expect(list.getByTestId("calendar-list-month-2026-12")).toContainText("Dezember 2026");
    await expect(list.getByTestId("calendar-item-event-e-lan")).toContainText("Do 17. – Sa 19. Dezember");
    await expect(list.getByTestId("calendar-item-club-meeting-7")).toContainText("Versammlung");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await testInfo.attach("kalender-liste-390.png", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("bei 1440 px der aktuelle Monat mit einem Balken für die LAN", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await page.goto("/calendar");
    await expect(page.getByTestId("calendar-title")).toHaveText("Dezember 2026");
    await expect(page.getByTestId("calendar-today")).toBeVisible();
    const bar = page.getByTestId("calendar-bar-event-e-lan");
    await expect(bar).toHaveCount(1);
    await expect(bar).toContainText("Herbst-LAN");
    const [first, last, barBox] = await Promise.all([
      page.getByTestId("calendar-day-2026-12-17").boundingBox(),
      page.getByTestId("calendar-day-2026-12-19").boundingBox(),
      bar.boundingBox(),
    ]);
    expect(Math.abs(barBox.x - first.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(barBox.x + barBox.width - (last.x + last.width))).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("calendar-dot-2026-12-05-club")).toBeVisible();
    await testInfo.attach("kalender-monat-1440.png", { body: await page.screenshot(), contentType: "image/png" });
  });
});
