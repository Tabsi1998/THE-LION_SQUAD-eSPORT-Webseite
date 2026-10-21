const { test, expect } = require("@playwright/test");
const { ROUND_1, ROUND_2, SERIES_PAGE, STATISTICS } = require("./fixtures/roundResults");

// Ergebnistabelle je Runde (#1950): eine Runde mit Qualifying und Rennen (20 Fahrer) sieht aus wie die Grafik des
// Veranstalters - am PC als Tabelle, am Handy als Liste mit der Zeit rechts; ein Rennen ohne Zeiten bleibt sauber; die
// Serienseite führt über Kalender und Raster dorthin und hat den Reiter „Statistik“. Nichts läuft seitlich über. Mit
// SHOT_DIR entstehen die Bilder fürs Handbuch und die Abnahme. Nur erfundene Namen.

const SHOTS = process.env.SHOT_DIR || "";
const BASE = "/references/series/probe-rennliga/season-2026";

async function mockServer(page) {
  const json = (data) => ({ contentType: "application/json", body: JSON.stringify(data) });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "{}" }));
  await page.route("**/api/settings/public", (route) => route.fulfill(json({})));
  await page.route("**/api/home/discord", (route) => route.fulfill(json({ available: false })));
  await page.route("**/api/reference-series/public/probe-rennliga/season-2026", (route) => route.fulfill(json(SERIES_PAGE)));
  await page.route("**/api/reference-series/public/probe-rennliga/season-2026/statistics", (route) => route.fulfill(json(STATISTICS)));
  await page.route("**/api/reference-series/public/probe-rennliga/season-2026/rounds/1", (route) => route.fulfill(json(ROUND_1)));
  await page.route("**/api/reference-series/public/probe-rennliga/season-2026/rounds/2", (route) => route.fulfill(json(ROUND_2)));
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: /alle erlauben/i });
  if (await consent.count()) await consent.click();
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function shot(target, name, options = {}) {
  if (!SHOTS) return;
  await target.screenshot({ path: `${SHOTS}/${name}.png`, ...options });
}

for (const width of [1440, 390, 360]) {
  test(`Runde ${width}px: Hauptrennen wie beim Veranstalter, Reiter in der Adresse, Zeiten zählen hoch`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 800 ? 1500 : 1700 });
    await mockServer(page);
    await page.goto(`${BASE}/runde/1`);
    await acceptCookies(page);
    await expect(page.getByTestId("round-head")).toContainText("Aserbaidschan");
    await expect(page.getByTestId("round-tab-rennen")).toHaveAttribute("aria-selected", "true");
    const desktop = width > 800;
    const results = desktop ? page.getByTestId("round-table") : page.getByTestId("round-list");
    await expect(results).toBeVisible();
    const rows = results.getByTestId(desktop ? "round-row" : "round-item");
    await expect(rows).toHaveCount(20);
    // Am Ende des Hochzählens steht genau die Zeit vom Server.
    await expect(rows.first()).toContainText("31:55,056");
    await expect(page.locator("[data-counting='true']")).toHaveCount(0);
    await expect(rows.nth(1)).toHaveAttribute("data-own", "true");
    await expect(rows.nth(1)).toContainText(desktop ? "Schnellste Runde" : "Beste Runde");
    await expect(rows.last()).toContainText("DNF");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Fremde Namen nur in der Tabelle: der Sieger steht in der Zusammenfassung über sein Team.
    await expect(page.getByTestId("round-fact-winner")).toContainText("Probe Löwen");
    await expect(page.getByTestId("round-fact-winner")).not.toContainText("Lena Brandt");
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `handbuch-runde-${width}`);

    await page.getByTestId("round-tab-qualifying").click();
    await expect(page).toHaveURL(/\?lauf=qualifying$/);
    await expect(rows.first()).toContainText("1:40,474");
    await expect(page.locator("[data-counting='true']")).toHaveCount(0);
  });

  test(`Runde ${width}px: ein Rennen ohne Zeiten bleibt sauber`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockServer(page);
    await page.goto(`${BASE}/runde/2`);
    await acceptCookies(page);
    if (width > 800) {
      await expect(page.getByTestId("round-table").locator("thead th")).toHaveText(["Pos", "Name", "Team", "Punkte"]);
    } else {
      await expect(page.getByTestId("round-list").getByTestId("round-item").first()).toContainText("35 P");
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}

for (const width of [1440, 390]) {
  test(`Serienseite ${width}px: Kalender, Chips und Raster führen zur Runde, Reiter Statistik`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockServer(page);
    await page.goto(BASE);
    await acceptCookies(page);
    const calendar = page.getByTestId("racing-calendar");
    await expect(calendar.getByTestId("racing-round-link").first()).toHaveAttribute("href", `${BASE}/runde/1`);
    await expect(calendar.getByTestId("session-chip").first()).toHaveAttribute("href", `${BASE}/runde/1?lauf=qualifying`);
    if (width > 800) {
      await expect(page.getByTestId("racing-drivers").getByTestId("series-round-link").first()).toHaveAttribute("href", `${BASE}/runde/1`);
    }
    await shot(calendar, `handbuch-kalender-${width}`);

    await page.getByTestId("racing-view-statistik").click();
    await expect(page).toHaveURL(/\?ansicht=statistik$/);
    const stats = page.getByTestId("season-stats");
    await expect(stats).toContainText("Meiste Poles");
    await expect(stats.getByTestId("season-stats-row")).toHaveCount(20);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(stats, `handbuch-statistik-${width}`);

    await page.getByTestId("racing-view-saison").click();
    await calendar.getByTestId("racing-round-link").first().click();
    await expect(page).toHaveURL(`${BASE}/runde/1`);
    await expect(page.getByTestId("round-head")).toContainText("Aserbaidschan");
  });
}

// Verwaltung (#1950): Teamfarben der Saison mit Vorschlag aus dem Ergebnis-Bild.
const BOARD = { id: "vorstand-1", username: "vorstand", display_name: "Vorstand", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
const ADMIN_SERIES = {
  id: "serie-1", season: "Season 2026", status: "active", rules_version: 1,
  rules: { points_mode: "scheme", points_by_place: [25, 18, 15], count_mode: "all", tiebreakers: [] },
  lineage: { id: "spur-1", title: "Probe Rennliga", kind: "racing" }, access: { role: "board", can_publish: true },
};
const COLORS = { teams: [
  { team: "Alpenblitz", color: "#ef4444", suggestion: null, own: false },
  { team: "Kurvenkunst", color: null, suggestion: "#22d3ee", own: false },
  { team: "Nordwind Racing", color: "#8b5cf6", suggestion: "#8b5cf6", own: false },
  { team: "Probe DarkFriday", color: null, suggestion: "#3b82f6", own: true },
  { team: "Probe Löwen", color: "#facc15", suggestion: null, own: true },
  { team: "Team Zwei", color: null, suggestion: null, own: false },
] };

for (const width of [1440, 390]) {
  test(`Verwaltung ${width}px: Teamfarben mit Vorschlag aus dem Bild übernehmen und speichern`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
        essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
        saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }));
    });
    const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/api/**", json({}));
    for (const path of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${path}`, json([]));
    await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
    await page.route("**/api/auth/me", json(BOARD));
    await page.route("**/api/reference-series/admin/series/serie-1", json(ADMIN_SERIES));
    await page.route("**/api/reference-series/admin/series/serie-1/calendar", json({ version: 1, today: "2026-10-21", counts: {}, hints: [], archived: [], rounds: [] }));
    const saved = [];
    await page.route("**/api/reference-series/admin/series/serie-1/team-colors", (route) => {
      if (route.request().method() === "PUT") {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(COLORS) });
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(COLORS) });
    });
    await page.goto("/admin/reference-series/serie-1");
    const section = page.getByTestId("series-team-colors");
    await expect(section.getByTestId("series-colors-row")).toHaveCount(6);
    await expect(section.getByTestId("series-colors-take-all")).toContainText("(2)");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(section, `handbuch-teamfarben-${width}`);
    await section.getByTestId("series-colors-take-all").click();
    await section.getByTestId("series-colors-save").click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].colors).toMatchObject({ Kurvenkunst: "#22d3ee", "Probe DarkFriday": "#3b82f6", "Team Zwei": null });
  });
}
