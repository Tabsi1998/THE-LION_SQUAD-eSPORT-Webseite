const { test, expect } = require("@playwright/test");

// Maps und Map-Pools (#1616) im echten Browser, Server nachgestellt: Map-Bibliothek eines Spiels (anlegen im
// Seitenblatt), Pool der Saison in der Verwaltung und auf der Serienseite als Karten. Bei 390 und 1440 px ohne seitliches
// Scrollen. Nur erfundene Map-Namen, keine Hersteller-Maps.

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "content"], mfa_enabled: true, auth_mfa_verified: true };
const GAME = { id: "g1", name: "Probe Shooter", slug: "probe-shooter", kind: "standalone", modes: [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }] };
const MAPS = [
  { id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: null, modes: ["stellung", "snd"], status: "active", in_pools: 1, order: 1 },
  { id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: null, modes: ["snd"], status: "active", in_pools: 0, order: 2 },
];
const POOL = {
  id: "p1", version: 1, origin: "reference_series", saved_at: "2026-10-20T18:00:00Z", stale: false, outdated_map_ids: [],
  modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: null }, { map_id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: null }] }],
};
const PAGE = {
  lineage: { title: "Probe Liga", slug: "probe-liga", kind: "series", label: "4vs4", organizer: "Probe Verband", game_name: "Probe Shooter" },
  series: { season: "2026", tier: null, title: null, season_slug: "2026", status: "active" },
  rules: { points_mode: "scheme", points_by_place: [10, 8], count_mode: "all", tiebreakers: [], bonuses: {}, activity_points: { points: 0 } },
  today: "2026-10-21", progress: { total: 0, scored: 0, cancelled: 0, remaining: 0, next: null }, rounds: [], standings: null, final: null,
  team_league: null, racing: null, map_pool: POOL,
};

async function mockServer(page) {
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
  await page.route("**/api/auth/me", json(ADMIN));
  const created = [];
  await page.route("**/api/games/g1/maps", (route) => {
    if (route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "sturm", slug: "sturmdeck", name: "Sturmdeck" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ game: GAME, maps: MAPS, limit: 200 }) });
  });
  await page.route("**/api/reference-series/public/probe-liga/2026", json(PAGE));
  return created;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Map-Bibliothek (${width} px): Karten mit Modi, neue Map im Seitenblatt`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const created = await mockServer(page);
    await page.goto("/admin/games/g1/maps");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Maps · Probe Shooter");
    await expect(page.getByTestId("game-map-card-hafenkante")).toContainText("in 1 Pool");
    await expect(page.getByTestId("game-map-delete-hafenkante")).toBeDisabled();
    await noSideScroll(page);

    await page.getByTestId("game-maps-add").click();
    const sheet = page.getByRole("dialog", { name: "Map hinzufügen" });
    await sheet.getByTestId("game-map-name").fill("Sturmdeck");
    await sheet.getByRole("checkbox", { name: "Suchen & Zerstören" }).check();
    await sheet.getByTestId("game-map-save").click();
    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toMatchObject({ name: "Sturmdeck", modes: ["snd"] });
  });

  test(`Serienseite (${width} px): Map-Pool der Saison als Karten`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/references/series/probe-liga/2026");
    const pool = page.getByTestId("map-pool");
    await expect(pool.getByRole("heading", { level: 2 })).toHaveText("Map-Pool");
    await expect(pool.getByTestId("map-card")).toHaveCount(2);
    await expect(pool.getByTestId("map-card").first()).toContainText("Nebelwerk");
    await noSideScroll(page);
  });
}
