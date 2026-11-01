const { test, expect } = require("@playwright/test");

// Volles Event (#2127): Das Formular sagt schon vor dem Absenden, dass es auf die Warteliste geht - ohne Preis auf dem
// Knopf, auch wenn es nur an den Begleitpersonen liegt. „Angemeldet“ nennt nur, wer einen Platz hat; die Warteliste steht
// getrennt, nach zwölf Namen „+N weitere“. Die API ist nachgestellt, Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const USER = { id: "u1", username: "testperson", display_name: "Testperson", role: "player", roles: ["player"], areas: [] };
const PEOPLE = Array.from({ length: 14 }, (_, index) => ({ id: `p${index}`, display_name: `Person ${index + 1}`, status: "registered", seat_count: 1 }));

function event(extra = {}) {
  return {
    id: "e1", slug: "herbst-lan", name: "Herbst-LAN", status: "registration_open", visibility: "public", event_type: "lan_party", show_participants: true,
    start_date: "2026-12-05T10:00:00+01:00", end_date: "2026-12-05T22:00:00+01:00", location: "Vereinsheim", has_registration: true,
    max_participants: 15, allow_companions: true, max_companions_per_registration: 2,
    offer: { enabled: true, currency: "EUR", version: 1, positions: [{ key: "ticket", label: "Eintritt", amount_cents: 1000, basis: "per_person", optional: false }] },
    public_phase: { state: "registration_open", label: "Anmeldung offen" },
    registration_summary: { registered_count: 14, reserved_seats: 14, companion_count: 0, waitlist_count: 1, spots_left: 1 },
    registrations: PEOPLE, waitlist_registrations: [{ id: "w1", display_name: "Ella Wartend", status: "waitlist", seat_count: 1 }],
    own_registration: null, sponsors: [], albums: [], news: [], f1_challenges: [], partners: [], tournaments: [], ...extra,
  };
}

async function mockApi(page, current) {
  await page.clock.setFixedTime(new Date("2026-11-20T10:00:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const posted = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json(USER));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/events/herbst-lan") return route.fulfill(json(current));
    if (path === "/api/events/herbst-lan/friends") return route.fulfill(json({ sharing: true, hint: false, friends: [] }));
    if (path === "/api/events/e1/registrations" && request.method() === "POST") {
      posted.push(request.postDataJSON());
      return route.fulfill(json({ id: "r1", status: "waitlist", seat_count: 1 }));
    }
    if (request.method() === "GET") return route.fulfill(json({}));
    return route.abort();
  });
  return posted;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Warteliste am Event", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [label, width, height] of [["Handy", 390, 844], ["PC", 1440, 900]]) {
    test(`${label} (${width} px): Knopf nach dem Platz, Warteliste getrennt, „+N weitere“`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      const posted = await mockApi(page, event());
      await page.goto("/events/herbst-lan");

      const submit = page.getByTestId("event-register-submit");
      await expect(submit).toContainText("Verbindlich anmelden");
      await page.getByTestId("event-register-form").locator('input[type="number"]').fill("1");
      await expect(submit).toContainText("Auf die Warteliste");
      await expect(submit).not.toContainText("€");
      await expect(page.getByTestId("event-waitlist-note")).toContainText("Nur noch 1 Platz frei");
      await expect(page.getByTestId("event-quote")).toHaveCount(0);

      const active = page.getByTestId("event-participants");
      await expect(active).toContainText("Person 12");
      await expect(active).not.toContainText("Person 13");
      await expect(active).not.toContainText("Ella Wartend");
      await expect(page.getByTestId("event-waitlist")).toContainText("Ella Wartend");
      await page.getByTestId("event-participants-more").click();
      await expect(active).toContainText("Person 14");
      await noSideScroll(page);
      await testInfo.attach(`warteliste-${width}.png`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });

      await submit.click();
      await expect(page.getByText("Du stehst auf der Warteliste. Wird ein Platz frei, bekommst du Bescheid.")).toBeVisible();
      expect(posted).toHaveLength(1);
    });
  }
});
