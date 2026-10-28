const { test, expect } = require("@playwright/test");

// Gestaltung der Liga (#2107) im echten Browser, Server nachgestellt: Ligaseite mit Banner (Fokuspunkt je Zuschnitt),
// Emblem, Akzentfarbe und „Um was gespielt wird“; Übersicht mit Emblem; Verwaltung mit Gestaltung und Gewinnen. Bei 390
// und 1440 px ohne seitliches Scrollen. Nur erfundene Namen und synthetische Bilder (SVG-Verläufe, keine Logos).

const BANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a1f5c"/><stop offset="1" stop-color="#d98a2b"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#g)"/><circle cx="1200" cy="300" r="160" fill="#ffffff" fill-opacity="0.25"/></svg>`;
const EMBLEM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <polygon points="128,16 240,80 240,176 128,240 16,176 16,80" fill="#ffb020"/><circle cx="128" cy="128" r="48" fill="#141414"/></svg>`;

const LOOK = {
  emblem_url: "/api/static/uploads/probe-emblem.png", accent_color: "#FFB020",
  banner: { url: "/api/static/uploads/probe-banner.webp", x: 75, y: 35, mobile_x: 75, mobile_y: 35 },
};
const LEAGUES = { leagues: [{ id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" }, emblem_url: LOOK.emblem_url, accent_color: LOOK.accent_color,
  seasons: [{ id: "s1", slug: "season-1", name: "Season 1", status: "active", start_date: "2026-11-09T23:00:00+00:00", emblem_url: LOOK.emblem_url, banner: LOOK.banner }] }] };
const SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga mit langem Namen", game: { name: "Probe Shooter" } },
  look: LOOK,
  prizes: [{ place: 1, text: "Pokal, Trikots für das ganze Co-Team und ein Platz im Finalturnier", image_url: LOOK.emblem_url },
    { place: 2, text: "Gutschein für den Probe-Shop" }, { place: 3, text: "Medaillen" }],
  season: {
    name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00",
    matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4,
    match_points: { win: 3, draw: 1, loss: 0 }, rules_text: "", registration_deadline: "2026-11-06", blocked_periods: [],
  },
  map_pool: null,
  divisions: [{ id: "d1", level: 1, label: "Liga 1 · Elite", prizes: [{ place: 1, text: "Aufstieg und Medaille" }], staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A" }] }],
};
const STAFFEL = { staffel: { staffel: "A", division_label: "Liga 1 · Elite" }, current: 1, weeks: [], standings: [], teams: [] };

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true };
const RULES = { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
const ADMIN_SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 4, game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48,
  rules_text: "", registration_deadline: null, visibility: "members", status: "draft", blocked_periods: [],
  prizes: [{ place: 1, text: "Pokal und Trikot", image_url: null }],
};
const ADMIN_LEAGUE = { id: "l1", name: "Probe-Liga mit einem recht langen Namen", slug: "probe-shooter", game_id: "g1", game_name: "Probe Shooter", status: "active",
  emblem_url: LOOK.emblem_url, banner_url: LOOK.banner.url, banner_focus: { x: 75, y: 35, mobile_x: 75, mobile_y: 35 }, accent_color: LOOK.accent_color,
  seasons: [{ id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "draft", visibility: "members", start_date: ADMIN_SEASON.start_date, weeks_total: 10 }] };
const CALENDAR = { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 7 };
const SEASON_PAGE = { league: ADMIN_LEAGUE, season: ADMIN_SEASON, look: { emblem_url: LOOK.emblem_url, banner: LOOK.banner, accent_color: LOOK.accent_color },
  game: { id: "g1", name: "Probe Shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null, divisions: [] };

async function mockServer(page, { admin = false } = {}) {
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
  await page.route("**/api/static/uploads/**", (route) => route.fulfill({ contentType: "image/svg+xml",
    body: route.request().url().includes("banner") ? BANNER_SVG : EMBLEM_SVG }));
  await page.route("**/api/auth/me", admin ? json(ADMIN) : (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues", json(LEAGUES));
  await page.route("**/api/leagues/probe-liga/season-1", json(SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(STAFFEL));
  await page.route("**/api/admin/leagues", json({ games: [{ id: "g1", name: "Probe Shooter" }], season_defaults: {}, leagues: [ADMIN_LEAGUE] }));
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
}

/** Wartet, bis Einblenden und Aufsteigen fertig sind (endlose Bewegungen wie der Ladeschimmer zählen nicht). */
async function settled(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => null))));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Ligaseite gestaltet (${width} px): Banner, Emblem, Farbe und Gewinne`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe-liga/season-1");
    const head = page.getByTestId("league-head");
    await expect(head).toHaveAttribute("data-banner", "true");
    await expect(page.getByTestId("league-head-banner").locator("img")).toHaveAttribute("data-loaded", "true");
    const ratio = await page.getByTestId("league-head-banner").evaluate((node) => node.clientWidth / node.clientHeight);
    expect(ratio).toBeCloseTo(width < 640 ? 4 / 3 : 3, 1);
    await expect(page.getByTestId("league-head-emblem").locator("img")).toBeVisible();
    await expect(page.getByTestId("league-prizes")).toContainText("1. Platz");
    await expect(page.getByTestId("league-prizes-1")).toContainText("Aufstieg und Medaille");
    const eyebrow = await page.locator(".tls-league-head__eyebrow").evaluate((node) => getComputedStyle(node).color);
    expect(eyebrow).toBe("rgb(255, 176, 32)");
    await noSideScroll(page);
    await settled(page);
    // Review #2107: nur das Emblem steht auf der Bannerkante - Text in Akzentfarbe beginnt erst unter dem Bild.
    const banner = await page.getByTestId("league-head-banner").boundingBox();
    const text = await page.locator(".tls-league-head__eyebrow").boundingBox();
    const emblem = await page.getByTestId("league-head-emblem").boundingBox();
    expect(text.y).toBeGreaterThanOrEqual(banner.y + banner.height);
    expect(emblem.y).toBeLessThan(banner.y + banner.height);
    // Reiter, Tabelle und Links folgen der Akzentfarbe (die Markenfarbe ist innerhalb der Liga überschrieben).
    const brand = await page.locator(".tls-league-look").evaluate((node) => getComputedStyle(node).getPropertyValue("--tls-brand-rgb").trim());
    expect(brand).toBe("255 176 32");
    await page.screenshot({ path: `test-results/liga-gestaltung-${width}.png`, fullPage: false });
  });

  test(`Liga-Übersicht gestaltet (${width} px): Emblem und Banner der Season`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga");
    await expect(page.getByTestId("league-index-emblem-probe-liga").locator("img")).toBeVisible();
    await expect(page.getByTestId("league-index-season-season-1").locator(".tls-league-card__banner")).toBeVisible();
    await noSideScroll(page);
  });

  test(`Verwaltung (${width} px): Gestaltung der Liga und Gewinne der Season`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { admin: true });
    await page.goto("/admin/leagues");
    await page.getByTestId("league-edit-probe-shooter").click();
    const look = page.getByTestId("league-look");
    await expect(look).toContainText("Gestaltung");
    await expect(page.getByTestId("league-banner-crops")).toBeVisible();
    await page.getByTestId("league-accent").fill("#1A1A40");
    await expect(page.getByTestId("league-accent-problem")).toContainText("Kontrast");
    await noSideScroll(page);
    await settled(page);
    await page.screenshot({ path: `test-results/liga-gestaltung-admin-${width}.png`, fullPage: false });

    await page.goto("/admin/leagues/seasons/s1");
    const seasonLook = page.getByTestId("season-look");
    await expect(seasonLook).toBeVisible();
    await expect(page.getByTestId("season-prizes-text-0")).toHaveValue("Pokal und Trikot");
    await page.getByTestId("season-prizes-add").click();
    await expect(page.getByTestId("season-prizes-place-1")).toHaveValue("2");
    await expect(page.getByTestId("season-emblem-sizes").locator("img").first()).toBeVisible();
    await noSideScroll(page);
  });
}
