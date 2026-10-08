const { test, expect } = require("@playwright/test");

/**
 * Mehrtägige Events (#884): die Event-Seite zeigt den Zeitraum im Kopf, je Tag eine Karte (laufend, als
 * Nächstes, vorbei), das Turnier im Programm nennt seinen Tag, der Kalender-Knopf bietet je Tag Google und
 * Outlook und eine ICS-Datei mit allen Tagen. Im Admin-Formular ersetzt der Schalter Start, Ende und Einlass
 * durch die Tage. Beides ohne Querlauf am Handy. Die API-Antworten sind nachgestellt.
 */

const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });

const SCHEDULE = {
  multi_day: true, count: 3, label: "3 Tage · Fr 16.10. – So 18.10.", range_label: "Fr 16.10. – So 18.10.", next_at: "2026-10-18T08:00:00+00:00",
  days: [
    { index: 1, date: "2026-10-16", label: "Fr 16.10.", time_label: "18:00–23:00", start: "18:00", end: "23:00", door: "17:00", title: "Warm-up", location_key: null, location_name: null, start_at: "2026-10-16T16:00:00+00:00", end_at: "2026-10-16T21:00:00+00:00", door_at: "2026-10-16T15:00:00+00:00", ends_next_day: false, state: "past" },
    { index: 2, date: "2026-10-17", label: "Sa 17.10.", time_label: "10:00–22:00", start: "10:00", end: "22:00", door: null, title: null, location_key: "ort-1", location_name: "Vereinsheim", start_at: "2026-10-17T08:00:00+00:00", end_at: "2026-10-17T20:00:00+00:00", door_at: null, ends_next_day: false, state: "running" },
    { index: 3, date: "2026-10-18", label: "So 18.10.", time_label: "10:00–16:00", start: "10:00", end: "16:00", door: null, title: "Finaltag mit Siegerehrung", location_key: null, location_name: null, start_at: "2026-10-18T08:00:00+00:00", end_at: "2026-10-18T14:00:00+00:00", door_at: null, ends_next_day: false, state: "next" },
  ],
  now: { state: "running", day_index: 2, text: "Heute 10:00–22:00" },
};

const EVENT = {
  id: "event-1", slug: "lan-wochenende", name: "LAN-Wochenende", status: "live", visibility: "public", event_type: "lan",
  start_date: "2026-10-16T16:00:00+00:00", end_date: "2026-10-18T14:00:00+00:00", door_time: "2026-10-16T15:00:00+00:00",
  location: "Vereinsheim", city: "Telfs", description: "Drei Tage LAN.",
  public_phase: { state: "live", label: "Tag 2/3 läuft", target_at: null, countdown_kind: null },
  schedule: SCHEDULE,
  days: SCHEDULE.days.map(({ date, start, end, door, title, location_key, start_at, end_at, door_at }) => ({ date, start, end, door, title, location_key, start_at, end_at, door_at })),
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [],
  tournaments: [{ id: "t1", slug: "samstags-cup", title: "Samstags-Cup", status: "scheduled", start_date: "2026-10-17T10:00:00+00:00", public_phase: { state: "announced", label: "Angekündigt" }, event_day: { index: 2, count: 3, label: "Sa 17.10.", date: "2026-10-17" } }],
};

async function mockChrome(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/settings/public", (route) => route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" })));
  await page.route("**/api/sponsors**", (route) => route.fulfill(json([])));
  await page.route("**/api/partners**", (route) => route.fulfill(json([])));
}

async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "kein Querlauf").toBeLessThanOrEqual(0);
}

test("Event-Seite: Zeitraum, Tageskarten, Tag des Turniers und Kalender je Tag", async ({ page }, testInfo) => {
  // Der Kalender-Knopf fällt nach dem letzten Tag weg (#1221) - die Uhr steht deshalb auf Tag 2.
  await page.clock.setFixedTime(new Date("2026-10-17T10:00:00+00:00"));
  await mockChrome(page);
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, ...json({ detail: "anonym" }) }));
  await page.route("**/api/events/lan-wochenende", (route) => route.fulfill(json(EVENT)));
  await page.route("**/api/tournaments/t1/bracket**", (route) => route.fulfill(json({ matches: [], registrations: [] })));
  await page.goto("/events/lan-wochenende");

  await expect(page.getByTestId("event-days-summary")).toHaveText("3 Tage · Fr 16.10. – So 18.10. · Heute 10:00–22:00");
  const block = page.getByTestId("event-days");
  await expect(block.getByRole("heading", { name: "Die Tage" })).toBeVisible();
  await expect(page.getByTestId("event-day-1")).toHaveAttribute("data-state", "past");
  await expect(page.getByTestId("event-day-1")).toContainText("Einlass 17:00");
  await expect(page.getByTestId("event-day-2")).toContainText("Läuft");
  await expect(page.getByTestId("event-day-2").locator(".tls-live-dot")).toHaveCount(1);
  await expect(page.getByTestId("event-day-3")).toContainText("Als Nächstes");
  await expect(page.getByTestId("event-day-3")).toContainText("Finaltag mit Siegerehrung");
  await expect(page.getByTestId("embed-event-day")).toHaveText("Tag 2/3");

  await expect(page.getByTestId("add-to-calendar-days").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("add-to-calendar-ics")).toHaveAttribute("href", "/api/calendar/events/lan-wochenende.ics");
  const google = await page.getByTestId("add-to-calendar-google-2").getAttribute("href");
  expect(decodeURIComponent(google.replace(/\+/g, " "))).toContain("LAN-Wochenende – Tag 2/3");

  await noHorizontalOverflow(page);
  const shotDir = process.env.SHOT_DIR;
  if (shotDir) await block.screenshot({ path: `${shotDir}/event-days-${testInfo.project.name}.png` });
});

test("Admin-Formular: Schalter ersetzt Start, Ende und Einlass durch die Tage", async ({ page }, testInfo) => {
  await mockChrome(page);
  await page.route("**/api/auth/me", (route) => route.fulfill(json({
    id: "admin-1", email: "admin@example.test", display_name: "Admin", username: "admin",
    role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true,
  })));
  await page.route("**/api/games", (route) => route.fulfill(json([])));
  await page.route("**/api/events**", (route) => route.fulfill(json([EVENT])));
  await page.route("**/api/events/meta", (route) => route.fulfill(json({
    types: [{ k: "general", l: "Allgemein" }, { k: "lan", l: "LAN" }],
    statuses: [{ k: "draft", l: "Entwurf" }, { k: "scheduled", l: "Angekündigt" }, { k: "live", l: "Live" }],
    visibilities: [{ k: "public", l: "Öffentlich" }],
  })));
  await page.route("**/api/tournaments**", (route) => route.fulfill(json([])));
  await page.route("**/api/f1/challenges**", (route) => route.fulfill(json([])));
  await page.route("**/api/access-links**", (route) => route.fulfill(json([])));
  await page.route("**/api/partners**", (route) => route.fulfill(json([])));
  await page.goto("/admin/events/event-1");

  await expect(page.getByTestId("event-days-toggle")).toBeChecked();
  await expect(page.getByTestId("event-start")).toHaveCount(0);
  await expect(page.getByTestId("event-day-0")).toContainText("Tag 1 · Fr 16.10.");
  await expect(page.getByTestId("event-day-door-0")).toHaveValue("17:00");
  await expect(page.getByTestId("event-day-title-2")).toHaveValue("Finaltag mit Siegerehrung");
  await expect(page.getByTestId("event-days-error")).toHaveCount(0);

  await page.getByTestId("event-days-add").click();
  await expect(page.getByTestId("event-day-date-3")).toHaveValue("2026-10-19");
  await expect(page.getByTestId("event-day-start-3")).toHaveValue("10:00");
  await page.getByTestId("event-day-remove-3").click();
  await expect(page.getByTestId("event-day-3")).toHaveCount(0);

  await page.getByTestId("event-days-toggle").click();
  await expect(page.getByTestId("event-start")).toHaveValue("2026-10-16T18:00");
  await expect(page.getByTestId("event-end")).toHaveValue("2026-10-18T16:00");
  await page.getByTestId("event-days-toggle").click();
  await expect(page.getByTestId("event-day-date-1")).toHaveValue("2026-10-17");

  await noHorizontalOverflow(page);
  const shotDir = process.env.SHOT_DIR;
  if (shotDir) await page.getByTestId("event-days").screenshot({ path: `${shotDir}/event-days-admin-${testInfo.project.name}.png` });
});
