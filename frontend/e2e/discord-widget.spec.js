const { test, expect } = require("@playwright/test");

// Discord auf der Website (#581): die Startseite zeigt unter den Vereinszahlen eine schmale Leiste
// („42 online · 5 im Voice“, „Beitreten“), der Mitgliederbereich „Discord jetzt“ mit den belegten
// Sprachkanälen - nur Zahlen, nie Namen. Ohne Widget gibt es beides nicht; nichts läuft seitlich über.

const member = { id: "user-1", username: "tabsi98", display_name: "Tabsi98", role: "player", is_club_member: true };
const DISCORD = { available: true, online: 42, in_voice: 5, invite: "https://discord.gg/lions" };
const VOICE = { ...DISCORD, voice: [{ name: "Chillen", count: 1 }, { name: "Turnier-Lobby", count: 4 }] };
const SHOTS = process.env.SHOT_DIR || "";

function homeState(discord) {
  const empty = { events: [], tournaments: [], challenges: [] };
  return { has_live: false, live: empty, today: empty, soon: empty, upcoming: empty, news: [], featured_news: [], stats: {},
    club_numbers: { members: 42, tournaments: 17, events: 3, participations: 5, prizes: 0 }, club_numbers_shown: ["members", "tournaments", "participations", "events"], discord };
}

async function mockServer(page, { discord = DISCORD, voice = VOICE, user = null } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => (user ? route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }) : route.fulfill({ status: 401, body: "{}" })));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ discord_invite_url: "https://discord.gg/lions" }) }));
  await page.route("**/api/home/state", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(homeState(discord)) }));
  await page.route("**/api/membership/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ membership: { member_number: "TLS-007", member_since: "2024-03-01" } }) }));
  await page.route("**/api/membership/discord-voice", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(voice) }));
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle akzeptieren/i });
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
  test(`Startseite ${width}px: Leiste unter den Zahlen, nur Zahlen und „Beitreten“`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockServer(page);
    await page.goto("/");
    await acceptCookies(page);
    const strip = page.getByTestId("home-discord");
    await expect(strip).toBeVisible();
    await expect(page.getByTestId("home-discord-summary")).toHaveText("42 online · 5 im Voice");
    await expect(page.getByTestId("home-discord-join")).toHaveAttribute("href", "https://discord.gg/lions");
    const numbers = await page.getByTestId("home-numbers").boundingBox();
    const box = await strip.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(numbers.y + numbers.height - 1);
    await noSideScroll(page);
    if (SHOTS) await expect(page.getByTestId("home-number-members")).toContainText("42");
    await shot(page, strip, `home-discord-${width}`);
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

test("ohne Widget: keine Leiste und kein Kasten", async ({ page }) => {
  await mockServer(page, { discord: { available: false }, voice: { available: false }, user: member });
  await page.goto("/");
  await acceptCookies(page);
  await expect(page.getByTestId("home-numbers")).toBeVisible();
  await expect(page.getByTestId("home-discord")).toHaveCount(0);
  await page.goto("/members/area");
  await expect(page.getByTestId("member-area-links")).toBeVisible();
  await expect(page.getByTestId("member-area-discord-now")).toHaveCount(0);
});
