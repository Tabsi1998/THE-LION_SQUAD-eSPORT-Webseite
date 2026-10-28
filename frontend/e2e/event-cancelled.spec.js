const { test, expect } = require("@playwright/test");

// Abgesagtes Event (#2118): oben steht „Event abgesagt“ statt Anmeldung oder „Du bist dabei“; wer angemeldet war, liest,
// dass die Anmeldung mit storniert ist und der Kostenbeitrag nicht verrechnet wird. Am Handy (390 px) und am PC (1440 px)
// ohne seitliches Scrollen. Die API ist nachgestellt, die Uhr steht fest; Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const EVENT = {
  id: "e1", slug: "herbst-lan-2026", name: "Herbst-LAN 2026", status: "cancelled", visibility: "public", event_type: "lan",
  start_date: "2026-11-14T08:00:00+00:00", end_date: "2026-11-14T20:00:00+00:00", location: "Vereinsheim", city: "Telfs",
  has_registration: true, max_participants: 40,
  public_phase: { state: "cancelled", label: "Abgesagt" },
  registration_summary: { registered_count: 0, waitlist_count: 0, cancelled_count: 3, reserved_seats: 0, companion_count: 0, spots_left: 40 },
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [], partners: [], tournaments: [],
};

const OWN = {
  id: "r1", status: "cancelled", seat_count: 1, cancelled_with_event: true, can_cancel: false,
  price: { total_cents: 2000, currency: "EUR", positions: [], billing_status: "cancelled" },
};

async function mockApi(page, { user = null } = {}) {
  await page.clock.setFixedTime(new Date("2026-10-28T10:00:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/herbst-lan-2026") return route.fulfill(json({ ...EVENT, own_registration: user ? OWN : null }));
    if (path === "/api/events/herbst-lan-2026/friends") return route.fulfill(json({ sharing: true, hint: false, friends: [] }));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return user ? route.fulfill(json(user)) : route.fulfill(json({ detail: "anonym" }, 401));
    return route.abort();
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Abgesagtes Event", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("Gast bei 390 px: „Event abgesagt“, keine Anmeldung, nichts ragt hinaus", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto("/events/herbst-lan-2026");
    const notice = page.getByTestId("event-cancelled");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Event abgesagt");
    await expect(notice).toContainText("Dieses Event findet nicht statt.");
    await expect(page.getByTestId("event-yours")).toHaveCount(0);
    await expect(page.getByTestId("event-facts-register")).toHaveCount(0);
    await noSideScroll(page);
    await testInfo.attach("abgesagt-390.png", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  });

  test("Angemeldete Person bei 1440 px: Anmeldung mit storniert, kein „Du bist dabei“", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page, { user: { id: "u1", username: "testperson", display_name: "Testperson", role: "player", roles: ["player"], areas: [] } });
    await page.goto("/events/herbst-lan-2026");
    const notice = page.getByTestId("event-cancelled");
    await expect(notice).toContainText("Deine Anmeldung wurde mit der Absage storniert.");
    await expect(notice).toContainText("Kostenbeitrag wird nicht verrechnet");
    await expect(page.getByTestId("event-facts-own")).toHaveCount(0);
    await expect(page.getByTestId("event-own-registration")).toHaveCount(0);
    await expect(page.getByText("Du bist dabei")).toHaveCount(0);
    await noSideScroll(page);
    await testInfo.attach("abgesagt-1440.png", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  });
});
