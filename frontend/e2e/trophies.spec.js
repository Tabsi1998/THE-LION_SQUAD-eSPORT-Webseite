const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Belohnungen II (#2425, Nr. 34c, 59, 60) im echten Browser, Server nachgestellt: der Reiter „Trophäen“ an Profil und Team mit Filtern,
// bis zu drei Embleme neben dem Namen, das Rankingbanner an der Teamseite - bei 390 und 1440 px ohne seitliches Scrollen. Mit
// E2E_SCREENS_DIR legt der Test die Bilder ab (trophaeen-390, profil-embleme-1440). Nur erfundene Namen, dazu ein Name im schlimmsten Fall.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};
// Ein 1×1-PNG für die Vorschau des Rankingbanners.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const PLAYER = { id: "p1", username: "neonfalke", display_name: "NeonFalke", role: "player", roles: ["player"], areas: [], email_verified: true };
const LONG = "Donaudampfschifffahrtsgesellschaftskapitänsmützenträger-Gedächtnismedaille";
const art = (place, metal, season = "Season 1", division = "Liga 1") => ({ league: "Probe-Liga", season, division, place, metal });
const reward = (id, kind, name, place, metal, extra = {}) => ({
  id, kind, rank: Number(place[0]) || 5, rank_label: place, participants: 8, matches: { played: 7, won: 5 }, record: "5 Siege · 2 Niederlagen",
  tournament: { id: "s-a", slug: "probe-a", title: "Probe-Liga · Season 1" }, game: { name: "Probe Shooter" }, season: { id: "s1", name: "Season 1" },
  team: { id: "team-1", name: "Nordlicht" }, league: { title: name, season_id: "s1", division_label: "Liga 1", staffel: "A", display_name: "Nordlicht · Nordlicht A" },
  image_url: null, date: "2026-11-09", updated_at: "2027-01-12T19:30:00+00:00",
  reward: { id, kind, kind_label: { medal: "Medaille", banner: "Banner", emblem: "Emblem", title: "Titel" }[kind], name, description: "", place_label: place,
    recipients_label: "Team", image_url: null, prize: null, art: art(place, metal) }, ...extra,
});
const GOLD = reward("w-gold", "medal", LONG, "1. Platz", "gold");
const EMBLEM = reward("w-emblem", "emblem", "Aufsteiger-Emblem", "1. Platz", "gold");
const PODIUM = reward("w-podium", "emblem", "Podest-Emblem", "2. Platz", "silver");
const TITLE = reward("w-title", "title", "Kämpferherz", "4. Platz", "lion");
const SEASON_BANNER = reward("w-banner", "banner", "Season-Banner", "Alle Teilnehmer", "lion");
const CUP = { id: "w-cup", kind: "trophy", rank: 1, rank_label: "1. Platz", participants: 16, matches: { played: 4, won: 4 }, record: "4 Siege · 0 Niederlagen",
  tournament: { id: "t-cup", slug: "fruehjahrs-cup", title: "Frühjahrs-Cup" }, game: { name: "Rennspiel" }, season: { id: "y25", name: "Saison 2025" }, team: null,
  league: null, image_url: null, date: "2025-04-12", reward: null };
const FLAG = { ...CUP, id: "w-flag", kind: "banner", rank: 6, rank_label: "6. Platz", tournament: { id: "t-w", slug: "winter-cup", title: "Winter-Cup" }, date: "2025-01-20" };
const AWARDS = [GOLD, EMBLEM, PODIUM, TITLE, SEASON_BANNER, CUP, FLAG];

const PROFILE = { id: "p1", username: "neonfalke", display_name: "NeonFalke", role: "player", country: "AT", created_at: "2025-03-01T10:00:00+00:00", stats: {}, teams: [],
  tournaments: [], awards: AWARDS, featured_award: null, featured_title: TITLE, featured_emblems: [GOLD, EMBLEM, PODIUM], league_history: [],
  achievement_level: { level: 7, progress: 40 }, privacy_public_profile: true };
const TEAM = { id: "team-1", name: "Nordlicht", tag: "NRD", leader_id: "p1", co_leader_ids: [], member_ids: ["p1"], members: [{ id: "p1", username: "neonfalke", display_name: "NeonFalke" }],
  is_member: false, can_manage: false, awards: AWARDS, featured_award: null, featured_title: TITLE, featured_emblems: [EMBLEM, PODIUM],
  rank_banners: [{ key: "s1:sq-1", league: "Probe-Liga", season: "Season 1", division: "Liga 1", staffel: "A", name: "Nordlicht · Nordlicht A",
    image_url: "/api/leagues/probe-liga/season-1/teams/sq-1/banner.png", page_url: "/liga/probe-liga/season-1" }],
  league_history: [], league_overall: [] };

async function mockServer(page, { user = null } = {}) {
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "streams/live"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (user) await page.route("**/api/auth/me", json(user));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/me/rewards/unseen", json({ rewards: [] }));
  await page.route("**/api/users/public/neonfalke**", json(PROFILE));
  await page.route("**/api/teams/team-1", json(TEAM));
  await page.route("**/api/teams/team-1/overview", json({ upcoming: [], recent: [] }));
  await page.route("**/api/leagues/**/banner.png", (route) => route.fulfill({ contentType: "image/png", body: PNG }));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(target, name, style = "") {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", style: `.tls-bottom-nav { display: none !important; } ${style}` });
}

test.describe("Trophäen, Embleme und Rankingbanner", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Profil bei ${width} px: Reiter „Trophäen“ mit Filtern, drei Embleme neben dem Namen`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/u/neonfalke?tab=trophaeen");
      await expect(page.getByTestId("profile-tab-awards")).toHaveText("Trophäen (7)");
      const cabinet = page.getByTestId("profile-trophies");
      await expect(cabinet).toBeVisible();
      await expect(cabinet.getByTestId("profile-trophies-count")).toHaveText("7 Trophäen");
      // Der Zähler bleibt in der Vitrine - am Handy in einer eigenen Zeile (Review #2425).
      const box = await cabinet.boundingBox();
      const count = await cabinet.getByTestId("profile-trophies-count").boundingBox();
      expect(count.x + count.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
      if (width === 390) expect(count.x).toBeLessThanOrEqual(box.x + 0.5);
      await expect(cabinet.getByTestId("trophy-card-w-cup")).toContainText("Frühjahrs-Cup");
      await expect(cabinet.getByTestId("trophy-card-w-cup").getByRole("link")).toHaveAttribute("href", "/tournaments/fruehjahrs-cup");
      await expect(cabinet.getByTestId("trophy-name-w-gold")).toHaveText(LONG);
      // Gäste wählen nichts.
      await expect(cabinet.getByTestId("trophy-emblem-w-gold")).toHaveCount(0);
      const emblems = page.getByTestId("profile-featured-emblems");
      await expect(emblems).toHaveAttribute("aria-label", `Embleme: ${LONG}, Aufsteiger-Emblem, Podest-Emblem`);
      await expect(page.getByTestId("profile-featured-title")).toContainText("Kämpferherz");
      await noSideScroll(page);
      if (width === 390) await shot(cabinet, "trophaeen-390", "[data-testid=site-header], .tls-skip-link, [data-testid=scroll-top-btn] { visibility: hidden !important; } .sticky { position: static !important; }");
      if (width === 1440) await shot(page.getByTestId("profile-hero"), "profil-embleme-1440");

      await cabinet.getByTestId("profile-trophies-kind-emblem").click();
      await expect(cabinet.getByTestId("profile-trophies-count")).toHaveText("2 von 7");
      await cabinet.getByTestId("profile-trophies-period").selectOption("Saison 2025");
      await expect(cabinet.getByTestId("profile-trophies-no-match")).toBeVisible();
      await cabinet.getByTestId("profile-trophies-reset").click();
      await cabinet.getByTestId("profile-trophies-place").selectOption("other");
      await expect(cabinet.getByTestId("profile-trophies-count")).toHaveText("3 von 7");
      await noSideScroll(page);
    });

    test(`Eigenes Profil bei ${width} px: Embleme wählen, beim vierten gesperrt`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page, { user: PLAYER });
      const sent = [];
      await page.route("**/api/me/awards/emblems", (route) => {
        sent.push(route.request().postDataJSON());
        return json({ ok: true, featured_emblems: [] })(route);
      });
      await page.goto("/u/neonfalke?tab=trophaeen");
      const cabinet = page.getByTestId("profile-trophies");
      await expect(cabinet.getByTestId("profile-trophies-emblem-hint")).toContainText("3 von 3 gewählt.");
      await expect(cabinet.getByTestId("trophy-emblem-w-podium")).toHaveText("Emblem 3 ✓");
      await expect(cabinet.getByTestId("trophy-emblem-w-title")).toHaveCount(0);
      await cabinet.getByTestId("trophy-emblem-w-emblem").click();
      await expect.poll(() => sent).toEqual([{ award_ids: ["w-gold", "w-podium"] }]);
      await noSideScroll(page);
    });

    test(`Teamseite bei ${width} px: Reiter „Trophäen“, Embleme im Kopf, Rankingbanner kopieren`, async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await mockServer(page);
      await page.goto("/teams/team-1");
      await expect(page.getByTestId("team-featured-emblems")).toHaveAttribute("aria-label", "Embleme: Aufsteiger-Emblem, Podest-Emblem");
      const banners = page.getByTestId("team-rank-banners");
      await expect(banners).toContainText("Probe-Liga · Season 1");
      await banners.getByTestId("team-rank-banners-s1:sq-1-copy-button").click();
      await expect(banners.getByTestId("team-rank-banners-s1:sq-1-copy-button")).toHaveText("Kopiert");
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(/\/api\/leagues\/probe-liga\/season-1\/teams\/sq-1\/banner\.png$/);
      await noSideScroll(page);

      await page.getByTestId("team-tab-trophies").click();
      const cabinet = page.getByTestId("team-trophies");
      await expect(cabinet).toBeVisible();
      await expect(cabinet.getByTestId("team-trophies-count")).toHaveText("7 Trophäen");
      await cabinet.getByTestId("team-trophies-kind-trophy").click();
      await expect(cabinet.getByTestId("team-trophies-count")).toHaveText("1 von 7");
      await noSideScroll(page);
    });
  }
});
