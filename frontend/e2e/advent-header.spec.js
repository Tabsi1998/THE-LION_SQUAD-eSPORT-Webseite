const { test, expect } = require("@playwright/test");
const { mockSeason } = require("./seasonQa");

// Advent im Kopf (#852): Adventkalender und am 6. Dezember der Nikolaus gleich neben dem Kranz - ein Klick und man ist
// dort. Am Handy ist im Kopf kein Platz für drei: Kalender und Stiefel stehen dann ganz oben im Menü. Der Kopf läuft nie
// über.

const NOW = "2026-12-06T11:00:00+01:00";
const SHOTS = process.env.SHOT_DIR || "";
const ADVENT = { key: "advent", label: "Adventkranz", phase: "kranz", intensity: "normal", channels: ["web", "app"], texts: {}, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2026-12-26T23:59:59+01:00", forced: false, data: { candles: 2, days_to_christmas: 18, sundays: [] } };
const CALENDAR = { key: "advent_calendar", label: "Adventkalender", phase: "tuerchen", intensity: "normal", channels: ["web", "app"], texts: {}, data: { today_door: 6, catch_up: false, door_hour: 6, ready: true }, starts_at: "2026-12-01T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false };
const NIKOLAUS = { key: "nikolaus", label: "Nikolaus", phase: "stiefel", intensity: "normal", channels: ["web", "app"], texts: { greeting: "Der Nikolaus war da" }, data: {}, starts_at: "2026-12-06T00:00:00+01:00", ends_at: "2026-12-06T23:59:59+01:00", forced: false };

async function open(page, width) {
  await page.clock.setFixedTime(new Date(NOW));
  await mockSeason(page, { now: NOW, enabled: true, preview: false, weather: null, seasons: [ADVENT, CALENDAR, NIKOLAUS] });
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
}

async function headerFits(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    return header.scrollWidth <= header.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  });
}

test("PC: Kranz, Türchen und Stiefel nebeneinander - der Stiefel führt hinunter und öffnet sich", async ({ page, isMobile }, testInfo) => {
  test.skip(Boolean(isMobile), "PC");
  await open(page, 1440);
  const slot = page.getByTestId("season-widget-slot");
  await expect(slot.getByTestId("advent-calendar-widget")).toBeVisible();
  const boot = slot.getByTestId("nikolaus-widget");
  await expect(boot).toBeVisible();
  const door = await slot.getByTestId("advent-calendar-widget").boundingBox();
  const bootBox = await boot.boundingBox();
  expect(bootBox.x).toBeGreaterThan(door.x);
  expect(Math.abs(bootBox.y + bootBox.height - (door.y + door.height))).toBeLessThan(8);
  expect(await headerFits(page)).toBe(true);
  await testInfo.attach("advent-kopf-1440.png", { body: await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 90 } }), contentType: "image/png" });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/advent-kopf-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 90 } });
  await boot.click();
  await expect(page.getByTestId("nikolaus-card")).toBeVisible({ timeout: 6000 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
});

for (const width of [390, 768]) {
  test(`${width}px: der Kopf bleibt frei, Kalender und Stiefel stehen ganz oben im Menü`, async ({ page }, testInfo) => {
    await open(page, width);
    await expect(page.getByTestId("advent-calendar-widget")).toBeVisible();
    if (width <= 640) await expect(page.getByTestId("nikolaus-widget")).toBeHidden();
    expect(await headerFits(page)).toBe(true);
    await page.getByRole("button", { name: "Menü öffnen" }).click();
    const menu = page.locator("#mobile-navigation");
    const entries = menu.getByTestId("season-menu-slot");
    await expect(entries).toBeVisible();
    await expect(entries.getByTestId("season-menu-advent-calendar")).toContainText("Türchen 6 ist offen");
    await expect(entries.getByTestId("season-menu-nikolaus")).toBeVisible();
    // Ganz oben: vor der normalen Navigation.
    const slotBox = await entries.boundingBox();
    const firstLink = await menu.locator("a, button").filter({ hasNotText: /Adventkalender|Nikolaus/ }).first().boundingBox();
    expect(slotBox.y).toBeLessThan(firstLink.y);
    await testInfo.attach(`advent-menue-${width}.png`, { body: await page.screenshot({ clip: { x: 0, y: 0, width, height: 360 } }), contentType: "image/png" });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/advent-menue-${width}.png`, clip: { x: 0, y: 0, width, height: 360 } });
    await entries.getByTestId("season-menu-advent-calendar").click();
    await expect(page).toHaveURL(/\/advent$/);
  });
}

test("Handy: der Stiefel im Menü führt hinunter und öffnet sich", async ({ page }) => {
  await open(page, 390);
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await page.getByTestId("season-menu-nikolaus").click();
  await expect(page.locator("#mobile-navigation")).toHaveCount(0);
  await expect(page.getByTestId("nikolaus-card")).toBeVisible({ timeout: 6000 });
});
