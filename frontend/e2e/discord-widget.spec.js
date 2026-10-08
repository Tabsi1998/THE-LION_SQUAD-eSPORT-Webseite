const { test, expect } = require("@playwright/test");

// Discord auf der Website (#581, #854): der Block „Dabei sein“ im Footer jeder Seite zeigt „42 online · 5 im Voice“
// neben „Discord beitreten“ (vorher eine eigene Leiste auf der Startseite), der Mitgliederbereich „Discord jetzt“ mit
// den belegten Sprachkanälen - nur Zahlen, nie Namen. Ohne Widget gibt es beides nicht; nichts läuft seitlich über.

const member = { id: "user-1", username: "tabsi98", display_name: "Tabsi98", role: "player", is_club_member: true };
const DISCORD = { available: true, online: 42, in_voice: 5, invite: "https://discord.gg/lions" };
const VOICE = { ...DISCORD, voice: [{ name: "Chillen", count: 1 }, { name: "Turnier-Lobby", count: 4 }] };
const SHOTS = process.env.SHOT_DIR || "";

function homeState() {
  const empty = { events: [], tournaments: [], challenges: [] };
  return { has_live: false, live: empty, today: empty, soon: empty, upcoming: empty, news: [], featured_news: [], stats: {},
    club_numbers: { members: 42, tournaments: 17, events: 3, participations: 5, prizes: 0 }, club_numbers_shown: ["members", "tournaments", "participations", "events"] };
}

async function mockServer(page, { discord = DISCORD, voice = VOICE, user = null, settings = { discord_invite_url: "https://discord.gg/lions" } } = {}) {
  const calls = { discord: 0 };
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => (user ? route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }) : route.fulfill({ status: 401, body: "{}" })));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(settings) }));
  await page.route("**/api/home/state", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(homeState()) }));
  await page.route("**/api/home/discord", (route) => {
    calls.discord += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(discord) });
  });
  await page.route("**/api/membership/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ membership: { member_number: "TLS-007", member_since: "2024-03-01" } }) }));
  await page.route("**/api/membership/discord-voice", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(voice) }));
  return calls;
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

async function noSideScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

/** Bildschirmfoto für die Abnahme (nur mit SHOT_DIR): Ausschnitt der ganzen Seite, damit die feste Leiste unten nichts verdeckt. */
async function shot(page, locator, name, pad = 140) {
  if (!SHOTS) return;
  // Die feste Leiste unten (Handy) würde im Ganzseiten-Bild über dem Ausschnitt liegen - nur fürs Bild ausblenden.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.position === "fixed" && rect.bottom >= window.innerHeight - 2 && rect.height < 140) element.style.visibility = "hidden";
    }
    window.scrollTo(0, 0);
  });
  const box = await locator.boundingBox();
  const width = page.viewportSize().width;
  const y = Math.max(0, box.y - pad);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, clip: { x: 0, y, width, height: box.height + pad * 2 } });
}

for (const width of [390, 1440]) {
  test(`Footer ${width}px: „Dabei sein“ zeigt die Zahl neben „Discord beitreten“ - keine Leiste mehr auf der Startseite`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await mockServer(page);
    await page.goto("/");
    await acceptCookies(page);
    await expect(page.getByTestId("home-numbers")).toBeVisible();
    await expect(page.getByTestId("home-discord")).toHaveCount(0);
    const buttons = page.getByTestId("footer-buttons");
    const live = buttons.getByTestId("footer-discord-live");
    await live.scrollIntoViewIfNeeded();
    await expect(live).toHaveText("42 online · 5 im Voice");
    await expect(buttons.getByTestId("footer-discord-button")).toHaveAttribute("href", "https://discord.gg/lions");
    if (width >= 1440) {
      // Breit: Zahl und Knopf in einer Zeile.
      const line = await live.boundingBox();
      const button = await buttons.getByTestId("footer-discord-button").boundingBox();
      expect(Math.abs(line.y + line.height / 2 - (button.y + button.height / 2))).toBeLessThan(6);
      expect(line.x + line.width).toBeLessThanOrEqual(button.x);
    }
    await noSideScroll(page);
    await shot(page, page.getByTestId("footer-cta"), `footer-discord-${width}`, 40);

    // Jede Seite hat den Footer - beim Wechsel innerhalb der Seite wird nicht neu gefragt.
    await page.evaluate(() => {
      window.history.pushState({}, "", "/about");
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByTestId("footer-discord-live")).toHaveText("42 online · 5 im Voice");
    expect(calls.discord).toBe(1);
  });

  test(`Mitgliederbereich ${width}px: „Discord jetzt“ mit belegten Sprachkanälen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockServer(page, { user: member });
    await page.goto("/members/area");
    await acceptCookies(page);
    const box = page.getByTestId("member-area-discord-now");
    await expect(box).toBeVisible();
    await expect(page.getByTestId("member-area-discord-summary")).toHaveText("42 online · 5 im Voice");
    await expect(box).toContainText("Turnier-Lobby");
    await expect(box).toContainText("4");
    await noSideScroll(page);
    await shot(page, box, `member-discord-${width}`, 60);
  });
}

test("ohne eigene Einladung in den Einstellungen nimmt der Knopf die des Widgets", async ({ page }) => {
  await mockServer(page, { settings: {}, discord: { ...DISCORD, invite: "https://discord.com/invite/abc123" } });
  await page.goto("/");
  await acceptCookies(page);
  await expect(page.getByTestId("footer-discord-button")).toHaveAttribute("href", "https://discord.com/invite/abc123");
});

test("ohne Widget: keine Zahl im Footer und kein Kasten - der Knopf bleibt", async ({ page }) => {
  await mockServer(page, { discord: { available: false }, voice: { available: false }, user: member });
  await page.goto("/");
  await acceptCookies(page);
  await expect(page.getByTestId("home-numbers")).toBeVisible();
  await expect(page.getByTestId("footer-discord-button")).toHaveAttribute("href", "https://discord.gg/lions");
  await expect(page.getByTestId("footer-discord-live")).toHaveCount(0);
  await expect(page.getByTestId("home-discord")).toHaveCount(0);
  await page.goto("/members/area");
  await expect(page.getByTestId("member-area-links")).toBeVisible();
  await expect(page.getByTestId("member-area-discord-now")).toHaveCount(0);
});
