const { test, expect } = require("@playwright/test");

async function mockDisplayChrome(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true,
      external_media: false,
      analytics: false,
      meta: false,
      tiktok: false,
      saved_at: Date.now(),
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "staff-1",
        email: "staff@example.test",
        display_name: "Turnier Staff",
        role: "tournament_admin",
        is_tournament_staff: true,
      }),
    });
  });
  await page.route("**/api/settings/public", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        club_name: "THE LION SQUAD",
        tagline: "eSports",
        domain: "lionsquad.at",
        mascot_url: "/assets/brand/tls-mascot.png",
        qr_logo_url: "/assets/brand/tls-mascot.png",
      }),
    });
  });
  await page.route("**/api/sponsors**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "s1", name: "OmniFM" },
        { id: "s2", name: "IT-Tabelander" },
        { id: "s3", name: "Raiffeisenbank Tirol Mitte West" },
      ]),
    });
  });
}

async function mockBracketDisplay(page) {
  const registrations = Array.from({ length: 12 }, (_, index) => ({
    id: `r${index + 1}`,
    display_name: index < 4 ? ["Koblauchgeist", "DerSushi", "Angos", "RyuUu"][index] : `Spieler ${index + 1}`,
    user: { username: `spieler${index + 1}` },
  }));
  const matches = Array.from({ length: 12 }, (_, index) => ({
    id: `m${index + 1}`,
    round: index < 6 ? 1 : index < 10 ? 2 : 3,
    round_name: index < 6 ? "Runde 1" : index < 10 ? "Viertelfinale" : "Halbfinale",
    bracket: "winner",
    match_index: index,
    participant_a_id: registrations[(index * 2) % registrations.length].id,
    participant_b_id: registrations[(index * 2 + 1) % registrations.length].id,
    score_a: 0,
    score_b: 0,
    status: index % 3 === 0 ? "ready" : "scheduled",
    scheduled_at: "2026-06-21T13:00:00+02:00",
    station_id: index % 2 === 0 ? "A" : "B",
    station_label: index % 2 === 0 ? "Station A - Switch 2" : "Station B - Switch 2",
    duration_minutes: 20,
  }));

  await page.route("**/api/tournaments/t1/bracket/display", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tournament: {
          id: "t1",
          slug: "gamers-heaven-super-smash-bros-kleines-turnier-sonntag",
          title: "Gamers Heaven • Super Smash Bros • Kleines Turnier | Sonntag",
          status: "registration_open",
        },
        registrations,
        matches,
        matches_v2: [],
        stages: [],
      }),
    });
  });
}

async function mockEventDisplay(page) {
  await page.route("**/api/events/event-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "event-1",
        slug: "gamers-heaven-2026",
        name: "Gamers Heaven 2026",
        status: "live",
        start_date: "2026-06-21T10:00:00+02:00",
        location: "Telfs",
        city: "Tirol",
        tournaments: [{ id: "t1", title: "Gamers Heaven • Super Smash Bros • Kleines Turnier | Sonntag", status: "registration_open", participant_count: 12 }],
        f1_challenges: [{ id: "f1-1", title: "Gamers Heaven • F1 25 • Fastest Lap Challenge | Samstag", status: "live", track_count: 1 }],
      }),
    });
  });
  await page.route("**/api/stations?event_id=event-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "A", name: "Station A", status: "busy", device_type: "Switch 2", current_match_id: "m1" },
        { id: "B", name: "Station B", status: "available", device_type: "Switch 2" },
        { id: "C", name: "Station C", status: "reserved", device_type: "PC" },
      ]),
    });
  });
  await page.route("**/api/stations?tournament_id=t1", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
}

async function mockF1Display(page) {
  await page.route("**/api/f1/challenges/f1-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "f1-1",
        slug: "gamers-heaven-f1-25-fastest-lap-challenge-samstag",
        title: "Gamers Heaven • F1 25 • Fastest Lap Challenge | Samstag",
        is_championship: false,
        tracks: [{ id: "track-1", slug: "spielberg", name: "Spielberg | Red Bull Ring", country: "Österreich" }],
      }),
    });
  });
  await page.route("**/api/f1/challenges/f1-1/leaderboard?track_id=track-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        track: { id: "track-1", name: "Spielberg | Red Bull Ring", country: "Österreich" },
        entries: [
          { user_id: "u1", rank: 1, display_name: "Fabian", time_str: "1:21.337", gap_str: "Leader", attempts: 4 },
          { user_id: "u2", rank: 2, display_name: "Koblauchgeist", time_str: "1:22.010", gap_str: "+0.673", attempts: 3 },
          { user_id: "u3", rank: 3, display_name: "DerSushi", time_str: "1:22.845", gap_str: "+1.508", attempts: 2 },
        ],
        club_reference_entries: [],
      }),
    });
  });
}

async function expectNoPageXOverflow(page) {
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectBrandedQrVisible(page) {
  const qr = page.getByTestId("branded-qr-code").first();
  await expect(qr).toBeVisible();
  await expect(qr.locator("svg")).toBeVisible();
  await expect(qr.locator("img")).toBeVisible();
  await expect.poll(async () => qr.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0)).toBeTruthy();
  const mask = await qr.locator("svg").evaluate((svg) => getComputedStyle(svg).maskImage || getComputedStyle(svg).webkitMaskImage || "");
  expect(mask).toContain("radial-gradient");
}

async function expectTvPageStable(page, path, headingText) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: headingText })).toBeVisible();
  await expect(page.getByText(/konnte nicht geladen werden/i)).toHaveCount(0);
  await expectBrandedQrVisible(page);
  await expectNoPageXOverflow(page);
}

test.describe("TV and beamer display smoke checks", () => {
  test.beforeEach(async ({ page }) => {
    await mockDisplayChrome(page);
    await mockBracketDisplay(page);
    await mockEventDisplay(page);
    await mockF1Display(page);
  });

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    test(`display pages keep QR and content stable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await expectTvPageStable(page, "/display/bracket/t1", /gamers heaven/i);
      await expectTvPageStable(page, "/display/event/event-1", /gamers heaven 2026/i);
      await expectTvPageStable(page, "/display/f1/f1-1", /gamers heaven/i);
    });
  }
});
