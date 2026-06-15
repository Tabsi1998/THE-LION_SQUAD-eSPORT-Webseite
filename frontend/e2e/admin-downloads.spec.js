const { test, expect } = require("@playwright/test");

async function mockAdminSession(page) {
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
        id: "admin-1",
        email: "admin@example.test",
        display_name: "Admin",
        username: "admin",
        role: "superadmin",
        is_tournament_staff: true,
      }),
    });
  });
  await page.route("**/api/settings/public", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        club_name: "THE LION SQUAD",
        domain: "lionsquad.at",
        mascot_url: "/assets/brand/tls-mascot.png",
        qr_logo_url: "/assets/brand/tls-mascot.png",
      }),
    });
  });
}

async function mockDownloadsData(page) {
  const tournament = {
    id: "t1",
    slug: "gamers-heaven-super-smash-bros-kleines-turnier-sonntag",
    title: "Gamers Heaven • Super Smash Bros • Kleines Turnier | Sonntag",
    status: "registration_open",
  };
  const challenge = {
    id: "f1-1",
    slug: "gamers-heaven-f1-25-fastest-lap-challenge-samstag",
    title: "Gamers Heaven • F1 25 • Fastest Lap Challenge | Samstag",
  };
  const event = {
    id: "event-1",
    slug: "gamers-heaven-2026",
    name: "Gamers Heaven 2026",
    tournaments: [tournament],
    f1_challenges: [challenge],
  };

  await page.route("**/api/tournaments?include_drafts=true", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([tournament]) });
  });
  await page.route("**/api/f1/challenges?include_drafts=true", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([challenge]) });
  });
  await page.route("**/api/f1/challenges/f1-1?include_draft=true", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...challenge, tracks: [{ id: "spielberg", name: "Spielberg | Red Bull Ring" }] }),
    });
  });
  await page.route("**/api/events?include_drafts=true", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([event]) });
  });
  await page.route("**/api/admin/gallery", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/api/events/event-1", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(event) });
  });
  await page.route("**/api/stations?event_id=event-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "station-a", name: "Station A", device_type: "Switch 2" }]),
    });
  });
  await page.route("**/api/stations?tournament_id=t1", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/api/tournaments/t1/bracket", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tournament,
        registrations: [
          { id: "r1", display_name: "Koblauchgeist" },
          { id: "r2", display_name: "DerSushi" },
        ],
        matches: [{ id: "m1", participant_a_id: "r1", participant_b_id: "r2", station_id: "station-a", station_label: "Station A" }],
        matches_v2: [],
      }),
    });
  });
}

async function expectNoPageXOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

test("admin downloads page renders QR previews and PDF links", async ({ page }) => {
  await mockAdminSession(page);
  await mockDownloadsData(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/downloads");

  await expect(page.getByRole("heading", { name: /downloads & qr/i })).toBeVisible();
  await page.getByRole("button", { name: /vor-ort qr/i }).click();

  await page.getByTestId("single-qr-source").selectOption("t1");
  await expect(page.getByTestId("branded-qr-code").first()).toBeVisible();
  const pdfHref = await page.getByRole("link", { name: /^pdf$/i }).first().getAttribute("href");
  expect(pdfHref).toContain("/api/exports/qr/sign.pdf");
  expect(pdfHref).toContain("Turnier-Anmeldung");

  await page.getByTestId("qr-event").selectOption("event-1");
  await expect(page.getByText("Eventdetails")).toBeVisible();
  await expect(page.getByText("Station A", { exact: true })).toBeVisible();
  await expect(page.getByText(/Koblauchgeist vs\. DerSushi/)).toBeVisible();
  await expectNoPageXOverflow(page);
});
