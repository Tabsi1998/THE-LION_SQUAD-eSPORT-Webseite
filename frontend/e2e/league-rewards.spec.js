const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Belohnungen der Liga (F.4, #2214, docs/LIGA.md „F.4 Belohnungen“) im echten Browser, Server nachgestellt: der Reiter „Belohnungen“
// der Season, die Sammlung im Profil, die Zeremonie beim nächsten Besuch und das Podest mit Belohnungen auf der Ligaseite - bei 390 und
// 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab (f4-belohnungen-verwaltung-1440,
// f4-profil-sammlung-390, f4-zeremonie-1440). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const TEAMS = ["Nordlicht · Nordlicht A", "Sturmfalken · Falken Rot", "Eisbären · Eisbären B", "Wüstenfüchse · Füchse A"];
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const PLAYER = { id: "p1", username: "neonfalke", display_name: "NeonFalke", role: "player", roles: ["player"], areas: [], email_verified: true };

const item = (id, kind, name, places, recipients, extra = {}) => ({ id, kind, kind_label: { medal: "Medaille", banner: "Banner", emblem: "Emblem", title: "Titel" }[kind], name,
  description: "", places, place_label: places.mode === "rank" ? `${places.rank}. Platz` : places.mode === "range" ? `Platz ${places.from}–${places.to}` : "Alle Teilnehmer",
  recipients, recipients_label: recipients.map((who) => (who === "team" ? "Team" : "Spieler mit Einsatz")).join(" und "), image_url: null, prize: null,
  metal: places.mode === "rank" ? ({ 1: "gold", 2: "silver", 3: "bronze" }[places.rank] || "lion") : "lion", ...extra });
const GOLD = item("gold", "medal", "Goldmedaille", { mode: "rank", rank: 1 }, ["team", "players"], { prize: "Gutschein für das Team" });
const SILVER = item("silver", "medal", "Silbermedaille", { mode: "rank", rank: 2 }, ["team", "players"]);
const BRONZE = item("bronze", "medal", "Bronzemedaille", { mode: "rank", rank: 3 }, ["team", "players"]);
const BANNER = item("banner", "banner", "Season-Banner", { mode: "all" }, ["players"]);
const TITLE = item("title", "title", "Kämpferherz", { mode: "range", from: 4, to: 6 }, ["team"]);

const REWARDS = {
  season: { id: "s1", name: "Season 1", status: "active" }, can_edit: true, reward_players: "fielded",
  player_basis: { fielded: "Spieler mit Einsatz", roster: "Ganzer Kader zum Abschluss" }, kinds: {},
  items: [GOLD, SILVER, BRONZE, BANNER, TITLE],
  divisions: [
    { id: "d1", level: 1, label: "Liga 1", own: false, items: [GOLD, SILVER, BRONZE, BANNER, TITLE], staffeln: [
      { tournament_id: "t1", staffel: "A", closed: true, version: 2, awards: 9, teams: 4, players: 14, suspended: false, roster_fallback: [TEAMS[2]] },
      { tournament_id: "t2", staffel: "B", closed: false, version: null, awards: 0, teams: 0, players: 0, suspended: false }] },
    { id: "d2", level: 2, label: "Liga 2", own: true, items: [item("aufstieg", "emblem", "Aufsteiger-Emblem", { mode: "rank", rank: 1 }, ["team"])], staffeln: [] },
  ],
};

const CALENDAR = { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 5, end_date: "2027-01-18T22:59:59+00:00" };
const SCORING = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff"], head_to_head_criteria: ["points"], allow_draws: false,
  forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON_PAGE = {
  capabilities: ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules"],
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" },
  season: { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4,
    game_mode_order: [], scoring_rules: SCORING, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "public", status: "active", blocked_periods: [] },
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [{ id: "d1", level: 1, overrides: {}, label: "Liga 1", calendar: CALENDAR, settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: SCORING },
    staffeln: [{ tournament_id: "t1", staffel: "A", status: "completed", participant_count: 4, max_participants: 8 }] }],
};

const art = (place, metal, division = "Liga 1") => ({ league: "Probe-Liga", season: "Season 1", division, place, metal });
const award = (id, reward, extra = {}) => ({ id, kind: reward.kind, rank: 1, rank_label: reward.art.place, participants: 4, matches: { played: 3, won: 3 }, record: "3 Siege · 0 Niederlagen",
  tournament: { id: "t1", slug: "probe-a", title: "Probe-Liga · Season 1" }, game: { name: "Probe Shooter" }, season: { id: "s1", name: "Season 1" },
  team: { id: "team-1", name: "Nordlicht" }, league: { title: reward.name, season_id: "s1", division_label: reward.art.division, staffel: "A", display_name: TEAMS[0] },
  image_url: null, date: "2026-11-09", updated_at: "2027-01-12T19:30:00+00:00", reward: { kind_label: { medal: "Medaille", banner: "Banner", emblem: "Emblem", title: "Titel" }[reward.kind],
    description: "", place_label: reward.art.place, recipients_label: "Team und Spieler mit Einsatz", image_url: null, prize: null, id: id, ...reward }, ...extra });
const MY_GOLD = award("w-gold", { kind: "medal", name: "Goldmedaille", art: art("1. Platz", "gold") });
const MY_BANNER = award("w-banner", { kind: "banner", name: "Season-Banner", art: art("Alle Teilnehmer", "lion") });
const MY_TITLE = award("w-title", { kind: "title", name: "Kämpferherz", art: { ...art("4. Platz", "lion", "Liga 2"), season: "Season 0" } },
  { updated_at: "2026-06-01T10:00:00+00:00", league: { title: "Kämpferherz", season_id: "s0", division_label: "Liga 2", staffel: "B", display_name: TEAMS[0] } });
const PROFILE = { id: "p1", username: "neonfalke", display_name: "NeonFalke", role: "player", country: "AT", created_at: "2025-03-01T10:00:00+00:00", stats: {}, teams: [],
  tournaments: [], awards: [MY_GOLD, MY_BANNER, MY_TITLE], featured_award: MY_GOLD, featured_title: MY_TITLE, league_history: [], achievement_level: { level: 7, progress: 40 },
  privacy_public_profile: true };

const row = (index, rank, won, lost) => ({ registration_id: `r${index}`, display_name: TEAMS[index - 1], team_id: `team-${index}`, rank, played: won + lost, won, drawn: 0, lost,
  score_for: won * 2, score_against: lost * 2, score_diff: (won - lost) * 2, points: won * 3, form: [], previous_rank: null, forfeit_won: 0, forfeit_lost: 0,
  deducted_points: 0, exit: null, tiebreak: null, lead_decision: null, contested: 0 });
const ROWS = [row(1, 1, 3, 0), row(2, 2, 2, 1), row(3, 3, 1, 2), row(4, 4, 0, 3)];
const holders = (...indexes) => indexes.map((index) => ({ registration_id: `r${index}`, display_name: TEAMS[index - 1], rank: index }));
const LEAGUES = { leagues: [{ id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" },
  seasons: [{ id: "s1", slug: "season-1", name: "Season 1", status: "completed", start_date: "2026-11-09T23:00:00+00:00" }] }] };
const PUBLIC_SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { name: "Season 1", slug: "season-1", status: "completed", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 0, loss: 0 }, blocked_periods: [] },
  map_pool: null, rewards: [GOLD, SILVER, BRONZE, BANNER, TITLE],
  divisions: [{ id: "d1", level: 1, label: "Liga 1", rewards: null, staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A", status: "completed" }] }],
};
const PUBLIC_STAFFEL = {
  staffel: { tournament_id: "t1", staffel: "A", division_label: "Liga 1", division_level: 1, status: "completed", table_rules: { allow_draws: false, tiebreakers: ["head_to_head"] },
    final: { version: 2, closed_at: "2027-01-12T19:30:00+00:00", champion: { registration_id: "r1", display_name: TEAMS[0], team_id: "team-1" }, decisions: [], rules_label: null },
    rewards: { granted: true, items: [{ ...GOLD, holders: holders(1) }, { ...SILVER, holders: holders(2) }, { ...BRONZE, holders: holders(3) },
      { ...TITLE, holders: holders(4) }, { ...BANNER, holders: holders(1, 2, 3, 4) }] } },
  standings: ROWS, current: 3, teams: ROWS.map((entry) => ({ id: entry.registration_id, display_name: entry.display_name, team_id: entry.team_id, logo_url: null })), weeks: [],
};

async function mockServer(page, { user = null, unseen = [] } = {}) {
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "streams/live"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (user) await page.route("**/api/auth/me", json(user));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/me/rewards/unseen", json({ rewards: unseen }));
  await page.route("**/api/leagues", json(LEAGUES));
  await page.route("**/api/leagues/probe-liga/season-1", json(PUBLIC_SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(PUBLIC_STAFFEL));
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
  await page.route("**/api/admin/leagues/seasons/s1/rewards", json(REWARDS));
  await page.route("**/api/users/public/neonfalke**", json(PROFILE));
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

test.describe("Liga: Belohnungen", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Season-Verwaltung „Belohnungen“ bei ${width} px: zusammenstellen, Liga N, Stand der Vergabe, speichern`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page, { user: ADMIN });
      let sent = null;
      await page.route("**/api/admin/leagues/seasons/s1/rewards", (route) => {
        if (route.request().method() === "PUT") {
          sent = route.request().postDataJSON();
          return json(REWARDS)(route);
        }
        return json(REWARDS)(route);
      });
      await page.goto("/admin/leagues/seasons/s1#belohnungen");
      await expect(page.getByTestId("season-tab-belohnungen")).toHaveAttribute("aria-selected", "true");
      const panel = page.getByTestId("season-rewards");
      await expect(panel.getByTestId("season-rewards-items-name-0")).toHaveValue("Goldmedaille");
      await expect(panel.getByTestId("season-rewards-items-preview-0")).toHaveAttribute("data-metal", "gold");
      await expect(panel.getByTestId("season-rewards-basis-fielded")).toBeChecked();
      await expect(panel.getByTestId("season-rewards-inherit-d1")).toContainText("Goldmedaille (1. Platz)");
      await expect(panel.getByTestId("season-rewards-division-items-d2-name-0")).toHaveValue("Aufsteiger-Emblem");
      await expect(panel.getByTestId("rewards-staffel-t1")).toContainText("9 vergeben · 4 Teams · 14 Spieler · Fassung 2");
      await expect(panel.getByTestId("rewards-fallback-t1")).toHaveText(`Kader statt Einsatz, weil keine Aufstellungen gemeldet: ${TEAMS[2]}.`);
      await noSideScroll(page);
      // Die Speicherleiste klebt unten - im Bild steht sie am Ende statt mitten über den Zeilen.
      if (width === 1440) await shot(panel, "f4-belohnungen-verwaltung-1440", "[data-testid=season-rewards-bar] { position: static !important; }");

      await panel.getByTestId("season-rewards-basis-roster").check();
      await panel.getByTestId("season-rewards-items-name-4").fill("Kämpferherz der Liga");
      await panel.getByTestId("season-rewards-save").click();
      await expect.poll(() => sent?.reward_players).toBe("roster");
      expect(sent.items[4]).toMatchObject({ id: "title", name: "Kämpferherz der Liga", places: { mode: "range", from: 4, to: 6 }, recipients: ["team"] });
      expect(sent.divisions).toEqual({ d1: null, d2: [expect.objectContaining({ id: "aufstieg", name: "Aufsteiger-Emblem" })] });
    });

    test(`Profil bei ${width} px: Sammlung nach Season, Titel neben dem Namen, Banner im Kopf`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/u/neonfalke?tab=awards");
      const collection = page.getByTestId("profile-reward-collection");
      await expect(collection).toBeVisible();
      await expect(collection.getByTestId("profile-reward-collection-season").first()).toContainText("Season 1");
      await expect(collection.getByTestId("profile-reward-collection-season").nth(1)).toContainText("Season 0");
      await expect(collection.getByTestId("reward-card-w-gold")).toContainText("1. Platz · Liga 1 · Staffel A");
      await expect(collection.getByTestId("reward-art-w-gold")).toHaveAttribute("data-metal", "gold");
      await expect(page.getByTestId("profile-featured-title")).toContainText("Kämpferherz");
      await expect(page.getByTestId("profile-featured-award")).toContainText("Goldmedaille");
      // Nur Belohnungen: kein leeres Raster für Turnier-Auszeichnungen und kein „Noch keine Auszeichnungen“.
      await expect(page.getByTestId("profile-award-banners")).toHaveCount(0);
      await expect(page.getByTestId("public-profile-awards")).not.toContainText("Noch keine Auszeichnungen");
      await noSideScroll(page);
      if (width === 390) await shot(collection, "f4-profil-sammlung-390");
    });

    test(`Ligaseite bei ${width} px: Podest mit Belohnung je Platz und „alle Teilnehmer“`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/liga/probe-liga/season-1");
      const rewards = page.getByTestId("league-rewards-A");
      await expect(rewards).toHaveAttribute("data-granted", "true");
      await expect(rewards.getByTestId("podium")).toBeVisible();
      await expect(rewards.getByTestId("podium-place-1")).toContainText(TEAMS[0]);
      await expect(rewards.getByTestId("league-rewards-A-place-1")).toContainText("Goldmedaille");
      await expect(rewards.getByTestId("league-rewards-A-place-3")).toContainText("Bronzemedaille");
      await expect(rewards.getByTestId("league-rewards-A-other-title")).toContainText(TEAMS[3]);
      await expect(rewards.getByTestId("league-rewards-A-everyone")).toHaveText("Alle Teilnehmer bekommen: Season-Banner.");
      await noSideScroll(page);
    });

    test(`Zeremonie bei ${width} px: neue Belohnungen nach dem Abschluss, gesehen erst nach dem Schließen`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { user: PLAYER, unseen: [MY_GOLD, MY_BANNER] });
      const seen = [];
      await page.route("**/api/me/rewards/seen", (route) => {
        seen.push(route.request().postDataJSON());
        return json({ ok: true, seen: 2 })(route);
      });
      await page.goto("/liga/probe-liga/season-1");
      const moment = page.getByTestId("reward-moment");
      await expect(moment).toBeVisible();
      await expect(moment).toContainText("2 neue Belohnungen");
      await expect(moment).toContainText("Goldmedaille · Season-Banner");
      await expect(moment.getByTestId("reward-moment-art-w-gold")).toHaveAttribute("data-play", "run");
      await expect(moment.getByTestId("reward-moment-collection")).toBeVisible();
      await noSideScroll(page);
      // Erst wenn die Bewegung durch ist, das Bild - Anheben, Glanz und Aufleuchten sind dann fertig.
      await page.waitForTimeout(2600);
      if (width === 1440) await shot(page, "f4-zeremonie-1440");
      expect(seen).toEqual([]);
      await moment.getByTestId("reward-moment-close").click();
      await expect(moment).toBeHidden();
      await expect.poll(() => seen).toEqual([{ ids: ["w-gold", "w-banner"] }]);
    });

    test(`Zeremonie bei ${width} px mit „Bewegung reduzieren“: steht still`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page, { user: PLAYER, unseen: [MY_GOLD] });
      await page.goto("/liga/probe-liga/season-1");
      const moment = page.getByTestId("reward-moment");
      await expect(moment).toHaveAttribute("data-reduced", "true");
      await expect(moment.getByTestId("reward-moment-art-w-gold")).not.toHaveAttribute("data-play", "run");
      await expect(moment).toContainText("Neue Belohnung");
    });
  }
});
