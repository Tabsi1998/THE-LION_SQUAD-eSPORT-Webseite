const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Liga-Abzeichen (#1638) und „Aktuelle Ligen“ mit Saisonverlauf (#1630) im echten Browser, Server nachgestellt: alle Stufen und Größen
// des Abzeichens (Liga 1 mit Krone, Gold nur für den Meister, langer Beiname), das Personenprofil mit „Aktuelle Ligen“ und Linie und die
// Teamseite mit Co-Teams nach Liga N - bei 390 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab
// (liga-abzeichen-…, profil-aktuelle-ligen-…, teamseite-liga-…). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const current = (id, level, nickname, extra = {}) => ({
  registration_id: id, squad_name: `Nordlicht ${id.toUpperCase()}`, display_name: `Nordlicht · Nordlicht ${id.toUpperCase()}`, team_id: "team-1",
  league: { name: "Probe-Liga", slug: "probe-liga" }, season: { name: "Season 3", slug: "season-3" },
  division_label: nickname ? `Liga ${level} · ${nickname}` : `Liga ${level}`, staffel: "A", badge: { level, nickname, champion: false },
  emblem_url: null, link: "/liga/probe-liga/season-3#staffel-probe-a", internal: false,
  rank: 2, of: 8, zone: null, zone_label: null, next_match: { match_id: `m-${id}`, scheduled_at: "2026-11-26T19:00:00+00:00", matchday: 4, opponent: "Sturmfalken · Falken Rot", link: `/matches/m-${id}` },
  ...extra,
});
const CURRENT = [
  current("a", 1, "Elite", { rank: 1, of: 8, internal: true }),
  current("b", 2, null, { rank: 1, of: 6, zone: "promotion", zone_label: "Aufstieg" }),
  current("c", 3, "Donaudampfschifffahrtsgesellschaft-Nachwuchsliga", { rank: null, of: 7, next_match: { match_id: "m-c", scheduled_at: null, matchday: 1, opponent: null } }),
];
const season = (number, level, rank, team, extra = {}) => ({
  season_id: `s${number}`, season_name: `Season ${number}`, season_number: number, league_name: "Probe-Liga", url: "/liga/probe-liga/season-1",
  division_label: level === 1 ? "Liga 1 · Elite" : `Liga ${level}`, staffel: "A", display_name: team, rank, of: 6, points: 12, champion: false, zone: null,
  closed_at: `2026-0${number}-15T20:00:00+00:00`, badge: { level, nickname: level === 1 ? "Elite" : null, champion: Boolean(extra.champion) }, internal: false, ...extra,
});
const HISTORY = [
  season(1, 3, 1, "Nordlicht · Nordlicht A", { zone: "promotion" }),
  season(2, 2, 2, "Nordlicht · Nordlicht A", { zone: "promotion" }),
  season(3, 1, 1, "Nordlicht · Nordlicht A", { champion: true }),
].reverse();
const TEAM_HISTORY = [...HISTORY, season(2, 3, 4, "Nordlicht · Nordlicht B"), season(3, 3, 2, "Nordlicht · Nordlicht B")];

const PROFILE = { id: "p1", username: "neonfalke", display_name: "NeonFalke", role: "player", country: "AT", created_at: "2025-03-01T10:00:00+00:00", stats: {}, teams: [],
  tournaments: [], awards: [], featured_award: null, featured_title: null, featured_emblems: [], league_history: HISTORY, league_overall: [], league_current: CURRENT,
  achievement_level: { level: 7, progress: 40 }, privacy_public_profile: true };
const TEAM = { id: "team-1", name: "Nordlicht", tag: "NRD", leader_id: "p9", co_leader_ids: [], member_ids: ["p9"], members: [{ id: "p9", username: "kapitaen", display_name: "Kapitän" }],
  is_member: false, can_manage: false, awards: [], featured_award: null, featured_title: null, featured_emblems: [], rank_banners: [],
  league_history: TEAM_HISTORY, league_overall: [] };
const TEAM_LEAGUE = CURRENT.map((row) => ({ ...row, internal: undefined, staffel_label: `${row.division_label} · Staffel A` }));

async function mockServer(page, { reduce = false } = {}) {
  if (reduce) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "streams/live", "teams?**"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/me/rewards/unseen", json({ rewards: [] }));
  await page.route("**/api/users/public/neonfalke**", json(PROFILE));
  await page.route("**/api/teams/team-1", json(TEAM));
  await page.route("**/api/teams/team-1/overview", json({ upcoming: [], recent: [], league: TEAM_LEAGUE }));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const HIDE_CHROME = ".tls-bottom-nav, [data-testid=site-header], [data-testid=scroll-top-btn], .tls-skip-link { visibility: hidden !important; } .sticky { position: static !important; }";

async function shot(target, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", style: HIDE_CHROME });
}

// Zwei Abschnitte untereinander in einem Bild.
async function shotSpan(page, first, last, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await first.scrollIntoViewIfNeeded();
  const a = await first.boundingBox();
  const b = await last.boundingBox();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const pad = 8;
  const left = Math.max(0, Math.min(a.x, b.x) - pad);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true, animations: "disabled", style: HIDE_CHROME,
    clip: { x: left + scroll.x, y: Math.max(0, a.y - pad) + scroll.y, width: Math.max(a.x + a.width, b.x + b.width) + pad - left, height: b.y + b.height - a.y + 2 * pad } });
}

test.describe("Liga-Abzeichen und Aktuelle Ligen", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Abzeichen bei ${width} px: Stufen, Größen, Meister und langer Beiname`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { reduce: true });
      await page.goto("/");
      await page.evaluate(async () => (await import("/e2e/fixtures/leagueBadgeGallery.jsx")).mount());
      const gallery = page.getByTestId("badge-gallery");
      await expect(gallery).toBeVisible();
      for (const size of ["list", "card", "hero"]) {
        await expect(page.getByTestId(`gallery-${size}-0`)).toHaveAttribute("data-tier", "top");
        await expect(page.getByTestId(`gallery-${size}-0-crown`)).toBeVisible();
        await expect(page.getByTestId(`gallery-${size}-1`)).toHaveAttribute("data-tier", "mid");
        await expect(page.getByTestId(`gallery-${size}-1-crown`)).toHaveCount(0);
        await expect(page.getByTestId(`gallery-${size}-2`)).toHaveAttribute("data-tier", "base");
        await expect(page.getByTestId(`gallery-${size}-4`)).toHaveAttribute("data-metal", "gold");
        await expect(page.getByTestId(`gallery-${size}-0`)).toHaveAttribute("data-metal", "cyan");
        // Mit „Bewegung reduzieren“ steht alles still.
        await expect(page.getByTestId(`gallery-${size}-0`)).toHaveAttribute("data-play", "done");
      }
      await expect(page.getByTestId("gallery-card-0-label")).toHaveText("Liga 1 · Elite");
      await noSideScroll(page);
      await shot(gallery, `liga-abzeichen-${width}`);
    });

    test(`Profil bei ${width} px: Aktuelle Ligen mit Abzeichen, Platz, Zone, nächstem Spiel und Saisonverlauf`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/u/neonfalke");
      const block = page.getByTestId("profile-league-current");
      await expect(block).toBeVisible();
      await expect(block.getByTestId("profile-league-current-a-label")).toHaveText("Liga 1 · Elite · Staffel A");
      await expect(block.getByTestId("profile-league-current-a-badge")).toHaveAttribute("data-tier", "top");
      await expect(block.getByTestId("profile-league-current-a-internal")).toBeVisible();
      await expect(block.getByTestId("profile-league-current-a-place")).toHaveText("Platz 1 von 8");
      await expect(block.getByTestId("profile-league-current-b-zone")).toContainText("Aufstieg");
      await expect(block.getByTestId("profile-league-current-c-place")).toHaveText("Noch ohne Ergebnis · 7 Teams");
      await expect(block.getByTestId("profile-league-current-a-next")).toContainText("gegen Sturmfalken · Falken Rot");
      // Beim ersten Erscheinen spielt die Bewegung einmal, danach Ruhe.
      await expect(block.getByTestId("profile-league-current-a-badge")).toHaveAttribute("data-play", /run|done/);
      const line = page.getByTestId("profile-season-line");
      await expect(line.getByRole("img")).toHaveAttribute("aria-label", /Season 1: Liga 3, Platz 1 von 6; Season 2: Liga 2, Platz 2 von 6; Season 3: Liga 1, Platz 1 von 6, Meister/);
      await expect(line.getByTestId("profile-season-line-point-0-2")).toHaveAttribute("data-champion", "true");
      await expect(page.getByTestId("profile-league-history-s3-badge")).toHaveAttribute("data-metal", "gold");
      await expect(page.getByTestId("profile-league-history-s2-badge")).toHaveAttribute("data-metal", "cyan");
      await noSideScroll(page);
      await page.waitForTimeout(1800);
      await shotSpan(page, block, line, `profil-aktuelle-ligen-${width}`);
    });

    test(`Teamseite bei ${width} px: Co-Teams nach Liga N, je Co-Team eine Linie`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/teams/team-1");
      const block = page.getByTestId("team-league");
      await expect(block).toBeVisible();
      const order = await block.locator("[data-tier]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tier")));
      expect(order).toEqual(["top", "mid", "base"]);
      await expect(block.getByTestId("team-league-a")).toContainText("Nordlicht A");
      const line = page.getByTestId("team-season-line");
      await expect(line.getByTestId("team-season-line-legend")).toContainText("Nordlicht · Nordlicht B");
      await expect(page.getByTestId("team-league-history")).toBeVisible();
      await noSideScroll(page);
      await page.waitForTimeout(1800);
      await shotSpan(page, block, line, `teamseite-liga-${width}`);
    });
  }

  test("Bewegung reduzieren: Abzeichen und Linie stehen still", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { reduce: true });
    await page.goto("/u/neonfalke");
    await expect(page.getByTestId("profile-league-current-a-badge")).toHaveAttribute("data-play", "done");
    await expect(page.getByTestId("profile-season-line").locator(".tls-season-line")).toHaveAttribute("data-play", "done");
  });
});
