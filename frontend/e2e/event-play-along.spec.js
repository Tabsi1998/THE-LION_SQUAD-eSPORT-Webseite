const { test, expect } = require("@playwright/test");

// „Spielst du auch mit?“ (#1184): nach der Event-Anmeldung zwei Turniere in einem Schritt anmelden - eines voll
// (Warteliste), eines mit Startgeld. Ein Doppelklick schickt nur eine Anfrage; vom Turnier mit Event-Pflicht (#875)
// gekommen geht es danach zurück. Bei 390 px läuft nichts aus dem Bild. Die API ist nachgestellt.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const user = { id: "user-1", username: "paula", display_name: "Paula", role: "player", user_type: "community_user" };
const START = "2026-12-17T14:00:00+01:00";
const CUPS = [
  { id: "t-kart", slug: "kart-cup", title: "Kart Cup", event_id: "e-lan", status: "registration_open", public_phase: { state: "registration_open" }, start_date: START, team_mode: "solo" },
  { id: "t-mini", slug: "mini-cup", title: "Mini Cup", event_id: "e-lan", status: "registration_open", public_phase: { state: "registration_open" }, start_date: "2026-12-17T18:00:00+01:00", team_mode: "solo" },
  { id: "t-rocket", slug: "rocket-cup", title: "Rocket Cup", event_id: "e-lan", status: "registration_open", public_phase: { state: "registration_open" }, start_date: START, team_mode: "team" },
];
const ENTRIES = [
  { kind: "tournament", id: "t-kart", slug: "kart-cup", title: "Kart Cup", start_date: START, mode: "Einzel", game: "Mario Kart 8", team: false,
    fee: { total_cents: 1000, currency: "EUR" }, spots_left: 5, full: false, selectable: true, reason: null, captain: false, my_status: null },
  { kind: "tournament", id: "t-mini", slug: "mini-cup", title: "Mini Cup", start_date: "2026-12-17T18:00:00+01:00", mode: "Einzel", game: "Tetris", team: false,
    fee: null, spots_left: 0, full: true, selectable: true, reason: null, captain: false, my_status: null },
  { kind: "tournament", id: "t-rocket", slug: "rocket-cup", title: "Rocket Cup", start_date: START, mode: "Team", game: "Rocket League", team: true,
    fee: null, spots_left: 8, full: false, selectable: false, reason: "Dein Kapitän meldet das Team an.", captain: false, my_status: null },
];

async function mockApi(page, calls) {
  await page.clock.setFixedTime(new Date("2026-12-02T10:00:00+00:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  let own = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill(json(user));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/events/herbst-lan") {
      return route.fulfill(json({
        id: "e-lan", slug: "herbst-lan", name: "Herbst-LAN", status: "registration_open", visibility: "public", has_registration: true,
        public_phase: { state: "registration_open", label: "Anmeldung" }, start_date: "2026-12-17T10:00:00+01:00", location: "Vereinsheim",
        registration_summary: { registered_count: own ? 1 : 0, reserved_seats: own ? 1 : 0, companion_count: 0 }, own_registration: own,
        registrations: [], sponsors: [], albums: [], news: [], tournaments: CUPS, f1_challenges: [],
      }));
    }
    if (path === "/api/events/e-lan/registrations" && request.method() === "POST") {
      own = { id: "r1", user_id: user.id, status: "registered", seat_count: 1, companion_count: 0 };
      return route.fulfill(json(own));
    }
    if (path === "/api/events/e-lan/play-along" && request.method() === "GET") return route.fulfill(json({ show: true, entries: ENTRIES }));
    if (path === "/api/events/e-lan/play-along" && request.method() === "POST") {
      calls.push(request.postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 250));
      return route.fulfill(json({
        results: [
          { id: "t-kart", title: "Kart Cup", state: "registered", label: "Du bist dabei", detail: null, price: { total_cents: 1000, currency: "EUR" } },
          { id: "t-mini", title: "Mini Cup", state: "waitlist", label: "Warteliste", detail: null, price: null },
        ],
        total_cents: 1000, currency: "EUR",
      }));
    }
    if (request.method() === "GET") return route.fulfill(json({}));
    return route.abort();
  });
}

test.describe("Spielst du auch mit?", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  test("bei 390 px: Event plus zwei Turniere in einem Schritt, Doppelklick schickt eine Anfrage", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const calls = [];
    await mockApi(page, calls);
    await page.goto("/events/herbst-lan");
    await page.getByTestId("event-register-submit").click();

    const sheet = page.getByTestId("play-along-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Spielst du auch mit?" })).toBeVisible();
    await expect(sheet.getByTestId("play-along-note-t-rocket")).toHaveText("Dein Kapitän meldet das Team an.");
    await expect(sheet.getByTestId("play-along-check-t-rocket")).toHaveCount(0);
    await sheet.getByLabel(/Kart Cup/).check();
    await sheet.getByLabel(/Mini Cup/).check();
    await expect(sheet.getByTestId("play-along-sum")).toContainText("10,00 €");
    await sheet.getByTestId("play-along-rules").check();
    await sheet.getByTestId("play-along-costs").check();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await sheet.getByTestId("play-along-row-t-kart").boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(48);
    await testInfo.attach("spielst-du-mit-390.png", { body: await page.screenshot(), contentType: "image/png" });

    await sheet.getByTestId("play-along-form").evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect(sheet.getByTestId("play-along-result")).toBeVisible();
    expect(calls).toEqual([{ tournament_ids: ["t-kart", "t-mini"], accept_rules: true, accept_privacy: true, accept_costs: true }]);
    await expect(sheet.getByTestId("play-along-result-t-kart")).toContainText("Du bist dabei · 10,00 €");
    await expect(sheet.getByTestId("play-along-result-t-mini")).toContainText("Warteliste");
    await expect(sheet.getByTestId("play-along-total")).toContainText("10,00 €");
    await sheet.getByTestId("play-along-done").click();
    await expect(sheet).toHaveCount(0);
  });

  test("vom Turnier mit Event-Pflicht: vorausgewählt, „Nein danke“ führt zurück", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page, []);
    await page.goto("/events/herbst-lan?turnier=kart-cup");
    await page.getByTestId("event-register-submit").click();
    await expect(page.getByTestId("play-along-check-t-kart")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/tournaments\/kart-cup$/);
  });
});
