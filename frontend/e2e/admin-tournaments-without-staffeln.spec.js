const { test, expect } = require("@playwright/test");

// Turnierliste der Verwaltung mit Liga-Staffeln (#2453) im echten Browser, Server nachgestellt: Eine Staffel im Entwurf zeigt den
// Stand ihrer Season („Anmeldung offen bis …“) statt „Entwurf“, dazu was ihr noch fehlt, mit dem Weg ins Liga-Cockpit. Der Status-Filter
// kennt die Liga-Stände. Bei 390 und 1440 px ohne seitliches Scrollen. Nur erfundene Namen.

// Bilder fürs Issue nur auf Wunsch: SHOTS_2453=<Ordner>/<Name> legt <Name>-390.png und <Name>-1440.png ab.
const SHOTS = process.env.SHOTS_2453 || "";
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const DAY = 24 * 60 * 60 * 1000;
const iso = (offset) => new Date(Date.now() + offset).toISOString();
const GAME = { id: "g1", name: "Probe Shooter", short_name: "PS", slug: "probe-shooter" };
const BASE = {
  format: "league", team_mode: "team", event_mode: "online", result_entry_mode: "player_confirmed", game_id: "g1", game: GAME,
  visibility: "public", is_public: true,
};
const OPEN_SEASON = {
  id: "s1", status: "draft", visibility: "public", application_opens_at: iso(-2 * DAY), application_closes_at: iso(5 * DAY), start_date: iso(10 * DAY),
};
const LIST = [
  {
    ...BASE, id: "t1", slug: "probe-liga-season-1-liga-1-a", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft",
    participant_count: 1, max_participants: 8, start_date: iso(10 * DAY), created_at: iso(-3 * DAY),
    league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" }, league_label: "Liga · Staffel A",
    league_season: OPEN_SEASON, league_plan: { fixed_matches: 0 },
  },
  {
    ...BASE, id: "t2", slug: "probe-liga-season-0-liga-1-a", title: "Probe-Liga Season 0 · Liga 1 · Staffel A", status: "live",
    participant_count: 8, max_participants: 8, start_date: iso(-20 * DAY), created_at: iso(-60 * DAY),
    league_context: { league_id: "l1", season_id: "s0", division_id: "d0", staffel: "A" }, league_label: "Liga · Staffel A",
    league_season: { id: "s0", status: "active", visibility: "public", start_date: iso(-20 * DAY) }, league_plan: { fixed_matches: 28 },
  },
  {
    ...BASE, id: "t3", slug: "herbst-cup", title: "Herbst-Cup", status: "registration_open", format: "single_elim",
    participant_count: 5, max_participants: 16, start_date: iso(12 * DAY), created_at: iso(-5 * DAY),
  },
  {
    ...BASE, id: "t4", slug: "winter-cup", title: "Winter-Cup", status: "draft", format: "single_elim",
    participant_count: 0, max_participants: 16, start_date: iso(40 * DAY), created_at: iso(-1 * DAY),
  },
];

// Bilder für #2463: SHOTS_2463=<Ordner>/<Name> legt <Name>-390.png, -768.png, -1440.png und <Name>-liga-zustaendig.png ab.
const SHOTS_2463 = process.env.SHOTS_2463 || "";
// Zuständig in einer Liga, ohne Bereich (#2463): Der Server gibt ihr nur die Staffeln ihrer Liga.
const LEAGUE_HOLDER = { id: "z-1", username: "zustaendig", display_name: "Zuständige", role: "player", areas: [], has_league_staff: true, mfa_enabled: true, auth_mfa_verified: true };

async function mockServer(page, { user = ADMIN, list = LIST } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games", "partners", "events**", "stations**"]) {
    await page.route(`**/api/${path}`, json([]));
  }
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(user));
  await page.route(/\/api\/tournaments\?/, json(list));
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

for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
  test(`Turnierliste (${width} px, #2463): Karten am Handy, Tabelle ab 768 px, Überschrift und Symbole`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/tournaments");
    await expect(page.getByTestId("admin-tr-winter-cup")).toBeVisible();
    if (width < 768) {
      await expect(page.getByTestId("admin-tournament-cards")).toBeVisible();
      await expect(page.locator("table")).toHaveCount(0);
      // Status bzw. Liga-Stand, was fehlt, Teilnehmer und Regeln stehen in der Karte - ohne Wischen.
      const card = page.getByTestId("admin-tr-probe-liga-season-1-liga-1-a");
      const stand = card.getByTestId("admin-tr-stand-probe-liga-season-1-liga-1-a");
      await stand.scrollIntoViewIfNeeded();
      await expect(stand).toBeInViewport();
      const standBox = await stand.boundingBox();
      expect(standBox.x + standBox.width).toBeLessThanOrEqual(width);
      await expect(card.getByTestId("admin-tr-needs-probe-liga-season-1-liga-1-a")).toBeVisible();
      await expect(card.getByTestId("admin-tr-participants-probe-liga-season-1-liga-1-a")).toContainText("1/8");
      await expect(card.getByTestId("admin-tr-rules-probe-liga-season-1-liga-1-a")).toContainText("Online");
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
    await noSideScroll(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (SHOTS_2463) await page.screenshot({ path: `${SHOTS_2463}-${width}.png`, fullPage: true });
  });
}

test("Turnierliste als Liga-Zuständige (#2463): nur die eigenen Staffeln, Hinweis, keine Knöpfe der Turnierleitung", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockServer(page, { user: LEAGUE_HOLDER, list: LIST.filter((row) => row.league_context) });
  await page.goto("/admin/tournaments");
  await expect(page).toHaveURL(/\/admin\/tournaments$/);
  await expect(page.getByTestId("admin-tr-probe-liga-season-1-liga-1-a")).toBeVisible();
  await expect(page.getByTestId("admin-tournaments-league-scope")).toContainText("Staffeln deiner Ligen");
  await expect(page.getByTestId("admin-tr-herbst-cup")).toHaveCount(0);
  await expect(page.getByTestId("admin-new-tournament")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Löschen" })).toHaveCount(0);
  // Der Weg ins Menü: „Turniere“ steht neben der Liga.
  await expect(page.locator('nav a[href="/admin/tournaments"]').first()).toBeVisible();
  await noSideScroll(page);
  if (SHOTS_2463) await page.screenshot({ path: `${SHOTS_2463}-liga-zustaendig.png`, fullPage: true });
});

test("Turnierliste ohne Recht (#2463): „Kein Zugriff“", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServer(page, { user: { ...LEAGUE_HOLDER, has_league_staff: false }, list: [] });
  await page.goto("/admin/tournaments");
  await expect(page).toHaveURL(/\/403/);
});

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
  test(`Turnierliste (${width} px): Liga-Staffel mit Stand der Season, Hinweis und Filter`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/tournaments");
    const staffel = page.getByTestId("admin-tr-probe-liga-season-1-liga-1-a");
    await expect(staffel).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-${width}.png`, fullPage: true });

    // Stand der Season statt „Entwurf“ - dieselbe Ableitung wie die Ablaufleiste der Season.
    await expect(page.getByTestId("admin-tr-stand-probe-liga-season-1-liga-1-a")).toContainText("Anmeldung offen bis");
    await expect(staffel).not.toContainText(/entwurf/i);
    await expect(page.getByTestId("admin-tr-stand-probe-liga-season-0-liga-1-a")).toHaveText("Spielbetrieb");
    // Gewöhnliche Turniere behalten ihren Status.
    await expect(page.getByTestId("admin-tr-winter-cup")).toContainText("ENTWURF");

    // Was fehlt: Teams zuteilen - mit dem Weg in den Eingang der Season.
    const needs = page.getByTestId("admin-tr-needs-probe-liga-season-1-liga-1-a");
    await expect(needs).toContainText("Teams zuteilen");
    await expect(needs).toContainText("1 von 8");
    await expect(needs.getByRole("link")).toHaveAttribute("href", "/admin/leagues/seasons/s1#anmeldungen");
    await expect(page.getByTestId("admin-tr-needs-probe-liga-season-0-liga-1-a")).toHaveCount(0);

    // Der Status-Filter kennt die Liga-Stände; „Entwurf“ meint nur noch Turniere.
    const filter = page.getByTestId("admin-tournament-status-filter");
    await filter.selectOption("league:anmeldung");
    await expect(staffel).toBeVisible();
    await expect(page.getByTestId("admin-tr-winter-cup")).toHaveCount(0);
    await expect(page.getByTestId("admin-tr-herbst-cup")).toHaveCount(0);
    await filter.selectOption("draft");
    await expect(page.getByTestId("admin-tr-winter-cup")).toBeVisible();
    await expect(staffel).toHaveCount(0);
    await filter.selectOption("league:spielbetrieb");
    await expect(page.getByTestId("admin-tr-probe-liga-season-0-liga-1-a")).toBeVisible();
    await expect(staffel).toHaveCount(0);
    await noSideScroll(page);
  });
}
