const { test, expect } = require("@playwright/test");

async function acceptCookies(page) {
  const button = page.getByRole("button", { name: /alle akzeptieren/i });
  if (await button.count()) await button.click();
}

async function mockPublicChrome(page) {
  await page.route("**/api/settings/public", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ club_name: "THE LION SQUAD", tagline: "eSports" }) });
  });
  await page.route("**/api/sponsors**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
}

async function expectNoPageXOverflow(page) {
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const viewport = root.clientWidth;
    return Math.max(root.scrollWidth, body.scrollWidth) - viewport;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test("public community structure is reachable", async ({ page }) => {
  await page.goto("/community");
  await acceptCookies(page);
  await expect(page.getByRole("heading", { name: /accounts,\s*teams\s*&\s*verein/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /profile öffnen/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /teams öffnen/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /mitglieder öffnen/i })).toBeVisible();
});

test("verein and community navigation are separated", async ({ page, isMobile }) => {
  await page.goto("/");
  await acceptCookies(page);
  if (isMobile) {
    await page.getByTestId("nav-mobile-toggle").click();
    await page.getByTestId("mobile-nav-verein").click();
    await expect(page.getByTestId("mobile-nav-sub-vereinsmitglieder")).toBeVisible();
    await expect(page.getByTestId("mobile-nav-sub-mitglied-werden")).toBeVisible();
    await page.getByTestId("mobile-nav-community").click();
    await expect(page.getByTestId("mobile-nav-sub-community-spieler")).toBeVisible();
    await expect(page.getByTestId("mobile-nav-sub-teams")).toBeVisible();
    return;
  }
  await page.getByTestId("nav-verein").hover();
  await expect(page.getByTestId("nav-sub-vereinsmitglieder")).toBeVisible();
  await expect(page.getByTestId("nav-sub-mitglied-werden")).toBeVisible();
  await page.getByTestId("nav-community").hover();
  await expect(page.getByTestId("nav-sub-community-spieler")).toBeVisible();
  await expect(page.getByTestId("nav-sub-teams")).toBeVisible();
});

test("club members render gamertag-first cards", async ({ page }) => {
  await page.route("**/api/membership/profiles", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "member-1",
          slug: "tabsi98",
          display_name: "Fabian Tabelander",
          gamertag: "Tabsi98",
          real_name: "Fabian Tabelander",
          role_title: "Obmann",
          photo_url: "",
          games: ["F1 25", "Mario Kart"],
          platforms: ["PC", "PS5"],
          level: 27,
        },
      ]),
    });
  });

  await page.goto("/members");
  await acceptCookies(page);

  const card = page.getByTestId("member-card-tabsi98");
  await expect(card).toBeVisible();
  await expect(card.getByText("Tabsi98")).toBeVisible();
  await expect(card.getByText("Fabian Tabelander")).toBeVisible();
  await expect(card.getByText("Obmann")).toBeVisible();
});

test("public profile social links render as icons without raw values", async ({ page }) => {
  await mockPublicChrome(page);
  await page.route("**/api/users/public/tabsi98", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-1",
        username: "tabsi98",
        display_name: "Tabsi98",
        bio: "",
        created_at: "2025-01-01T00:00:00Z",
        privacy_public_profile: true,
        discord_name: "tabsi98#1234",
        twitch_handle: "https://www.twitch.tv/tabsi98",
        youtube_handle: "https://www.youtube.com/@tabsi98",
        instagram_handle: "tabsi98",
        tiktok_handle: "@tabsi98",
        x_handle: "tabsi98",
        website: "https://lionsquad.at",
        stats: {},
        achievement_level: { level: 4, points: 320, next_level_points: 500, progress: 64 },
        tournaments: [],
        f1_bests: [],
        teams: [],
      }),
    });
  });
  await page.route("**/api/streams/live", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/api/achievements/user/user-1", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ groups: [], awards: [] }) });
  });

  await page.goto("/u/tabsi98");
  await acceptCookies(page);

  const socials = page.getByTestId("public-profile-socials");
  await expect(socials).toBeVisible();
  for (const key of ["discord", "twitch", "youtube", "instagram", "tiktok", "x", "website"]) {
    await expect(socials.getByTestId(`profile-social-${key}`)).toBeVisible();
  }
  await expect(socials).not.toContainText(/twitch\.tv|youtube\.com|instagram\.com|tiktok\.com|lionsquad\.at|tabsi98#1234/i);
});

test("public pages do not create horizontal page scroll on mobile and tablet", async ({ page }) => {
  await mockPublicChrome(page);
  await page.route("**/api/events/meta", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        primary_types: ["public_event", "f1_event"],
        types: [
          { k: "public_event", l: "Public Event" },
          { k: "f1_event", l: "F1 Event" },
        ],
      }),
    });
  });
  await page.route("**/api/events?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "event-1",
          slug: "gamers-heaven-2026",
          name: "Gamers Heaven 2026",
          description: "Ein Event mit Turnieren, Fast-Lap Challenges und Community.",
          event_type: "public_event",
          status: "scheduled",
          public_phase: { state: "announced", label: "Angekündigt", target_at: "2026-06-20T10:00:00+02:00", countdown_kind: "starts" },
          start_date: "2026-06-20T10:00:00+02:00",
          location: "Telfs",
          banner_url: "",
        },
      ]),
    });
  });
  await page.route("**/api/home/state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        has_live: false,
        live: { events: [], tournaments: [], challenges: [] },
        today: { events: [], tournaments: [], challenges: [] },
        soon: { events: [], tournaments: [], challenges: [] },
        upcoming: {
          events: [
            {
              id: "event-1",
              slug: "gamers-heaven-2026",
              name: "Gamers Heaven 2026",
              status: "scheduled",
              public_phase: { state: "announced", label: "Angekündigt", target_at: "2026-06-20T10:00:00+02:00", countdown_kind: "starts" },
              start_date: "2026-06-20T10:00:00+02:00",
            },
          ],
          tournaments: [],
          challenges: [
            {
              id: "f1-1",
              slug: "gamers-heaven-f1-25-fastest-lap-challenge-samstag",
              title: "Gamers Heaven • F1 25 • Fastest Lap Challenge | Samstag",
              status: "scheduled",
              public_phase: { state: "announced", label: "Angekündigt", target_at: "2026-06-20T10:00:00+02:00", countdown_kind: "starts" },
              start_date: "2026-06-20T10:00:00+02:00",
            },
          ],
        },
        news: [],
        featured_news: [],
      }),
    });
  });
  await page.route("**/api/twitch/live", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ streams: [] }) });
  });
  await page.route("**/api/seasons/current/standings", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/api/membership/profiles", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "member-1",
          slug: "tabsi98",
          display_name: "Fabian Tabelander",
          gamertag: "Tabsi98",
          real_name: "Fabian Tabelander",
          role_title: "Obmann",
          photo_url: "",
          games: ["F1 25", "Mario Kart"],
          platforms: ["PC", "PS5"],
          level: 27,
        },
      ]),
    });
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    for (const path of ["/", "/events", "/members"]) {
      await page.goto(path);
      await acceptCookies(page);
      await expectNoPageXOverflow(page);
    }
  }
});
