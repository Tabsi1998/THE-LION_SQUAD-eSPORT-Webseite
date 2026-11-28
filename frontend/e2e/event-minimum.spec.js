const { test, expect } = require("@playwright/test");

/**
 * Mindestanzahl bis zu einer Frist (#2614) bei 390 und 1440 px:
 * - Event-Seite: im Fakten-Kasten „Findet ab 8 Personen statt“ und „Noch 3 bis Fr 18. Dezember · 18:00“.
 * - Verwaltung: Einstellung und Stand (Frist vorbei, zu wenige) mit Vorschlag; „Event absagen …“ öffnet das Blatt mit dem
 *   Vorschlag als Grund und schickt Status und Grund in einem Schritt.
 * Die API ist nachgestellt, die Uhr steht fest, der Rechner tut so, als stünde er in Wien. Namen sind erfunden.
 * Mit SHOT_DIR legt der Lauf Bildschirmfotos dort ab (nicht im Repo).
 */

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
test.use({ timezoneId: "Europe/Vienna" });

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const DEADLINE = "2026-12-18T17:00:00+00:00";
const PROPOSAL = "Zu wenige Anmeldungen: Bis Fr 18.12. 18:00 waren 5 von mindestens 8 Personen dabei.";

const EVENT = {
  id: "ev-1", slug: "silvester-2026", name: "Silvester im Vereinsheim", status: "registration_open", visibility: "public", event_type: "general",
  start_date: "2026-12-31T17:00:00+00:00", end_date: "2027-01-01T01:00:00+00:00", location: "Vereinsheim", city: "Telfs",
  has_registration: true, allow_companions: true, max_companions_per_registration: 3, max_participants: 40, show_participants: false,
  public_phase: { state: "registration_open", label: "Anmeldung offen" },
  registration_summary: { registered_count: 3, waitlist_count: 0, checked_in_count: 0, reserved_seats: 5, companion_count: 2, spots_left: 35, max_participants: 40 },
  min_registrations: { count: 8, deadline: DEADLINE, count_companions: true, public: true },
  minimum: { count: 8, have: 5, missing: 3, companions: 2, deadline: DEADLINE, count_companions: true, public: true, deadline_passed: false, state: "open" },
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [], partners: [], tournaments: [], own_registration: null,
};

const ADMIN_EVENT = {
  ...EVENT, active_registration_count: 3,
  min_registrations_notice: { deadline: DEADLINE, at: "2026-12-18T17:15:00+00:00", count: 8, have: 5 },
  minimum: { ...EVENT.minimum, deadline_passed: true, state: "short", proposal: PROPOSAL },
};

async function base(page, now) {
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
}

async function shot(target, name) {
  const dir = process.env.SHOT_DIR;
  if (dir) await target.screenshot({ path: `${dir}/${name}.png` });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function mockPublic(page) {
  await base(page, "2026-12-15T10:00:00+00:00");
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/silvester-2026") return route.fulfill(json(EVENT));
    if (path === "/api/events/silvester-2026/friends") return route.fulfill(json({ sharing: true, hint: false, friends: [] }));
    if (path === "/api/events/silvester-2026/notices") return route.fulfill(json([]));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    return route.abort();
  });
}

async function mockAdmin(page, patches) {
  await base(page, "2026-12-18T18:00:00+00:00");
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      return route.fulfill(json({ id: "admin-1", email: "leitung@example.test", display_name: "Leitung", username: "leitung", role: "tournament_admin",
        is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true }));
    }
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/events/meta") {
      return route.fulfill(json({ types: [{ k: "general", l: "Allgemein" }], statuses: [{ k: "scheduled", l: "Angekündigt" }, { k: "registration_open", l: "Anmeldung offen" }, { k: "cancelled", l: "Abgesagt" }],
        visibilities: [{ k: "public", l: "Öffentlich", short: "Alle" }] }));
    }
    if (path === "/api/admin/events/ev-1") return route.fulfill(json(ADMIN_EVENT));
    if (path === "/api/events/ev-1" && request.method() === "PATCH") {
      patches.push(request.postDataJSON());
      return route.fulfill(json({ ...ADMIN_EVENT, status: "cancelled", cancellation: { registrations: 3, notified: 3, orders: 0 } }));
    }
    if (path === "/api/events/ev-1/program") return route.fulfill(json({ event: { id: "ev-1", name: EVENT.name }, tournaments: [], fastlaps: [], candidates: { tournaments: [], fastlaps: [] }, defaults: {}, sponsors: { items: [], own_choice: false } }));
    if (path === "/api/events") return route.fulfill(json([]));
    if (path.startsWith("/api/partners") || path.startsWith("/api/access-links")) return route.fulfill(json([]));
    if (path.startsWith("/api/feedback/")) return route.fulfill(json({ count: 0, items: [] }));
    return route.fulfill(json({}));
  });
}

test.describe("Mindestanzahl bis zu einer Frist", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [label, width, height] of WIDTHS) {
    test(`Event-Seite bei ${width} px (${label}): „Findet ab 8 Personen statt – noch 3 bis …“`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockPublic(page);
      await page.goto("/events/silvester-2026");
      const row = page.getByTestId("event-facts-minimum");
      await expect(row).toContainText("Mindestzahl");
      await expect(row).toContainText("Findet ab 8 Personen statt");
      await expect(row).toContainText("Noch 3 bis Fr 18. Dezember · 18:00");
      await noSideScroll(page);
      await shot(page.getByTestId("event-facts"), `event-seite-${width}`);
    });

    test(`Verwaltung bei ${width} px (${label}): Stand mit Vorschlag, Absage in einem Schritt mit Grund`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const patches = [];
      await mockAdmin(page, patches);
      await page.goto("/admin/events/ev-1");
      const section = page.getByTestId("event-minimum");
      await expect(page.getByTestId("event-minimum-enabled")).toBeChecked();
      await expect(page.getByTestId("event-minimum-count")).toHaveValue("8");
      await expect(page.getByTestId("event-minimum-deadline")).toHaveValue("2026-12-18T18:00");
      await expect(page.getByTestId("event-minimum-chip")).toContainText("Zu wenige");
      await expect(page.getByTestId("event-minimum-summary")).toContainText("5 von 8 Personen (davon 2 Begleitpersonen) · Frist war");
      await expect(page.getByTestId("event-minimum-proposal")).toContainText("Vorschlag: absagen");
      await section.scrollIntoViewIfNeeded();
      await noSideScroll(page);
      await shot(section, `verwaltung-${width}`);

      await page.getByTestId("event-minimum-cancel").click();
      const sheet = page.getByTestId("event-cancel-sheet");
      await expect(sheet).toBeVisible();
      await expect(page.getByTestId("event-cancel-reason")).toHaveValue(PROPOSAL);
      await expect(page.getByTestId("event-cancel-consequences")).toContainText("3 Anmeldungen (samt Warteliste) werden storniert");
      await shot(page, `absage-blatt-${width}`);
      await page.getByTestId("event-cancel-confirm").click();
      await expect.poll(() => patches.length).toBe(1);
      expect(patches[0]).toEqual({ status: "cancelled", cancel_reason: PROPOSAL });
    });
  }
});
