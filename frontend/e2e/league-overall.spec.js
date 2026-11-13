const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Gesamtwertung über Seasons (F.5, #2215, docs/LIGA.md „F.5“) im echten Browser, Server nachgestellt: die Ligaseite mit Co-Teams und
// Spielern je Liga N, die Verwaltung mit Einstellungen und das Abschluss-Cockpit - bei 390 und 1440 px ohne seitliches Scrollen. Mit
// E2E_SCREENS_DIR legt der Test die Bilder ab (f5-gesamtwertung-1440, f5-gesamtwertung-390, f5-verwaltung-1440). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };

const SEASONS = [{ id: "s1", name: "Season 1", slug: "season-1" }, { id: "s2", name: "Season 2", slug: "season-2" }, { id: "s3", name: "Season 3", slug: "season-3" }];
const cell = (season_id, points, place, extra = {}) => ({ season_id, played: true, points, place, of: 6, counted: true, champion: place === 1, exit: null, ...extra });
const none = (season_id) => ({ season_id, played: false });
const TEAMS = [
  ["Nordlicht · Nordlicht A", "team-1", [cell("s1", 8, 1), cell("s2", 5, 2), cell("s3", 8, 1)], 21, true],
  ["Sturmfalken · Falken Rot", "team-2", [cell("s1", 5, 2), cell("s2", 8, 1), cell("s3", 4, 3, { counted: false })], 13, false],
  ["Donaustädter Wolkenkratzerkletterverein · Zweite Mannschaft der Abendrunde", null, [cell("s1", 4, 3), cell("s2", 4, 3), cell("s3", 5, 2)], 13, false],
  ["Eisbären · Eisbären B", "team-4", [cell("s1", 3, 4), none("s2"), cell("s3", 3, 4)], 6, false],
  ["Wüstenfüchse · Füchse A", "team-5", [cell("s1", 0, null, { exit: "withdrawn", place: null }), cell("s2", 3, 4), cell("s3", 2, 5)], 5, false],
].map(([name, team_id, seasons, total, climbed], index) => ({ key: `squad:${index}`, name, team_id, place: index === 2 ? 2 : index + 1, total, tie: index === 1 || index === 2,
  wins: seasons.filter((row) => row.place === 1).length, lead_decision: null, climbed, seasons }));
const PLAYERS = [
  { key: "u1", name: "NeonFalke", username: "neonfalke", private: false, place: 1, total: 21, tie: false, seasons: TEAMS[0].seasons },
  { key: "u2", name: "Polarlicht", username: "polarlicht", private: false, place: 2, total: 18, tie: false,
    seasons: [cell("s1", 5, 2, { co_team_name: "Sturmfalken · Falken Rot" }), cell("s2", 5, 2), cell("s3", 8, 1)] },
  { key: null, name: "Spieler mit privatem Profil", username: null, private: true, place: 3, total: 9, tie: false, seasons: [cell("s1", 4, 3), none("s2"), cell("s3", 5, 2)] },
];
const GOLD = { id: "gold", kind: "medal", kind_label: "Medaille", name: "Gesamtsieger 2027", description: "", places: { mode: "rank", rank: 1 }, place_label: "1. Platz",
  recipients: ["team", "players"], recipients_label: "Team und Spieler mit Einsatz", image_url: null, prize: null, metal: "gold" };
const OVERALL = {
  league: { name: "Probe-Liga", slug: "probe-liga" }, period: { id: "p1", name: "2027" }, seasons: SEASONS,
  settings: { points_mode: "teams", points_mode_label: "", points_table: [], champion_bonus: 2, counting: "best", best_count: 2,
    tiebreakers: [{ key: "wins", label: "Mehr Staffelsiege" }, { key: "best_place", label: "Bessere beste Platzierung" }] },
  levels: [
    { level: 1, label: "Liga 1 · Elite", closed: false, final: null, season_ids: ["s1", "s2", "s3"], teams: TEAMS, players: PLAYERS, rewards: [GOLD] },
    { level: 2, label: "Liga 2", closed: false, final: null, season_ids: ["s1", "s2", "s3"], players: [], rewards: [],
      teams: [{ ...TEAMS[3], place: 1, climbed: false }] },
  ],
};
const PUBLIC_SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { name: "Season 3", slug: "season-3", status: "active", start_date: "2027-03-01T23:00:00+00:00", matchday_days: 7, best_of: 3, team_size: 4, blocked_periods: [] },
  map_pool: null, rewards: [], divisions: [], overall: { period_id: "p1", name: "2027" },
};
const SETTINGS = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, can_edit: true, enabled: true,
  settings: { points_mode: "teams", points_table: [], champion_bonus: 2, counting: "best", best_count: 2, tiebreakers: ["wins", "best_place", "latest"], reward_players: "fielded" },
  rewards: [GOLD], periods: [{ id: "p1", name: "2027", season_ids: ["s1", "s2", "s3"], closed_levels: [] }],
  seasons: SEASONS.map((row, index) => ({ ...row, number: index + 1, visibility: "public" })),
};
const COCKPIT = {
  period: { id: "p1", name: "2027" }, seasons: SEASONS, can_act: true, superadmin: false, methods: {},
  settings: OVERALL.settings,
  levels: [
    { level: 1, label: "Liga 1 · Elite", closed: false, final: null, season_ids: ["s1", "s2", "s3"], teams: TEAMS, players: PLAYERS, decisions: [],
      blockers: [], ties: [{ place: 2, keys: ["squad:1", "squad:2"], names: [TEAMS[1].name, TEAMS[2].name], total: 13, own_team: false }],
      own_team: false, closed_by_me: false, rewards: 0, can_close: true, can_reopen: false, can_decide: true, history: [] },
    { level: 2, label: "Liga 2", closed: true, final: { id: "f1", version: 2, closed_at: "2027-06-30T18:00:00+00:00", closed_by_name: "Leitung" }, season_ids: ["s1", "s2", "s3"],
      teams: [{ ...TEAMS[3], place: 1 }], players: [], decisions: [], blockers: [], ties: [], own_team: false, closed_by_me: false, rewards: 3,
      can_close: false, can_reopen: true, can_decide: false,
      history: [{ id: "f1", version: 2, active: true, closed_at: "2027-06-30T18:00:00+00:00", closed_by_name: "Leitung", leader: TEAMS[3].name },
        { id: "f0", version: 1, active: false, closed_at: "2027-06-20T18:00:00+00:00", closed_by_name: "Leitung", leader: TEAMS[3].name,
          reopened_at: "2027-06-25T10:00:00+00:00", reopened_by_name: "Zweite Leitung", reopen_reason: "Endstand Season 3 korrigiert" }] },
  ],
};

async function mockServer(page, { user = null } = {}) {
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "streams/live"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (user) await page.route("**/api/auth/me", json(user));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/me/rewards/unseen", json({ rewards: [] }));
  await page.route("**/api/leagues", json({ leagues: [] }));
  await page.route("**/api/leagues/probe-liga/season-3", json(PUBLIC_SEASON));
  await page.route("**/api/leagues/probe-liga/season-3/overall", json(OVERALL));
  await page.route("**/api/admin/leagues/l1/overall", json(SETTINGS));
  await page.route("**/api/admin/leagues/l1/overall/p1", json(COCKPIT));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(target, name, style = "", extra = {}) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", style: `.tls-bottom-nav { display: none !important; } ${style}`, ...extra });
}

test.describe("Liga: Gesamtwertung über Seasons", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Ligaseite bei ${width} px: Co-Teams mit Punkten je Season, Streichergebnis, Spieler und Liga N`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/liga/probe-liga/season-3/gesamtwertung");
      await expect(page.getByTestId("season-nav-gesamtwertung")).toHaveAttribute("aria-current", "page");
      const table = page.getByTestId("overall-1-teams-table");
      await expect(table.getByTestId("overall-1-teams-table-row-0")).toContainText("Nordlicht");
      await expect(table.getByTestId("overall-1-teams-table-row-0")).toHaveAttribute("data-climbed", "true");
      await expect(table.locator('[data-counted="false"]').first()).toHaveAttribute("title", /Streichergebnis/);
      await expect(page.getByTestId("overall-1-rules")).toContainText("Es zählen die besten 2 Seasons.");
      await expect(page.getByTestId("league-rewards-gesamt-1")).toContainText("Gesamtsieger 2027");
      // Lange Namen trennen mit Silbentrennung - „anywhere“ bricht nur noch, wenn ein Wort sonst nicht passt.
      expect(await table.locator(".tls-overall-name").nth(2).evaluate((node) => getComputedStyle(node).hyphens)).toBe("auto");
      if (width === 390) {
        // Am Handy stehen die Seasons im Aufklappen.
        await expect(table.locator("th", { hasText: "Season 1" })).toBeHidden();
        await table.getByTestId("overall-1-teams-table-more-1").click();
        await expect(table).toContainText("Season 3 · Platz 3 von 6");
      } else {
        await expect(table.locator("th", { hasText: "Season 1" })).toBeVisible();
      }
      await noSideScroll(page);
      // Die Summen zählen beim Sichtbarwerden hoch - auch die letzte Zeile steht danach auf ihrem Wert.
      await table.getByTestId("overall-1-teams-table-row-4").scrollIntoViewIfNeeded();
      await expect(table.getByTestId("overall-1-teams-table-row-4").locator(".tls-overall-total")).toHaveText("5");
      // Erst wenn die Zeilen stehen und das Aufleuchten durch ist, das Bild.
      await page.waitForTimeout(2200);
      if (width === 390) {
        // Am Handy ein Bild des Bildschirms ab der Liga-Auswahl - ohne den klebenden Seitenkopf über der Tabelle.
        await page.evaluate(() => {
          document.activeElement?.blur();
          const top = document.querySelector("[data-testid=overall]").getBoundingClientRect().top + window.scrollY;
          window.scrollTo(0, top - 72);
        });
        await page.waitForTimeout(300);
        await shot(page, "f5-gesamtwertung-390");
      }
      else await shot(page.getByTestId("overall"), "f5-gesamtwertung-1440");
      await page.getByTestId("overall-1-players").click();
      await expect(page.getByTestId("overall-1-players-table")).toContainText("Spieler mit privatem Profil");
      await expect(page.getByTestId("overall-1-players-table").getByRole("link", { name: "NeonFalke" })).toHaveAttribute("href", "/u/neonfalke");
      await page.getByTestId("overall-level-2").click();
      await expect(page.getByTestId("overall-2")).toContainText("Eisbären");
      await noSideScroll(page);
    });

    test(`Ligaseite bei ${width} px mit „Bewegung reduzieren“: Zeilen stehen sofort`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/liga/probe-liga/season-3/gesamtwertung");
      const row = page.getByTestId("overall-1-teams-table-row-0");
      await expect(row).toBeVisible();
      expect(await row.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    });

    test(`Verwaltung bei ${width} px: Einstellungen und Abschluss-Cockpit`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page, { user: ADMIN });
      let sent = null;
      await page.route("**/api/admin/leagues/l1/overall", (route) => {
        if (route.request().method() === "PUT") sent = route.request().postDataJSON();
        return json(SETTINGS)(route);
      });
      await page.goto("/admin/leagues/l1/gesamtwertung");
      const panel = page.getByTestId("overall-panel-einstellungen");
      await expect(panel.getByTestId("overall-points-mode-teams")).toBeChecked();
      await expect(panel.getByTestId("overall-best")).toHaveValue("2");
      await noSideScroll(page);
      if (width === 1440) await shot(page, "f5-verwaltung-1440", "[data-testid=overall-settings-bar] { position: static !important; }");
      await panel.getByTestId("overall-bonus").fill("3");
      await panel.getByTestId("overall-settings-save").click();
      await expect.poll(() => sent?.champion_bonus).toBe(3);

      await page.getByTestId("overall-tab-abschluss").click();
      const top = page.getByTestId("overall-level-1");
      await expect(top.getByTestId("overall-level-1-state")).toHaveText("Bereit");
      await expect(top.getByTestId("overall-level-1-ties")).toContainText("Platz 2");
      await expect(page.getByTestId("overall-level-2-history")).toContainText("Endstand Season 3 korrigiert");
      await top.getByTestId("overall-level-1-close").click();
      await expect(page.getByTestId("overall-close-leader")).toContainText("Nordlicht");
      await noSideScroll(page);
    });
  }
});
