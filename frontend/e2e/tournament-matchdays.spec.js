const { test, expect } = require("@playwright/test");

// Ein Spieltag ist eine Woche. Bisher standen alle Spieltage untereinander auf
// einer Seite; jetzt blättert man mit Pfeilen durch, und die Kopfzeile nennt
// den Zeitraum. Dazu steht an jeder Partie, warum dieser Termin gilt.

const TOURNAMENT = {
  id: "t-liga",
  slug: "winterliga",
  title: "Winterliga 2026",
  status: "live",
  format: "league",
  start_date: "2026-09-08T18:00:00+00:00",
};

function reg(id, name) {
  return { id, display_name: name };
}

function match(id, matchday, home, away) {
  return {
    id,
    match_key: id.toUpperCase(),
    matchday_number: matchday,
    round: matchday,
    section: "LIGA",
    match_type: "duel",
    status: "pending",
    slots: [{ registration_id: home }, { registration_id: away }],
  };
}

const MATCHES = [
  match("m1", 1, "r1", "r2"),
  match("m2", 1, "r3", "r4"),
  match("m3", 2, "r1", "r3"),
  match("m4", 3, "r1", "r4"),
];

function week(number, startsAt, endsAt, entries) {
  return { number, starts_at: startsAt, ends_at: endsAt, matches: entries };
}

const PLAN = {
  applies: true,
  current: 2,
  settings: { days: 7, weekday: 6, hour: 20, minute: 0 },
  matchdays: [
    week(1, "2026-09-08T18:00:00+00:00", "2026-09-15T18:00:00+00:00", [
      { match_id: "m1", scheduled_at: "2026-09-13T20:00:00+00:00", schedule_source: "default", home_registration_id: "r1" },
      { match_id: "m2", scheduled_at: "2026-09-10T19:00:00+00:00", schedule_source: "accepted", home_registration_id: "r3" },
    ]),
    week(2, "2026-09-15T18:00:00+00:00", "2026-09-22T18:00:00+00:00", [
      { match_id: "m3", scheduled_at: "2026-09-18T21:00:00+00:00", schedule_source: "home", home_registration_id: "r1" },
    ]),
    week(3, "2026-09-22T18:00:00+00:00", "2026-09-29T18:00:00+00:00", [
      { match_id: "m4", scheduled_at: "2026-09-27T20:00:00+00:00", schedule_source: "default", home_registration_id: "r1" },
    ]),
  ],
};

async function mockSchedule(page, { plan = PLAN } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/settings/public", (r) => r.fulfill(json({ club_name: "THE LION SQUAD" })));
  await page.route("**/api/sponsors**", (r) => r.fulfill(json([])));
  await page.route("**/api/auth/me", (r) => r.fulfill(json(null)));
  await page.route("**/api/tournaments/t-liga/matchdays**", (r) => r.fulfill(json(plan)));
  await page.route("**/api/tournaments/t-liga/bracket**", (r) => r.fulfill(json({
    tournament: TOURNAMENT,
    registrations: [reg("r1", "Alpha"), reg("r2", "Bravo"), reg("r3", "Charlie"), reg("r4", "Delta")],
    matches_v2: MATCHES,
    matches: [],
  })));
  await page.route("**/api/tournaments/winterliga**", (r) => r.fulfill(json(TOURNAMENT)));
}

test.describe("Spielplan als Spielwochen", () => {
  test("ein Spieltag wird als Woche mit Zeitraum gezeigt", async ({ page }) => {
    await mockSchedule(page);
    await page.goto("/tournaments/winterliga/matches");

    await expect(page.getByTestId("matchday-pager")).toBeVisible();
    // Die laufende Woche steht offen, nicht Spieltag 1.
    await expect(page.getByTestId("matchday-title")).toHaveText("Spieltag 2");
    await expect(page.getByTestId("matchday-range")).toHaveText("15.09. – 22.09.2026");
    await expect(page.getByTestId("matchday-matches").getByRole("link")).toHaveCount(1);
  });

  test("mit den Pfeilen blättert man durch die Wochen", async ({ page }) => {
    await mockSchedule(page);
    await page.goto("/tournaments/winterliga/matches");
    await expect(page.getByTestId("matchday-title")).toHaveText("Spieltag 2");

    await page.getByTestId("matchday-prev").click();
    await expect(page.getByTestId("matchday-title")).toHaveText("Spieltag 1");
    await expect(page.getByTestId("matchday-range")).toHaveText("08.09. – 15.09.2026");
    await expect(page.getByTestId("matchday-matches").getByRole("link")).toHaveCount(2);
    await expect(page.getByTestId("matchday-prev")).toBeDisabled();

    await page.getByTestId("matchday-next").click();
    await page.getByTestId("matchday-next").click();
    await expect(page.getByTestId("matchday-title")).toHaveText("Spieltag 3");
    await expect(page.getByTestId("matchday-next")).toBeDisabled();
  });

  test("an jeder Partie steht, warum dieser Termin gilt", async ({ page }) => {
    await mockSchedule(page);
    await page.goto("/tournaments/winterliga/matches");
    await expect(page.getByTestId("matchday-title")).toHaveText("Spieltag 2");

    await expect(page.getByTestId("schedule-source-m3")).toHaveText("Heimrecht");

    await page.getByTestId("matchday-prev").click();
    await expect(page.getByTestId("schedule-source-m1")).toHaveText("Standardzeit");
    await expect(page.getByTestId("schedule-source-m2")).toHaveText("vereinbart");
  });

  test("Formate mit Runden statt Wochen behalten ihre Gruppierung", async ({ page }) => {
    await mockSchedule(page, { plan: { applies: false, matchdays: [] } });
    await page.goto("/tournaments/winterliga/matches");

    await expect(page.getByRole("heading", { name: "Spielplan" })).toBeVisible();
    await expect(page.getByTestId("matchday-pager")).toHaveCount(0);
  });

  test("die Wochenansicht läuft am Telefon nicht quer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSchedule(page);
    await page.goto("/tournaments/winterliga/matches");
    await expect(page.getByTestId("matchday-pager")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
