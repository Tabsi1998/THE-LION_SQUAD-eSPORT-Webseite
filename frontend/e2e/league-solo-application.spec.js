const nodePath = require("path");
const { test, expect } = require("@playwright/test");

// Anmeldung als Spieler in der Solo-Liga (#1629, P2; docs/LIGA.md „S.2“) bei 390 und 1440 px, Server nachgestellt, feste Uhr, nur erfundene
// Namen: Ligaseite für Gäste und Spieler, die drei Schritte ohne Co-Team, Stand mit Zurückziehen und Warteliste, der Eingang der Leitung
// mit Anträgen von Spielern - und daneben eine Team-Liga, die sich anmeldet wie vorher (Gegenprobe). Kein seitliches Scrollen.
// Bilder: E2E_SHOTS_DIR, sonst die Testausgabe.

function shotPath(testInfo, name) {
  return process.env.E2E_SHOTS_DIR ? nodePath.join(process.env.E2E_SHOTS_DIR, name) : testInfo.outputPath(name);
}

const NOW = new Date("2026-11-28T10:00:00+00:00");
const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const PLAYER_USER = { id: "u1", username: "duellant", display_name: "Duellant Eins", role: "player", consent_required: false };
const CAPTAIN = { id: "u2", username: "mila", display_name: "Mila Mustermann", role: "player", consent_required: false };
const WIDTHS = [[390, 844], [1440, 900]];

const BLOCK = { participant_kind: "solo", state: "open", opens_at: "2026-11-20T17:00:00+00:00", closes_at: "2026-12-20T19:00:00+00:00", slots: 16, slots_free: 5,
  waitlist: true, waitlist_full: false, waitlist_note: "Die Leitung entscheidet nach dem Eingang.", entry_policy: "all" };
const SEASON_VIEW = {
  league: { id: "l1", slug: "duell", name: "Duell-Liga mit einem recht langen Namen", participant_kind: "solo", game: { name: "Probe Duell" } },
  season: { id: "s1", name: "Season 1", slug: "season-1", start_date: "2027-01-10T23:00:00+00:00", end_date: "2027-03-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 1, match_points: { win: 3, draw: 0, loss: 0 }, blocked_periods: [] },
  look: {}, prizes: [], map_pool: null, divisions: [], rules: null, application: BLOCK,
};
const RULES = { version_id: "v1", version: 1, label: "Version 1", title: "Regelwerk der Duell-Liga", valid_from: "2026-11-20", url: "/liga/duell/season-1/regeln",
  pdf_url: "/api/league-rules/seasons/duell/season-1/versions/v1/pdf" };
const PLAYER = { user_id: "u1", display_name: "Duellant Eins", can_apply: true, state: "open", application: null, problems: [],
  warnings: ["Dein Geburtsdatum fehlt im Profil.", "Die Spiel-ID fehlt. Trag sie im Profil unter Gaming ein."], shortfall: null, can_submit: true };
const MINE = {
  kind: "solo", application: BLOCK, season_problems: [], hint: null, squads: [], player: PLAYER, rules: RULES,
  privacy: { text: "Für die Anmeldung speichert der Verein deine Angaben als Spieler. Mehr dazu steht in der Datenschutzerklärung.", url: "/privacy" },
};
const PERSON_ROW = {
  id: "a1", kind: "solo", user_id: "u1", status: "submitted", squad_id: null, team_id: null, display_name: "Duellant Eins", submitted_at: "2026-11-27T18:00:00+00:00",
  applied_by_name: "Duellant Eins", rules_version: 1, rules_at: "2026-11-27T18:00:00+00:00", privacy_at: "2026-11-27T18:00:00+00:00", member_count: 1,
  captain_name: null, vice_name: null, problems: [], warnings: ["Duellant Eins: Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein."], shortfall: null,
  shared_with: [], own_team: false, history: [{ status: "submitted", at: "2026-11-27T18:00:00+00:00", by_name: "Duellant Eins" }],
};
const INBOX = {
  kind: "solo", configured: true, window: "open", superadmin: true, stats: { slots: 16, taken: 11, free: 5, open: 2, waiting: 1, unassigned: 1, full: false },
  divisions: [{ id: "d1", label: "Liga 1", lowest: true, staffeln: [{ tournament_id: "t1", staffel: "A", participant_count: 10, max_participants: 16 }] }],
  items: [
    PERSON_ROW,
    { ...PERSON_ROW, id: "a2", user_id: "u3", display_name: "Duellantin Zwei mit einem sehr langen Anzeigenamen", applied_by_name: "Duellantin Zwei mit einem sehr langen Anzeigenamen", warnings: [] },
    { ...PERSON_ROW, id: "a3", user_id: "admin-1", display_name: "Leitung", applied_by_name: "Leitung", own_team: true, warnings: [] },
    { ...PERSON_ROW, id: "a4", user_id: "u4", status: "waitlist", display_name: "Duellant Vier", warnings: [] },
    { ...PERSON_ROW, id: "a5", user_id: "u5", status: "accepted", display_name: "Duellant Fünf", warnings: [] },
  ],
};
const ADMIN_SEASON = {
  capabilities: ["season", "applications"], league: { id: "l1", name: "Duell-Liga", slug: "duell", participant_kind: "solo" }, game: { id: "g1", name: "Probe Duell", modes: [] },
  calendar: { weeks: [], blocked_weeks: [], active_weeks: 8, max_teams_per_staffel: 16 }, library: [], map_pool: null, look: {}, divisions: [],
  season: { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2027-01-10T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 16, best_of: 3, team_size: 1, min_squad_size: 1, max_squad_size: 1,
    lineup_mode: "series", lineup_min_players: 1, game_mode_order: [], result_confirm_hours: 48, lineup_amend_hours: 48, visibility: "public", status: "draft",
    blocked_periods: [], entry_policy: "all", application_waitlist: true, application_opens_at: "2026-11-20T17:00:00+00:00",
    application_closes_at: "2026-12-20T19:00:00+00:00", application_slots: 16, new_squads_lowest_division: true },
};
// Gegenprobe: eine Team-Liga daneben, ohne die neuen Felder.
const TEAM_BLOCK = { ...BLOCK, participant_kind: undefined };
const TEAM_VIEW = { ...SEASON_VIEW, league: { ...SEASON_VIEW.league, slug: "team-liga", name: "Team-Liga", participant_kind: "team" }, application: TEAM_BLOCK };
const SQUAD = { squad_id: "sq1", squad_name: "Rudel", team_id: "t1", team_name: "Loewen", display_name: "Loewen · Rudel", member_count: 5, can_apply: true, state: "open",
  application: null, problems: [], warnings: [], can_submit: true };

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function mock(page, user, routes) {
  await page.clock.setFixedTime(NOW);
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

function soloRoutes(mine, extra = () => undefined) {
  return (path, request) => {
    const answer = extra(path, request);
    if (answer !== undefined) return answer;
    if (path === "/leagues/duell/season-1") return SEASON_VIEW;
    if (path === "/leagues/duell/season-1/application") return mine;
    return undefined;
  };
}

for (const [width, height] of WIDTHS) {
  test.describe(`Anmeldung als Spieler bei ${width} px`, () => {
    test.use({ viewport: { width, height } });

    test("Gast: Solo-Liga sagt „Anmelden, dann mitspielen“, kein Knopf für Co-Teams", async ({ page }) => {
      await mock(page, null, soloRoutes(MINE));
      await page.goto("/liga/duell/season-1");
      await expect(page.getByTestId("league-application-solo")).toContainText("Du meldest dich selbst als Spieler an");
      await expect(page.getByTestId("league-application-login")).toContainText("Anmelden, dann mitspielen");
      await expect(page.getByTestId("league-application-start")).toHaveCount(0);
      await expect(page.getByTestId("league-application-start-player")).toHaveCount(0);
      await noSideScroll(page);
    });

    test("Spieler: drei Schritte ohne Co-Team bis zum Einreichen", async ({ page }, testInfo) => {
      let body = null;
      await mock(page, PLAYER_USER, soloRoutes(MINE, (path, request) => {
        if (path === "/leagues/duell/season-1/applications" && request.method() === "POST") {
          body = request.postDataJSON();
          return { id: "a1", status: "submitted" };
        }
        return undefined;
      }));
      await page.goto("/liga/duell/season-1");
      await expect(page.getByTestId("league-application-start")).toHaveCount(0);
      await page.getByTestId("league-application").screenshot({ path: shotPath(testInfo, `solo-ligaseite-anmelden-${width}.png`) });
      await page.getByTestId("league-application-start-player").click();
      await expect(page).toHaveURL(/\/anmelden$/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Als Spieler anmelden");
      await expect(page.getByTestId("apply-check-ok")).toContainText("Du kannst dich anmelden.");
      await expect(page.getByTestId("apply-warnings")).toContainText("Dein Geburtsdatum fehlt im Profil.");
      await noSideScroll(page);
      await page.screenshot({ path: shotPath(testInfo, `solo-anmelden-pruefung-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByTestId("apply-next").click();

      await expect(page.getByText("Ich habe die Regeln gelesen und stimme zu.")).toBeVisible();
      await expect(page.getByTestId("apply-privacy-text")).toContainText("deine Angaben als Spieler");
      await expect(page.getByTestId("apply-next")).toBeDisabled();
      await page.getByTestId("apply-accept-rules").check();
      await page.getByTestId("apply-accept-privacy").check();
      await noSideScroll(page);
      await page.screenshot({ path: shotPath(testInfo, `solo-anmelden-zustimmen-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByTestId("apply-next").click();

      await expect(page.getByTestId("apply-summary")).toContainText("Duellant Eins");
      await expect(page.getByTestId("apply-summary")).not.toContainText("Co-Team");
      await noSideScroll(page);
      await page.screenshot({ path: shotPath(testInfo, `solo-anmelden-einreichen-${width}.png`), fullPage: true, animations: "disabled" });
      // Am Handy liegen sonner-Hinweise über Knöpfen - per Tastatur auslösen.
      await page.getByTestId("apply-submit").focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/season-1$/);
      expect(body).toEqual({ rule_version_id: "v1", accept_rules: true, accept_privacy: true });
    });

    test("Spieler: eingereicht mit offenen Punkten, zurückziehen", async ({ page }, testInfo) => {
      let withdrawn = false;
      const submittedView = { ...MINE, player: { ...PLAYER, state: "submitted", can_submit: false,
        application: { id: "a1", status: "submitted", submitted_at: "2026-11-27T18:00:00+00:00", can_withdraw: true, staffel: null } } };
      await mock(page, PLAYER_USER, soloRoutes(submittedView, (path, request) => {
        if (path === "/leagues/duell/season-1/applications/a1/withdraw" && request.method() === "POST") {
          withdrawn = true;
          return { id: "a1", status: "withdrawn" };
        }
        return undefined;
      }));
      await page.goto("/liga/duell/season-1");
      await expect(page.getByTestId("league-application-player-state")).toHaveText("Eingereicht");
      await expect(page.getByTestId("league-application-player")).toContainText("Die Liga-Leitung prüft deine Anmeldung");
      await expect(page.getByTestId("league-application-player-open")).toContainText("Dein Geburtsdatum fehlt im Profil.");
      await expect(page.getByTestId("league-application-start-player")).toHaveCount(0);
      await noSideScroll(page);
      await page.getByTestId("league-application").screenshot({ path: shotPath(testInfo, `solo-ligaseite-eingereicht-${width}.png`) });
      await page.getByTestId("league-application-player-withdraw").click();
      const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      await expect(dialog).toContainText("Du bist dann nicht mehr angemeldet");
      await dialog.getByRole("button", { name: "Zurückziehen" }).click();
      await expect.poll(() => withdrawn).toBe(true);
    });

    test("Spieler: Warteliste und was dagegen spricht", async ({ page }, testInfo) => {
      const waiting = { ...MINE, player: { ...PLAYER, state: "waitlist", warnings: [], can_submit: false,
        application: { id: "a1", status: "waitlist", can_withdraw: true, staffel: null, decision_reason: "Alle Plätze sind vergeben, du rückst nach dem Eingang nach." } } };
      await mock(page, PLAYER_USER, soloRoutes(waiting));
      await page.goto("/liga/duell/season-1");
      await expect(page.getByTestId("league-application-player-state")).toHaveText("Warteliste");
      await expect(page.getByTestId("league-application-player")).toContainText("Es rückt niemand von selbst nach.");
      await expect(page.getByTestId("league-application-player")).toContainText("Grund: Alle Plätze sind vergeben");
      await noSideScroll(page);
      await page.getByTestId("league-application").screenshot({ path: shotPath(testInfo, `solo-ligaseite-warteliste-${width}.png`) });

      await page.unrouteAll({ behavior: "ignoreErrors" });
      const blocked = { ...MINE, application: { ...BLOCK, entry_policy: "members" }, player: { ...PLAYER, warnings: [], can_submit: false,
        problems: ["Diese Season ist nur für Mitglieder. Du bist kein Vereinsmitglied."] } };
      await mock(page, PLAYER_USER, soloRoutes(blocked));
      await page.goto("/liga/duell/season-1");
      await expect(page.getByTestId("league-application-season-problems")).toContainText("Du bist kein Vereinsmitglied.");
      await expect(page.getByTestId("league-application-start-player")).toHaveCount(0);
      await noSideScroll(page);
    });

    test("Leitung: Eingang mit Anträgen von Spielern, annehmen mit Staffel, eigene Anmeldung", async ({ page }, testInfo) => {
      let accepted = null;
      await mock(page, ADMIN, (path, request) => {
        if (path === "/admin/leagues/seasons/s1") return ADMIN_SEASON;
        if (path === "/admin/leagues/seasons/s1/applications") return INBOX;
        if (path === "/admin/leagues/seasons/s1/applications/a1/accept" && request.method() === "POST") {
          accepted = request.postDataJSON();
          return { id: "a1", status: "accepted" };
        }
        return undefined;
      });
      await page.goto("/admin/leagues/seasons/s1#anmeldungen");
      await expect(page.getByTestId("season-tab-anmeldung")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("season-applications")).toContainText("Was Spieler eingereicht haben.");
      await expect(page.getByTestId("application-a1")).toContainText("meldet sich selbst als Spieler an");
      await expect(page.getByTestId("application-a1")).not.toContainText("Captain");
      await expect(page.getByTestId("application-open-points-a1")).toContainText("der Spieler nicht einchecken");
      await expect(page.getByTestId("application-own-team-a3")).toHaveText("Über deine eigene Anmeldung entscheidet eine andere Person.");
      await expect(page.getByTestId("season-form-sibling-squads")).toHaveCount(0);
      await expect(page.getByTestId("season-solo-entry-follows")).toContainText("Startrechte, Auslosen auf mehrere Staffeln");
      await noSideScroll(page);
      await page.getByTestId("season-applications").screenshot({ path: shotPath(testInfo, `solo-eingang-${width}.png`) });
      await page.getByTestId("application-staffel-a1").selectOption("t1");
      await page.getByTestId("application-accept-a1").click();
      await expect.poll(() => accepted).toEqual({ tournament_id: "t1" });
      await page.getByTestId("season-application-settings").screenshot({ path: shotPath(testInfo, `solo-selbstanmeldung-einstellungen-${width}.png`) });
    });

    test("Gegenprobe: die Team-Liga meldet ein Co-Team an wie vorher", async ({ page }) => {
      let body = null;
      await mock(page, CAPTAIN, (path, request) => {
        if (path === "/leagues/team-liga/season-1") return TEAM_VIEW;
        if (path === "/leagues/team-liga/season-1/application") return { ...MINE, kind: undefined, player: undefined, application: TEAM_BLOCK, squads: [SQUAD],
          privacy: { text: "Für die Anmeldung speichert der Verein die Angaben deines Co-Teams.", url: "/privacy" } };
        if (path === "/leagues/team-liga/season-1/applications" && request.method() === "POST") {
          body = request.postDataJSON();
          return { id: "a9", status: "submitted" };
        }
        return undefined;
      });
      await page.goto("/liga/team-liga/season-1");
      await expect(page.getByTestId("league-application-solo")).toHaveCount(0);
      await expect(page.getByTestId("league-application-start-player")).toHaveCount(0);
      await page.getByTestId("league-application-start").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Mit Co-Team anmelden");
      await page.getByTestId("apply-squad-sq1").check();
      await page.getByTestId("apply-next").click();
      await page.getByTestId("apply-next").click();
      await expect(page.getByText("Ich habe die Regeln gelesen und stimme für mein Co-Team zu.")).toBeVisible();
      await page.getByTestId("apply-accept-rules").check();
      await page.getByTestId("apply-accept-privacy").check();
      await page.getByTestId("apply-next").click();
      await page.getByTestId("apply-submit").focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/season-1$/);
      expect(body).toEqual({ squad_id: "sq1", rule_version_id: "v1", accept_rules: true, accept_privacy: true });
      await noSideScroll(page);
    });
  });
}
