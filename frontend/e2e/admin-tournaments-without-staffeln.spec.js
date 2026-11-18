const { test, expect } = require("@playwright/test");
const path = require("node:path");

// Turnierliste der Verwaltung ohne Staffeln (#2262, Paket D, Nr. 192) im echten Browser, Server nachgestellt: Die Liste fragt mit
// `league=exclude` - Staffeln, der Filter „Art“ und die Status-Gruppe „Liga-Staffeln“ sind weg. Die reine Liga-Leitung sieht den
// Menüpunkt „Turniere“ nicht und landet bei Liga. Karten am Handy, Tabelle ab 768 px, Überschrift und Symbole wie in #2463. Bei 390,
// 768 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab. Nur erfundene Namen.

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
// Die reine Liga-Leitung: Bereich Ligen bzw. Zuständige einer Liga, ohne Turniere und ohne Helfer-Einsatz.
const LEAGUE_AREA = { id: "l-1", username: "ligabereich", display_name: "Ligabereich", role: "player", areas: ["leagues"], mfa_enabled: true, auth_mfa_verified: true };
const LEAGUE_HOLDER = { id: "z-1", username: "zustaendig", display_name: "Zuständige", role: "player", areas: [], has_league_staff: true, mfa_enabled: true, auth_mfa_verified: true };
const DAY = 24 * 60 * 60 * 1000;
const iso = (offset) => new Date(Date.now() + offset).toISOString();
const GAME = { id: "g1", name: "Probe Shooter", short_name: "PS", slug: "probe-shooter" };
const BASE = { team_mode: "team", event_mode: "online", result_entry_mode: "player_confirmed", game_id: "g1", game: GAME, visibility: "public", is_public: true };
const STAFFEL = {
  ...BASE, id: "t1", slug: "probe-liga-season-1-liga-1-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft", format: "league",
  participant_count: 1, max_participants: 8, start_date: iso(10 * DAY), created_at: iso(-3 * DAY),
  league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" }, league_label: "Liga · Staffel A",
};
const CUPS = [
  { ...BASE, id: "t3", slug: "herbst-cup", title: "Herbst-Cup", status: "registration_open", format: "single_elim",
    participant_count: 5, max_participants: 16, start_date: iso(12 * DAY), created_at: iso(-5 * DAY) },
  { ...BASE, id: "t4", slug: "winter-cup", title: "Winter-Cup", status: "draft", format: "single_elim",
    participant_count: 0, max_participants: 16, start_date: iso(40 * DAY), created_at: iso(-1 * DAY) },
  { ...BASE, id: "t5", slug: "tiroler-liga-allmode-mit-sehr-langem-namen", title: "Tiroler Liga MW4 Allmode – Turnier im Format Liga mit sehr langem Namen",
    status: "live", format: "league", participant_count: 8, max_participants: 8, start_date: iso(-2 * DAY), created_at: iso(-9 * DAY) },
];
const LEAGUES = {
  leagues: [{ id: "l1", name: "Probe-Liga", slug: "probe-liga", game_id: "g1", game_name: "Probe Shooter", status: "active", seasons: [] }],
  games: [{ id: "g1", name: "Probe Shooter" }], can_create: false,
};

async function mockServer(page, { user = ADMIN } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  const lists = [];
  await page.route("**/api/**", json({}));
  for (const route of ["sponsors**", "notifications/me", "games", "partners", "events**", "stations**"]) {
    await page.route(`**/api/${route}`, json([]));
  }
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(user));
  await page.route("**/api/admin/leagues", json(LEAGUES));
  // Wie der Server: ohne `league=exclude` kämen die Staffeln mit (Vorgabe `include` für die App).
  await page.route(/\/api\/tournaments\?/, (route) => {
    const url = new URL(route.request().url());
    lists.push(url.search);
    const body = url.searchParams.get("league") === "exclude" ? CUPS : [STAFFEL, ...CUPS];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return lists;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

// Die Überschrift „Turniere“ steht in einer Zeile (#2463) - vorher brach sie bei 390 px als „TURNIER / E“ um.
async function headingOnOneLine(page) {
  const heading = page.getByRole("heading", { level: 1, name: "Turniere" });
  await expect(heading).toBeVisible();
  const lines = await heading.evaluate((element) => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight));
  expect(lines).toBeLessThan(1.5);
}

// Aktions-Symbole (#2463): Tippfläche mindestens 44 px, Symbol in fester Größe.
async function actionsAreTappable(row) {
  const actions = row.locator("a[aria-label], button[aria-label]");
  expect(await actions.count()).toBeGreaterThanOrEqual(2);
  for (const action of await actions.all()) {
    const box = await action.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const icon = await action.locator("svg").boundingBox();
    expect(icon.width).toBeGreaterThanOrEqual(15);
    expect(icon.height).toBeGreaterThanOrEqual(15);
  }
}

async function shot(page, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(dir, name), fullPage: false });
}

for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
  test(`Turnierliste (${width} px): ohne Staffeln, ohne Filter „Art“, Karten am Handy und Tabelle ab 768 px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const lists = await mockServer(page);
    await page.goto("/admin/tournaments");
    await expect(page.getByTestId("admin-tr-winter-cup")).toBeVisible();
    expect(lists.every((search) => search.includes("league=exclude"))).toBe(true);
    await expect(page.getByTestId("admin-tr-probe-liga-season-1-liga-1-a")).toHaveCount(0);
    await expect(page.getByTestId("admin-tournament-kind-filter")).toHaveCount(0);
    await expect(page.getByTestId("admin-tournaments-league-scope")).toHaveCount(0);
    const options = await page.getByTestId("admin-tournament-status-filter").locator("option").allTextContents();
    expect(options.join(" | ")).not.toMatch(/Liga/);
    // Ein Turnier im Format Liga bleibt ein Turnier - es steht hier, ohne Liga-Kennzeichen.
    await expect(page.getByTestId("admin-tr-tiroler-liga-allmode-mit-sehr-langem-namen")).toBeVisible();
    await expect(page.locator('[data-testid^="admin-tr-league-label-"]')).toHaveCount(0);
    if (width < 768) {
      await expect(page.getByTestId("admin-tournament-cards")).toBeVisible();
      await expect(page.locator("table")).toHaveCount(0);
      await expect(page.getByTestId("admin-tr-participants-herbst-cup")).toContainText("5/16");
      await expect(page.getByTestId("admin-tr-rules-herbst-cup")).toContainText("Online");
    } else {
      await expect(page.locator("table")).toBeVisible();
      await expect(page.getByTestId("admin-tournament-cards")).toHaveCount(0);
      // Auch in der Tabelle kein Wischen: Die Spalte „Aktion“ steht im Bild.
      const inner = await page.locator("table").evaluate((table) => table.parentElement.scrollWidth - table.parentElement.clientWidth);
      expect(inner).toBeLessThanOrEqual(1);
      await expect(page.getByRole("columnheader", { name: "Aktion" })).toBeInViewport();
    }
    await headingOnOneLine(page);
    await actionsAreTappable(page.getByTestId("admin-tr-winter-cup"));
    await expect(page.getByText(/\d+ \/ \d+ sichtbar/)).toHaveText("3 / 3 sichtbar");
    await noSideScroll(page);
    if (width !== 768) await shot(page, `turnierliste-${width}.png`);
  });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Reine Liga-Leitung (${width} px): kein Menüpunkt „Turniere“, /admin/tournaments führt zur Liga`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page, { user: LEAGUE_AREA });
    await page.goto("/admin/tournaments");
    await expect(page).toHaveURL(/\/admin\/leagues$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Liga");
    if (width < 1024) {
      // Am Handy liegt das Menü in der Schublade - erst offen ist zu sehen, was darin steht.
      await expect(async () => {
        await page.getByTestId("admin-menu-open").click();
        await expect(page.getByTestId("admin-menu-overlay")).toBeVisible({ timeout: 1000 });
      }).toPass();      // Die Schublade gleitet herein - das Bild erst, wenn der Eintrag Liga ganz im Bild steht.
      await expect(page.locator('aside a[href="/admin/leagues"]')).toBeInViewport({ ratio: 1 });
      await page.waitForTimeout(400);
    }
    await expect(page.locator('a[href="/admin/leagues"]:visible').first()).toBeVisible();
    await expect(page.locator('nav a[href="/admin/tournaments"]')).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, `menue-liga-leitung-${width}.png`);
  });
}

test("Zuständige einer Liga: /admin/tournaments führt zur Liga, kein „Turniere“ im Menü", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockServer(page, { user: LEAGUE_HOLDER });
  await page.goto("/admin/tournaments");
  await expect(page).toHaveURL(/\/admin\/leagues$/);
  await expect(page.locator('nav a[href="/admin/tournaments"]')).toHaveCount(0);
});

test("Turnierliste ohne Recht: „Kein Zugriff“", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServer(page, { user: { ...LEAGUE_HOLDER, has_league_staff: false } });
  await page.goto("/admin/tournaments");
  await expect(page).toHaveURL(/\/403/);
});
