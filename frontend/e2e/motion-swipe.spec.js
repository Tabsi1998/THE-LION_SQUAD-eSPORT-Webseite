const { test, expect } = require("@playwright/test");
const { ROUND_1, SERIES_PAGE, STATISTICS } = require("./fixtures/roundResults");

// Bewegung und Wischleisten (#1969):
// - Drucken bzw. PDF zeigt immer die Endwerte, nie den Zwischenstand oder Nullen - auch für Werte, die noch nie im Bild
//   waren und deshalb noch nicht gezählt haben.
// - Die Maske der Wischleiste (auslaufender Rand) gilt nur, wo wirklich gewischt wird: Flächen, die am PC umbrechen,
//   tragen dort keine Maske - sonst schnitte sie Anheben, Fokusring und Aufleuchten ab.
// Nur erfundene Namen.

const json = (data) => ({ contentType: "application/json", body: JSON.stringify(data) });
const BASE = "/references/series/probe-rennliga/season-2026";
const ANNI = { profile_id: "p1", display_name: "Anni", profile_url: "/members/anni" };
const cup = (id, title, date, placement, medal, game) => ({
  id, title, display_title: title, start_date: date, game, best_placement: placement, medal,
  entries: [{ id: `e-${id}`, kind: "team", team_name: "LION B", placement, medal, team_count: 16, member_profile_ids: ["p1"], lineup_members: [ANNI] }],
});
const RL = { id: "g1", name: "Rocket League" };
const FC = { id: "g2", name: "EA FC" };
const REFS = [cup("r1", "Probe Liga X Season 3", "2026-02-14", 1, "gold", RL), cup("r2", "Herbst Cup", "2025-10-04", 3, "bronze", FC), cup("r5", "Probe Liga X Season 2", "2025-06-01", 5, null, RL)];
const PROFILE = {
  id: "p1", slug: "anni", display_name: "Anni", gamertag: "Anni", bio: "",
  references: REFS.map((item) => ({ ...item, member_entry: item.entries[0] })),
  reference_stats: { total: 3, gold: 1, silver: 0, bronze: 1, podiums: 2, solo: 0, team: 3 },
};
const LINEAGES = {
  items: [{
    lineage: { title: "Probe Liga X", slug: "probe-liga", kind: "team_league", organizer: "ESL", tier_order: null }, game: null,
    seasons: [
      { season: "Season 2", tier: "Liga X", season_slug: "s2", status: "completed", season_result: "promoted", club: { rank: 5, of: 8 }, reference_ids: ["r5"] },
      { season: "Season 3", tier: "Liga X", season_slug: "s3", status: "active", club: { rank: 2, of: 16 }, reference_ids: ["r1"] },
    ],
  }],
};

async function mockServer(page) {
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill(json({})));
  await page.route("**/api/home/discord", (route) => route.fulfill(json({ available: false })));
  await page.route(`**/api${BASE.replace("/references/series", "/reference-series/public")}`, (route) => route.fulfill(json(SERIES_PAGE)));
  await page.route("**/api/reference-series/public/probe-rennliga/season-2026/statistics", (route) => route.fulfill(json(STATISTICS)));
  await page.route("**/api/reference-series/public/probe-rennliga/season-2026/rounds/1", (route) => route.fulfill(json(ROUND_1)));
  await page.route("**/api/membership/profiles/anni", (route) => route.fulfill(json(PROFILE)));
  await page.route("**/api/reference-series/public/lineages", (route) => route.fulfill(json(LINEAGES)));
  await page.route("**/api/references", (route) => route.fulfill(json({ items: REFS, summary: { total: 3, podiums: 2, gold: 1, silver: 0, bronze: 1 } })));
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

test("Drucken: die Rundentabelle zeigt sofort die Endzeiten, keine Nullen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockServer(page);
  await page.goto(`${BASE}/runde/1`);
  await acceptCookies(page);
  await page.getByTestId("round-table").waitFor();
  await page.emulateMedia({ media: "print" });
  const first = page.getByTestId("round-row").first();
  // Sichtbarer Text (innerText) - der Zähltext ist im Druck weg, der Endwert steht da.
  const text = await first.evaluate((node) => node.innerText);
  expect(text).toContain("31:55,056");
  expect(text).not.toContain("00:00");
});

test("Drucken: Werte, die nie im Bild waren, stehen mit dem Endwert da", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await mockServer(page);
  await page.goto(BASE);
  await acceptCookies(page);
  const table = page.getByTestId("series-table");
  await table.waitFor({ state: "attached" });
  await page.emulateMedia({ media: "print" });
  // Ohne Scrollen hat die Tabelle unten noch nicht gezählt - gedruckt stehen trotzdem die Punkte.
  const texts = await table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.innerText));
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) expect(text).not.toMatch(/(^|\s)0{2,}(\s|$)/);
});

test("Maske nur beim Wischen: am PC umbrechende Leisten ohne Maske, am Handy mit", async ({ page }) => {
  await mockServer(page);
  // Alle Wischleisten, die ab einer Breite umbrechen (sie nehmen dort die Maske zurück) - im Profil der Liga-Weg.
  const masks = async () => page.evaluate(() => [...document.querySelectorAll(".tls-swipe")]
    .filter((node) => node.className.includes("[mask-image:none]"))
    .map((node) => getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/members/anni");
  await acceptCookies(page);
  await page.locator("ol.tls-swipe").first().waitFor();
  const desktop = await masks();
  expect(desktop.length).toBeGreaterThan(0);
  for (const mask of desktop) expect(mask).toBe("none");

  const supported = await page.evaluate(() => CSS.supports("animation-timeline: scroll()"));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(100);
  const phone = await masks();
  if (supported) expect(phone.some((mask) => mask !== "none")).toBe(true);
});
