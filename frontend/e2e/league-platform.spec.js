const { test, expect } = require("@playwright/test");

// Plattform je Season (docs/LIGA.md, B.3, #2270) bei 390 und 1440 px, Server nachgestellt, nur erfundene Namen: Kasten auf der
// Season-Seite, Abweichung im Liga-N-Blatt und die Prüfung der Anmeldung. Kein seitliches Scrollen.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player", consent_required: false };
const WIDTHS = [[390, 844], [1440, 900]];

const FIELD = { key: "platform", label: "Plattform", options: ["PC", "PlayStation", "Xbox Series mit langem Namen"], retired: [], required: true };
const PLATFORM = {
  settings: { platform_field: null, allowed_platforms: [], crossplay: null, input_device: null },
  fields: [FIELD], field_missing: false, input_devices: [], game: { id: "g1", name: "Probe Shooter" },
  divisions: [
    { id: "d1", label: "Liga 1", status: "active", overrides: {}, effective: { allowed: [], crossplay: null, input_device: null } },
    { id: "d2", label: "Liga 2 · Offen für alle mit langem Beinamen", status: "active", overrides: { allowed_platforms: [] }, effective: { allowed: [], crossplay: true, input_device: "both" } },
  ],
};
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2036-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
  default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 3, game_mode_order: [],
  scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] }, result_confirm_hours: 48, lineup_amend_hours: 48,
  visibility: "admins", status: "draft", blocked_periods: [],
};
const DIVISION = { id: "d1", level: 1, nickname: null, status: "active", label: "Liga 1", overrides: {}, settings: { best_of: 3, team_size: 4, min_squad_size: 3, max_staffel_size: 8 },
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8 }, staffeln: [] };
const SEASON_PAGE = {
  capabilities: ["manage", "season", "roster", "applications"], league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, season: SEASON,
  game: { id: "g1", name: "Probe Shooter", modes: [] }, look: {}, library: [], map_pool: null, divisions: [DIVISION],
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 8, rounds_needed: 7 },
};
const SQUAD = { squad_id: "sq1", squad_name: "Rudel Alpha", team_id: "t1", team_name: "Loewen", display_name: "Loewen · Rudel Alpha", member_count: 4, can_apply: true, state: "open",
  application: null, problems: ["Rudel Alpha: Nur 3 Spieler sind spielberechtigt, die Season verlangt mindestens 4. Fehlende Spiel-IDs tragen die Spieler im eigenen Profil ein."],
  warnings: ["Tom Beispiel: Diese Season ist nur für PC – angegeben ist PlayStation."], can_submit: false };
const MINE = {
  application: { state: "open", slots: 8, slots_free: 3, waitlist: false }, season_problems: [], hint: null, squads: [SQUAD],
  platform: { field_label: "Plattform", allowed: ["PC"], crossplay: false, input_device: "controller", divisions: [
    { id: "d1", label: "Liga 1", allowed: ["PC"], crossplay: false, input_device: "controller", differs: false },
    { id: "d2", label: "Liga 2 · Offen für alle mit langem Beinamen", allowed: [], crossplay: true, input_device: "controller", differs: true },
  ] },
  rules: { version_id: "v1", version: 1, label: "Version 1", title: "Regelwerk", valid_from: "2026-11-01", url: "/liga/probe-liga/season-1/regeln", pdf_url: "/api/x/pdf" },
  privacy: { text: "Hinweis", url: "/privacy" },
};

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function mock(page, user, routes) {
  await page.addInitScript(CONSENT);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/changes")) return route.abort();
    if (path === "/auth/me") return json(user);
    const answer = await routes(path, request);
    if (answer !== undefined) return json(answer);
    if (request.method() !== "GET") return json({ ok: true });
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active", "/friends"];
    return json(objects.includes(path) ? {} : []);
  });
}

for (const [width, height] of WIDTHS) {
  test.describe(`Plattform je Season bei ${width} px`, () => {
    test.use({ viewport: { width, height } });

    test("Verwaltung: Feld wählen, nur PC, Crossplay aus; Liga N weicht im Blatt ab", async ({ page }) => {
      let saved = null;
      let division = null;
      await mock(page, ADMIN, (path, request) => {
        if (path === "/admin/leagues/seasons/s1") return SEASON_PAGE;
        if (path === "/admin/leagues/seasons/s1/platform" && request.method() === "PUT") {
          saved = request.postDataJSON();
          return { ...PLATFORM, settings: saved };
        }
        if (path === "/admin/leagues/seasons/s1/platform") return saved ? { ...PLATFORM, settings: saved } : PLATFORM;
        if (path === "/admin/leagues/divisions/d1" && request.method() === "PATCH") {
          division = request.postDataJSON();
          return { ...DIVISION, ...division, warnings: [] };
        }
        return undefined;
      });
      await page.goto("/admin/leagues/seasons/s1");

      const box = page.getByTestId("season-platform");
      await expect(box).toContainText("Plattform und Eingabegerät");
      await page.getByTestId("season-platform-field").selectOption("platform");
      await page.getByTestId("season-platform-allowed-PC").check();
      await expect(page.getByTestId("season-platform-allowed-hint")).toContainText("nicht spielberechtigt");
      await page.getByTestId("season-platform-crossplay").selectOption("off");
      await expect(page.getByTestId("season-platform-division-d2")).toContainText("weicht ab");
      await noSideScroll(page);
      await page.getByTestId("season-platform-save").click();
      await expect.poll(() => saved).toEqual({ platform_field: "platform", allowed_platforms: ["PC"], crossplay: false, input_device: null });

      await page.getByTestId("division-edit-1").click();
      const sheet = page.getByTestId("division-sheet");
      await expect(sheet.getByTestId("division-platform-season")).toContainText("Season: nur PC · Crossplay aus");
      await sheet.getByTestId("override-platform-own").check();
      await sheet.getByTestId("override-platforms-PlayStation").check();
      await sheet.getByTestId("override-input").selectOption("controller");
      await noSideScroll(page);
      await sheet.getByTestId("division-save").click();
      await expect.poll(() => division?.overrides).toEqual({ allowed_platforms: ["PlayStation"], input_device: "controller" });
    });

    test("Anmeldung: Prüfung nennt die Plattform und den Spieler mit anderer Plattform", async ({ page }) => {
      await mock(page, CAPTAIN, (path) => {
        if (path === "/leagues/probe-liga/season-1/application") return MINE;
        if (path === "/leagues/probe-liga/season-1") {
          return { league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } }, season: { id: "s1", name: "Season 1", slug: "season-1" },
            look: {}, prizes: [], map_pool: null, divisions: [], rules: null, application: MINE.application, platform: MINE.platform };
        }
        return undefined;
      });
      await page.goto("/liga/probe-liga/season-1/anmelden");

      await page.getByTestId("apply-next").click();
      const note = page.getByTestId("apply-platform");
      await expect(note).toContainText("Plattform: nur PC.");
      await expect(note).toContainText("Eingabegerät: Controller.");
      await expect(note).toContainText("Liga 2 · Offen für alle mit langem Beinamen: alle Plattformen · Crossplay an · Controller");
      await expect(page.getByTestId("apply-problems")).toContainText("Nur 3 Spieler sind spielberechtigt");
      await expect(page.getByTestId("apply-warnings")).toContainText("Diese Season ist nur für PC – angegeben ist PlayStation.");
      await expect(page.getByTestId("apply-next")).toBeDisabled();
      await noSideScroll(page);
    });
  });
}
