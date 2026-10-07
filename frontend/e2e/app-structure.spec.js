const { test, expect } = require("@playwright/test");

// App-Aufbau I im Web (#1143-#1150): die Handy-Leiste mit den fünf Einträgen der App, der Tipp auf den aktiven Eintrag,
// die Seite /verein, die Chats, die Einstellungen mit „Darstellung“, das eigene Profil mit „So sehen dich andere“ und
// alte Adressen, die weiterleiten. Der Server ist nachgestellt; Namen sind ausgedacht.

const ME = { id: "u-neon", username: "neonfalke", display_name: "NeonFalke", role: "player", is_club_member: true, seasonal_decorations: "on" };

const CHATS = {
  unread_total: 3,
  items: [
    { key: "team:t-rocket", kind: "team", target_id: "t-rocket", title: "Lions Rocket", subtitle: "Team-Chat", last_message: { text: "Training heute um 20 Uhr", author: "LunaByte", created_at: "2026-10-07T12:02:00Z" }, unread_count: 2, updated_at: "2026-10-07T12:02:00Z" },
    { key: "tournament:fc26", kind: "tournament", target_id: "fc26", slug: "fc-26-cup", title: "FC 26 Cup", subtitle: "Turnier-Chat", last_message: { text: "Halbfinale ab 15 Uhr", author: "Turnierleitung", created_at: "2026-10-07T11:40:00Z" }, unread_count: 0, updated_at: "2026-10-07T11:40:00Z" },
    { key: "direct:u-schatten", kind: "direct", target_id: "u-schatten", title: "Schattenwolf", subtitle: "Nachricht", last_message: { text: "gg! Revanche am Sonntag?", author: "Schattenwolf", created_at: "2026-10-07T10:15:00Z" }, unread_count: 1, updated_at: "2026-10-07T10:15:00Z" },
    { key: "match:m-1", kind: "match", target_id: "m-1", title: "NeonFalke gegen PixelPanther", subtitle: "Match-Chat", last_message: { text: "PC 3 ist frei", author: "PixelPanther", created_at: "2026-10-07T09:58:00Z" }, unread_count: 0, updated_at: "2026-10-07T09:58:00Z" },
  ],
};

const PROFILE = {
  ...ME, bio: "Rocket League und FC 26.", privacy_public_profile: true, created_at: "2023-03-01T10:00:00Z",
  stats: { points: 3420, wins: 7, top3: 12, tournaments: 31, fast_laps: 9 },
  achievement_level: { level: 12, points: 3420, next_level_points: 4000, progress: 60 },
  teams: [], awards: [], honours: [], tournaments: [], f1_bests: [], references: { items: [], stats: {} }, relationship: { status: "self" },
};

async function mockServer(page, { user = ME, patches = [] } = {}) {
  // Was gespeichert wird, liefert /auth/me danach mit - wie der Server.
  let current = user ? { ...user } : null;
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (request.method() !== "GET") {
      patches.push({ method: request.method(), path, body: request.postDataJSON?.() ?? null });
      if (path === "/users/me") {
        current = { ...current, ...(request.postDataJSON?.() || {}) };
        return json(current);
      }
      return json({ ok: true });
    }
    if (path === "/auth/me") return current ? json(current) : json({ detail: "Nicht angemeldet" }, 401);
    if (path === "/chats") return json(CHATS);
    if (path === "/chats/unread") return json({ unread_total: CHATS.unread_total });
    if (path === "/users/public/neonfalke") return json(url.searchParams.get("view_as") === "public" ? { ...PROFILE, relationship: undefined, bio: "Rocket League und FC 26." } : PROFILE);
    if (path === "/account/invoices") return json({ summary: { open_count: 1, open_total: 12, overdue_count: 0 }, currency: "EUR", invoices: [] });
    if (path === "/users/me/profile-completeness") return json({ score: 80, missing: ["banner_url"] });
    if (path === "/seasonal/active") return json({ now: "2026-10-07T12:00:00+02:00", enabled: true, preview: false, weather: null, seasons: [] });
    if (path === "/news") return json([{ id: "n1", slug: "herbst-lan", title: "Herbst-LAN: Plan und Turniere stehen", visibility: "public", published_at: "2026-10-05T10:00:00Z" }]);
    if (path === "/membership/me") return json({ membership: { member_since: "2023-03-01" } });
    if (path === "/friends") return json({ incoming: [], friends: [], outgoing: [] });
    const objects = ["/settings/public", "/home/about", "/achievements/me", "/users/me/notification-preferences"];
    return json(objects.includes(path) ? {} : []);
  });
}

test.describe("Handy (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("die Leiste hat die fünf Einträge der App; jeder öffnet seine Seite", async ({ page }) => {
    await mockServer(page);
    await page.goto("/dashboard");
    const nav = page.getByTestId("bottom-nav");
    await expect(nav).toBeVisible();
    // Die Zahl der ungelesenen Chats kommt kurz nach dem Aufbau.
    await expect.poll(() => nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label"))))
      .toEqual(["Home", "Events", "Community, 3 ungelesene Chats", "Verein", "Profil"]);
    const cases = [["events", /\/events$/], ["community", /\/community$/], ["verein", /\/verein$/], ["profile", /\/u\/neonfalke$/], ["home", /\/dashboard$/]];
    for (const [key, url] of cases) {
      await page.getByTestId(`bottom-nav-${key}`).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByTestId(`bottom-nav-${key}`)).toHaveAttribute("aria-current", "page");
    }
  });

  test("ein Tipp auf den aktiven Eintrag bringt nach oben", async ({ page }) => {
    await mockServer(page);
    await page.goto("/verein");
    await expect(page.getByTestId("verein-page")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await page.getByTestId("bottom-nav-verein").click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
    await expect(page).toHaveURL(/\/verein$/);
  });
});

for (const width of [390, 1440]) {
  test.describe(`/verein bei ${width} px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test(`Mitglied oben der Mitgliederbereich, Gast „Mitglied werden“ (${width})`, async ({ page }) => {
      await mockServer(page);
      await page.goto("/verein");
      await expect(page.getByTestId("verein-member-area")).toBeVisible();
      await expect(page.getByTestId("verein-member-area-link")).toHaveAttribute("href", "/members/area");
      await expect(page.getByTestId("verein-join")).toHaveCount(0);
      await expect(page.getByTestId("verein-news")).toContainText("Herbst-LAN");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockServer(page, { user: null });
      await page.goto("/verein");
      await expect(page.getByTestId("verein-join")).toBeVisible();
      await expect(page.getByTestId("verein-join-apply")).toHaveAttribute("href", "/membership/join");
      await expect(page.getByTestId("verein-member-area")).toHaveCount(0);
    });
  });
}

test("Chats: alle vier Arten in einer Liste, Direktnachricht rechts", async ({ page }) => {
  await mockServer(page);
  await page.goto("/messages");
  await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
  for (const key of ["chat-item-team:t-rocket", "chat-item-tournament:fc26", "conversation-item-u-schatten", "chat-item-match:m-1"]) {
    await expect(page.getByTestId(key)).toBeVisible();
  }
  await expect(page.getByTestId("chat-unread-team:t-rocket")).toHaveText("2");
  await expect(page.getByTestId("chat-item-tournament:fc26")).toHaveAttribute("href", "/tournaments/fc-26-cup#chat");
});

test("Einstellungen: als Angemeldeter die Deko unter Darstellung umstellen - im Footer kein Schalter", async ({ page }) => {
  const patches = [];
  await mockServer(page, { patches });
  await page.goto("/profile?tab=appearance");
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  await page.getByTestId("settings-deco-off").click();
  await expect(page.getByTestId("settings-deco-off")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => patches.some((call) => call.path === "/users/me" && call.body?.seasonal_decorations === "off")).toBe(true);
  await expect(page.getByTestId("season-deco-switch")).toHaveCount(0);
  await expect(page.getByTestId("settings-group-title")).toHaveText(["Darstellung", "Benachrichtigungen", "Sicherheit", "Privatsphäre", "Konto", "Über die App"]);
});

test("eigenes Profil: „Nur für dich“ und der Schalter „So sehen dich andere“", async ({ page }) => {
  await mockServer(page);
  await page.goto("/u/me");
  await expect(page).toHaveURL(/\/u\/neonfalke$/);
  await expect(page.getByTestId("profile-private-box")).toBeVisible();
  await expect(page.getByTestId("profile-private-invoices")).toContainText("1 offen");
  await page.getByTestId("profile-as-others-switch").check();
  await expect(page.getByTestId("profile-private-box")).toHaveCount(0);
  await expect(page.getByTestId("profile-settings")).toHaveAttribute("href", "/profile");
});

test("alte Adressen leiten an den neuen Ort weiter", async ({ page }) => {
  await mockServer(page);
  const cases = [
    ["/profile?tab=invoices&invoice=d-501", /\/account\/invoices\?invoice=d-501$/],
    ["/profile?tab=teams", /\/teams$/],
    ["/profile?tab=friends", /\/players$/],
    ["/profile?tab=achievements", /\/u\/neonfalke\?tab=achievements$/],
    ["/profile?tab=inbox&to=u-schatten", /\/messages\/u-schatten$/],
    ["/mitgliederbereich", /\/members\/area$/],
  ];
  for (const [from, to] of cases) {
    await page.goto(from);
    await expect(page).toHaveURL(to);
  }
});
