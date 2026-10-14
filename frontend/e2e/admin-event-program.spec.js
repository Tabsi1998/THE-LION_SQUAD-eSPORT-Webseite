const { test, expect } = require("@playwright/test");

/**
 * Event als Klammer in der Verwaltung (#1371) und die Eventliste (#1373) bei drei Breiten:
 * - Eventliste mit einem vergangenen und einem künftigen Event - „Rückblick schreiben“ nur beim vergangenen,
 *   am Handy in der Karte; die Sichtbarkeit in Worten.
 * - Event bearbeiten: Programm mit Turnier, „+ Turnier in diesem Event“ führt zum Anlegen mit Vorbelegung,
 *   gespeichert wird über das Event.
 * Mit SHOT_DIR legt der Lauf Bildschirmfotos dort ab (nicht im Repo).
 */

const WIDTHS = [
  ["pc", 1440, 900],
  ["tablet", 768, 1024],
  ["handy", 390, 844],
];

// Die Zeitfelder zeigen die Uhr des Geräts - der Lauf tut so, als stünde der Rechner in Wien (CI läuft in UTC).
test.use({ timezoneId: "Europe/Vienna" });

const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });

const EVENTS = [
  { id: "ev-past", name: "Sommer-LAN 2026", slug: "sommer-lan", status: "scheduled", event_type: "lan_party", visibility: "members",
    start_date: "2026-07-10T10:00:00+02:00", end_date: "2026-07-12T16:00:00+02:00", location: "Vereinsheim",
    has_registration: true, max_participants: 40, registration_summary: { reserved_seats: 32, registered_count: 30, companion_count: 2 } },
  { id: "ev-next", name: "Winter-LAN 2099", slug: "winter-lan", status: "scheduled", event_type: "lan_party", visibility: "public",
    start_date: "2099-12-18T10:00:00+01:00", end_date: "2099-12-19T18:00:00+01:00", location: "Gemeindesaal Telfs" },
];

const PROGRAM = {
  event: { id: "ev-next", name: "Winter-LAN 2099", slug: "winter-lan", window: "vom 18.12.2099 bis 19.12.2099", location: "Gemeindesaal · Telfs" },
  tournaments: [{ id: "t1", title: "Mario Kart Grand Prix", slug: "mk-gp", status: "scheduled", start_date: "2099-12-18T14:00:00+01:00" }],
  fastlaps: [{ id: "f1", title: "Hotlap Monza", slug: "hotlap", status: "scheduled", start_date: "2099-12-18T10:00:00+01:00" }],
  candidates: { tournaments: [{ id: "t2", title: "Rocket League 2v2", start_date: "2099-12-19T12:00:00+01:00" }], fastlaps: [] },
  defaults: {
    tournament: { start_date: "2099-12-18T10:00:00+01:00", location: "Gemeindesaal · Telfs", partner_ids: [], discord_skip: false, discord_registration: true, event_mode: "local" },
    fastlap: { start_date: "2099-12-18T10:00:00+01:00", end_date: "2099-12-19T18:00:00+01:00" },
  },
  sponsors: { items: [{ id: "s1", name: "Pixelbäckerei" }], own_choice: false },
};

async function mockAdmin(page, created) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/auth/me", (route) => route.fulfill(json({
    id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin",
    role: "tournament_admin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true,
  })));
  await page.route("**/api/settings/public", (route) => route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" })));
  await page.route("**/api/games", (route) => route.fulfill(json([{ id: "game-1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8" }])));
  await page.route("**/api/partners**", (route) => route.fulfill(json([])));
  await page.route("**/api/access-links**", (route) => route.fulfill(json([])));
  await page.route("**/api/feedback/**", (route) => route.fulfill(json({ count: 0, items: [] })));
  // Playwright prüft die zuletzt eingetragene Route zuerst - die genaueren Event-Routen kommen nach der Liste.
  await page.route("**/api/events**", (route) => route.fulfill(json(EVENTS)));
  await page.route("**/api/events/meta", (route) => route.fulfill(json({
    types: [{ k: "lan_party", l: "LAN-Party" }],
    statuses: [{ k: "scheduled", l: "Angekündigt" }],
    visibilities: [{ k: "public", l: "Öffentlich", short: "Alle" }, { k: "members", l: "Nur Vereinsmitglieder", short: "Mitglieder" }],
  })));
  await page.route("**/api/events/ev-next/program", (route) => route.fulfill(json(PROGRAM)));
  await page.route("**/api/events/ev-next/tournaments", async (route) => {
    created.push(route.request().postDataJSON());
    await route.fulfill(json({ id: "t-new", title: "Neu" }));
  });
  await page.route("**/api/tournaments/t-new**", (route) => route.fulfill(json({ id: "t-new", title: "Neu", status: "draft" })));
}

async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function shot(target, name) {
  const dir = process.env.SHOT_DIR;
  if (dir) await target.screenshot({ path: `${dir}/${name}.png` });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Eventliste: Rückblick nur beim vergangenen Event, Sichtbarkeit in Worten", async ({ page }) => {
      await mockAdmin(page, []);
      await page.goto("/admin/events");
      const scope = width < 768 ? page.getByTestId("events-admin-cards") : page.locator("table");
      await expect(scope.getByText("Sommer-LAN 2026")).toBeVisible();
      await expect(scope.getByRole("button", { name: "Rückblick schreiben" })).toHaveCount(1);
      const pastRow = width < 768 ? page.getByTestId("event-card-ev-past") : page.locator("tr", { hasText: "Sommer-LAN 2026" });
      await expect(pastRow.getByRole("button", { name: "Rückblick schreiben" })).toBeVisible();
      const nextRow = width < 768 ? page.getByTestId("event-card-ev-next") : page.locator("tr", { hasText: "Winter-LAN 2099" });
      await expect(nextRow.getByRole("button", { name: "Rückblick schreiben" })).toHaveCount(0);
      await expect(pastRow).toContainText("Mitglieder");
      await expect(page.getByText(/^members$/i)).toHaveCount(0);
      await noHorizontalOverflow(page);
      await shot(page, `eventliste-${width}`);
    });

    test("Event: Programm zeigt Turniere, „+ Turnier in diesem Event“ legt mit Vorbelegung an", async ({ page }) => {
      const created = [];
      await mockAdmin(page, created);
      await page.goto("/admin/events/ev-next");
      const panel = page.getByTestId("event-program-panel");
      await expect(panel.getByText("Mario Kart Grand Prix")).toBeVisible();
      await expect(panel.getByText("Hotlap Monza")).toBeVisible();
      await expect(page.getByTestId("event-sponsors-list")).toContainText("Pixelbäckerei");
      await noHorizontalOverflow(page);
      await shot(panel.locator("xpath=ancestor::section[1]"), `event-programm-${width}`);
      await shot(page.getByTestId("event-sponsors"), `event-sponsoren-${width}`);

      await page.getByTestId("event-program-new-tournament").click();
      await expect(page.getByTestId("new-tr-event-hint")).toContainText("Winter-LAN 2099");
      await expect(page.getByTestId("new-tr-start")).toHaveValue("2099-12-18T10:00");
      await noHorizontalOverflow(page);
      await shot(page, `turnier-im-event-${width}`);
      await page.getByTestId("new-tr-title").fill("Smash Bros Cup");
      await page.getByTestId("new-tr-game").selectOption("game-1");
      await page.getByTestId("new-tr-submit").click();
      await expect.poll(() => created.length).toBe(1);
      expect(created[0]).toMatchObject({ title: "Smash Bros Cup", location: "Gemeindesaal · Telfs", event_mode: "local" });
      expect(created[0]).not.toHaveProperty("event_id");
    });
  });
}
