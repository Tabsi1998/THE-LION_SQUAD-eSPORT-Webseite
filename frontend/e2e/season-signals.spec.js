const { test, expect } = require("@playwright/test");
const { activePayload, mockSeason } = require("./seasonQa");

// Saison-Fundstücke (#678): wer ohne Anmeldung eine Fledermaus verscheucht, sammelt im Browser - an den Server geht
// nichts. Nach dem Login wird nachgemeldet (mit dem Tag, an dem gesammelt wurde), der Ausgang ist danach leer, und
// eine Stufe, die der Server dabei vergibt, wird sofort gefeiert. Server und Konto sind Attrappen im Browser.

const OUTBOX = "tls-season-signal-outbox";
const USER = { id: "u-anna", email: "anna@example.test", display_name: "Anna", username: "anna", role: "user", seasonal_decorations: "on" };
const HALLOWEEN = { key: "halloween", label: "Halloween", phase: "deko", intensity: "full", channels: ["web", "app"], texts: { greeting: "Happy Halloween" }, data: { night: true }, starts_at: "", ends_at: "", forced: false };

function viennaDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function achievements(earnedAt) {
  const tier = {
    code: "bat_whisperer_1", group_code: "bat_whisperer", name: "Fledermausflüsterer I", description: "5 Fledermäuse verscheucht.", material: "bronze", material_name: "Bronze",
    level_name: "Bronze", icon: "moon", art: "night-shift", points: 10, xp: 25, progress_target: 5, progress_current: earnedAt ? 5 : 0, earned: Boolean(earnedAt), earned_at: earnedAt,
  };
  return { groups: [{ code: "bat_whisperer", name: "Fledermausflüsterer", category: "community", icon: "moon", art: "night-shift", tiers: [tier] }], pinned: [], pinned_codes: [], awards: [], level: { level: 3, title: "Rudelmitglied", xp: 120, next_xp: 200 } };
}

test.describe("Saison-Fundstücke: sammeln, nachmelden, feiern", () => {
  test("ohne Anmeldung bleibt alles im Browser; nach dem Login wird nachgemeldet und die neue Stufe gefeiert", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "PC");
    const state = { user: null, posts: [], earnedAt: null };
    await mockSeason(page, activePayload({ season: HALLOWEEN, now: "2026-10-28T20:00:00+01:00" }));
    await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.user) }));
    await page.route("**/api/seasonal/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ scares_allowed: false }) }));
    await page.route("**/api/achievements/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(achievements(state.earnedAt)) }));
    await page.route("**/api/achievements/signals", async (route) => {
      const body = route.request().postDataJSON();
      state.posts.push(body);
      state.earnedAt = new Date().toISOString();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: body.items.length, newly_awarded: 1, results: body.items.map((item) => ({ ...item, accepted: true, count: item.count, day_count: item.count })) }) });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const bats = page.locator("[data-testid='halloween-bat-hanging']");
    await expect.poll(() => bats.count(), { timeout: 15000 }).toBeGreaterThan(0);

    // Verscheuchen ohne Anmeldung: gezählt wird im Browser, an den Server geht nichts.
    await bats.first().dispatchEvent("click");
    await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "{}"), OUTBOX)).toEqual({ [`-|halloween_bats_scared|${viennaDay()}`]: 1 });
    await page.waitForTimeout(3500);
    expect(state.posts, "ohne Anmeldung keine Meldung").toEqual([]);

    // Login (hier: dieselbe Seite mit Konto): die Zählung von vorher geht mit ihrem Tag an den Server.
    state.user = USER;
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect.poll(() => state.posts.length, { timeout: 15000 }).toBe(1);
    expect(state.posts[0]).toEqual({ items: [{ name: "halloween_bats_scared", day: viennaDay(), count: 1 }] });
    await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "{}"), OUTBOX)).toEqual({});

    // Der Server hat dabei eine Stufe vergeben: sie wird sofort gefeiert.
    const overlay = page.getByTestId("achievement-unlock-overlay");
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(overlay).toContainText("Fledermausflüsterer");
    await testInfo.attach("fundstueck-zeremonie.png", { body: await page.screenshot(), contentType: "image/png" });

    // Angemeldet verscheucht: die Meldung kommt von selbst, gebündelt, und gehört dem Konto.
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden({ timeout: 15000 });
    const resting = page.locator("[data-testid='halloween-bat-hanging'][data-state='perched'], [data-testid='halloween-bat-hanging'][data-state='alert']");
    await expect.poll(() => resting.count(), { timeout: 15000 }).toBeGreaterThan(0);
    await resting.first().dispatchEvent("click");
    await expect.poll(() => state.posts.length, { timeout: 15000 }).toBe(2);
    expect(state.posts[1].items).toEqual([{ name: "halloween_bats_scared", day: viennaDay(), count: 1 }]);
  });
});
