const { test, expect } = require("@playwright/test");

// Turnierliste (#1276): zweite Chip-Zeile mit Spielen, „Online“/„Vor Ort“ und - angemeldet - „Nur meine“. Am Handy sind
// beide Zeilen einzeilig zum Wischen, am PC brechen sie um. Die Auswahl steht in der Adresse.

const SHOTS = process.env.SHOT_DIR || "";
const GAMES = [
  { id: "g1", slug: "mario-kart", name: "Mario Kart World" },
  { id: "g2", slug: "smash", name: "Super Smash Bros. Ultimate" },
  { id: "g3", slug: "rocket-league", name: "Rocket League" },
  { id: "g4", slug: "ea-fc", name: "EA Sports FC 26" },
  { id: "g5", slug: "valorant", name: "Valorant" },
];
const CUPS = [
  { id: "t1", slug: "herbst-cup", title: "Herbst-Cup 2026", status: "registration_open", format: "single_elim", platform: "Switch 2",
    start_date: "2026-11-21T10:00:00+01:00", max_participants: 16, participant_count: 9, registration_enabled: true },
  { id: "t2", slug: "smash-sonntag", title: "Smash Sonntag", status: "live", format: "double_elim", platform: "Switch",
    start_date: "2026-11-16T13:00:00+01:00", max_participants: 16, participant_count: 15 },
];

async function mockServer(page, { user = null } = {}) {
  const requests = [];
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => (user
    ? route.fulfill({ contentType: "application/json", body: JSON.stringify(user) })
    : route.fulfill({ status: 401, body: "{}" })));
  await page.route("**/api/settings/public", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/tournaments?**", (route) => {
    const url = new URL(route.request().url());
    requests.push(Object.fromEntries(url.searchParams));
    const items = url.searchParams.get("game") === "smash" ? CUPS.slice(1) : CUPS;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items, total: items.length, games: GAMES }) });
  });
  return requests;
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

test("390 px: beide Chip-Zeilen einzeilig zum Wischen, kein seitliches Überlaufen der Seite", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await mockServer(page);
  await page.goto("/tournaments?mode=local");
  await acceptCookies(page);
  const chips = page.getByTestId("tournament-chips");
  await expect(chips.getByTestId("tournament-game-mario-kart")).toBeVisible();
  await expect(page.getByTestId("tournament-mode-local")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("tournament-only-mine")).toHaveCount(0);
  for (const id of ["tournament-filters", "tournament-chips"]) {
    const box = await page.getByTestId(id).evaluate((node) => ({
      wraps: getComputedStyle(node).flexWrap, scroll: node.scrollWidth, client: node.clientWidth,
      tops: new Set([...node.children].map((child) => { const r = child.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })).size,
    }));
    expect(box.wraps, id).toBe("nowrap");
    expect(box.tops, `${id}: eine Zeile`).toBe(1);
  }
  const row = await chips.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(row.scroll, "die Chips gehen über den Rand - wischen").toBeGreaterThan(row.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await shot(page, "turnierliste-filter-390");

  await chips.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await page.getByTestId("tournament-game-smash").click();
  await expect(page).toHaveURL(/game=smash/);
  await expect(page).toHaveURL(/mode=local/);
  await expect.poll(() => requests.at(-1)).toMatchObject({ game: "smash", mode: "local" });
  await expect(page.getByTestId("tournament-card-herbst-cup")).toHaveCount(0);
});

test("1440 px: zwei Zeilen über der Liste, angemeldet mit „Nur meine“", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = await mockServer(page, { user: { id: "u1", display_name: "Tabsi", role: "user" } });
  await page.goto("/tournaments?game=mario-kart");
  await acceptCookies(page);
  await expect(page.getByTestId("tournament-game-mario-kart")).toHaveAttribute("aria-pressed", "true");
  const mine = page.getByTestId("tournament-only-mine");
  await expect(mine).toBeVisible();
  await mine.click();
  await expect(page).toHaveURL(/mine=1/);
  await expect.poll(() => requests.at(-1)).toMatchObject({ game: "mario-kart", mine: "true" });
  const top = (id) => page.getByTestId(id).evaluate((node) => node.getBoundingClientRect().top);
  expect(await top("tournament-chips")).toBeGreaterThan(await top("tournament-filters"));
  await shot(page, "turnierliste-filter-1440");
});
