const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Saisonfinale am TV (#1641) und Liga im Discord (#1642) in der Verwaltung der Season, Server nachgestellt: der Kasten „Saisonfinale am
// TV“ im Reiter „Abschluss“ (Weiter aus einem veralteten Fenster: 409, der Stand wird neu geladen) und der Kasten „Discord“ im Reiter
// „Termine“ (Kanal nur aus den freigegebenen Kanälen je Zweck, Nr. 234; Hinweise zu unklaren und aufgegebenen Meldungen, je Hinweis
// „Noch einmal senden“ nach der Bestätigung, Nr. 239). Bei 390 und
// 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab. Nur erfundene Namen, kein Discord.

const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const CALENDAR = { weeks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false })),
  blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 5, end_date: "2027-01-18T22:59:59+00:00" };
const SCORING = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff"], head_to_head_criteria: ["points"],
  allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON_PAGE = {
  capabilities: ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules"],
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" },
  season: { id: "s1", league_id: "l1", number: 3, name: "Season 3", slug: "season-3", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4,
    game_mode_order: [], scoring_rules: SCORING, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "public", status: "completed", blocked_periods: [] },
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [1, 2, 3].map((level) => ({ id: `d${level}`, level, overrides: {}, label: `Liga ${level}`, calendar: CALENDAR,
    settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: SCORING },
    staffeln: [{ tournament_id: `t${level}`, staffel: "A", status: "completed", participant_count: 4, max_participants: 8 }] })),
};
const CLOSING = { season: { id: "s1", name: "Season 3", status: "completed", closed: true }, can_act: true, superadmin: false, responsible: "„Season konfigurieren“",
  methods: { playoff: "Entscheidungsspiel", lot: "Los", lead: "Entscheid der Leitung" }, staffeln: [] };
const TV = { step: 0, count: 3, labels: ["Liga 1", "Liga 2 · Aufbau", "Liga 3"], closed: 3, reason: null };
const DEFAULTS = { matchday: false, season_end: false, channel_id: "", wait_hours: 48, late: true, table_rows: 5 };
const DISCORD = {
  settings: { ...DEFAULTS, matchday: true, season_end: true, channel_id: "100000000000000042" }, active: true, defaults: DEFAULTS, public: true,
  channel_approved: true, channels_ok: true, channels_text: null,
  channels: [
    { id: "100000000000000042", purpose: "Events und Turniere", name: "liga-ergebnisse", category: "Liga", can_send: true },
    { id: "100000000000000043", purpose: "Community", name: "allgemein", category: "Treffpunkt", can_send: true },
  ],
  problems: [
    { key: "season_end:s1", kind: "season_end", label: "Saisonende", status: "unclear", at: "2026-11-23T19:00:00+00:00",
      text: "Ob die Meldung ankam, ist unklar. Bitte im Kanal nachsehen - fehlt sie dort, gibst du sie mit „Noch einmal senden“ frei." },
    { key: "matchday:t2:9", kind: "matchday", label: "Spieltag 9 · Probe-Liga · Season 3 · Liga 2 · Staffel A", status: "failed", at: "2026-11-22T19:00:00+00:00",
      text: "Nach 3 Versuchen nicht gesendet. Der Bot ist nicht verbunden – der Grund steht im Bot-Kasten unter Verbindungen → Discord." },
  ],
};

async function mockServer(page, { tv = TV, discord = DISCORD } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(ADMIN));
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
  await page.route("**/api/admin/leagues/seasons/s1/closing", json(CLOSING));
  const state = { tv: { ...tv }, posts: [] };
  await page.route("**/api/admin/leagues/seasons/s1/tv-finale", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      state.posts.push(body);
      // Ein zweites Fenster hat inzwischen weitergeschaltet: Der Stand ist 1, dieses Fenster zeigt noch 0.
      state.tv = { ...state.tv, step: 1 };
      return route.fulfill({ status: 409, contentType: "application/json",
        body: JSON.stringify({ detail: "Der TV-Schritt wurde inzwischen in einem anderen Fenster weitergeschaltet. Der aktuelle Stand ist geladen." }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(state.tv) });
  });
  await page.route("**/api/admin/leagues/seasons/s1/discord", json(discord));
  state.releases = [];
  await page.route("**/api/admin/leagues/seasons/s1/discord/release", async (route) => {
    const body = route.request().postDataJSON();
    state.releases.push(body);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...discord, problems: discord.problems.filter((row) => row.key !== body.key) }) });
  });
  return state;
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(target, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled", style: ".tls-bottom-nav { display: none !important; }" });
}

test.describe("Liga: Saisonfinale am TV und Discord in der Verwaltung", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Abschluss bei ${width} px: Weiter aus einem veralteten Fenster lädt den Stand neu`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const state = await mockServer(page);
      await page.goto("/admin/leagues/seasons/s1#tv-finale");
      await expect(page.getByTestId("season-tab-abschluss")).toHaveAttribute("aria-selected", "true");
      const box = page.getByTestId("tv-finale-control");
      await expect(box.getByTestId("tv-finale-status")).toHaveText(/gewohnte Bild/);
      await box.getByTestId("tv-finale-next").click();
      await expect(box.getByTestId("tv-finale-stale")).toContainText("anderen Fenster");
      await expect(box.getByTestId("tv-finale-status")).toHaveText(/Der TV zeigt Liga 1 \(1 von 3\)\./);
      expect(state.posts).toEqual([{ action: "next", from_step: 0 }]);
      await expect(box.getByTestId("tv-finale-error")).toHaveCount(0);
      await noSideScroll(page);
      await box.scrollIntoViewIfNeeded();
      await shot(box, `admin-tv-steuerung-${width}`);
    });

    test(`Termine bei ${width} px: Kanal nur aus der freigegebenen Liste, Hinweise zu Meldungen`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/admin/leagues/seasons/s1#discord");
      await expect(page.getByTestId("season-tab-termine")).toHaveAttribute("aria-selected", "true");
      const box = page.getByTestId("season-discord");
      const select = box.getByTestId("season-discord-channel");
      await expect(select).toHaveValue("100000000000000042");
      await expect(select.locator("option")).toHaveText(["– kein Kanal –", "Events und Turniere · Liga › #liga-ergebnisse", "Community · Treffpunkt › #allgemein"]);
      await expect(box.getByTestId("season-discord-channel-id")).toHaveCount(0);
      await expect(box.getByText("Warten auf Ergebnisse (Stunden nach Ende der Spielwoche)")).toBeVisible();
      const problems = box.getByTestId("season-discord-problems");
      await expect(problems).toContainText("Saisonende:");
      await expect(problems).toContainText("im Kanal nachsehen");
      await expect(problems).toContainText("Spieltag 9");
      await noSideScroll(page);
      await box.scrollIntoViewIfNeeded();
      await shot(box, `admin-discord-${width}`);
    });

    test(`Termine bei ${width} px: „Noch einmal senden“ erst nach der Bestätigung, danach ist der Hinweis weg`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const state = await mockServer(page);
      await page.goto("/admin/leagues/seasons/s1#discord");
      const box = page.getByTestId("season-discord");
      await box.getByTestId("season-discord-release-season_end:s1").click();
      const go = box.getByTestId("season-discord-release-go");
      await expect(go).toBeDisabled();
      await box.getByText("Ich habe im Kanal nachgesehen, die Meldung fehlt").click();
      await expect(go).toBeEnabled();
      await noSideScroll(page);
      await box.getByTestId("season-discord-problems").scrollIntoViewIfNeeded();
      await shot(box, `admin-discord-noch-einmal-senden-${width}`);
      await go.click();
      await expect(page.getByText("Freigegeben – die Meldung geht mit dem nächsten Lauf hinaus", { exact: false })).toBeVisible();
      await expect(box.getByTestId("season-discord-problems")).not.toContainText("Saisonende:");
      expect(state.releases).toEqual([{ key: "season_end:s1", confirm: true }]);
    });

    test(`Termine bei ${width} px: ohne freigegebenen Kanal der Weg zu den Kanälen je Zweck`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { discord: { ...DISCORD, channels: [], channel_approved: false, problems: [],
        settings: { ...DISCORD.settings, channel_id: "100000000000000099" } } });
      await page.goto("/admin/leagues/seasons/s1#discord");
      const box = page.getByTestId("season-discord");
      await expect(box.getByTestId("season-discord-no-channels")).toContainText("Kanäle je Zweck");
      await expect(box.getByTestId("season-discord-no-channels").getByRole("link")).toHaveAttribute("href", "/admin/integrations/discord");
      await expect(box.getByTestId("season-discord-not-approved")).toBeVisible();
      await noSideScroll(page);
      await box.scrollIntoViewIfNeeded();
      await shot(box, `admin-discord-ohne-freigabe-${width}`);
    });
  }
});
