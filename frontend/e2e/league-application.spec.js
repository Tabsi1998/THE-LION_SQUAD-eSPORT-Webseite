const { test, expect } = require("@playwright/test");

// Selbstanmeldung mit Co-Team (docs/LIGA.md, B.4, #2205) bei 390 und 1440 px, Server nachgestellt, nur erfundene Namen: Ligaseite für Gäste und Captains, die vier Schritte,
// die Team-Seite und der Eingang der Leitung. Kein seitliches Scrollen.

const CONSENT = () => window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
  saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
}));
const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const CAPTAIN = { id: "u1", username: "mila", display_name: "Mila Mustermann", role: "player", consent_required: false };
const WIDTHS = [[390, 844], [1440, 900]];

const BLOCK = { state: "open", opens_at: "2026-11-01T17:00:00+00:00", closes_at: "2036-11-20T19:00:00+00:00", slots: 8, slots_free: 3, waitlist: true, waitlist_full: false, waitlist_note: "Die Leitung entscheidet nach dem Eingang und nach der Stärke der Kader, mit einem recht langen Satz für das Handy.", entry_policy: "all" };
const SEASON_VIEW = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga mit langem Namen", game: { name: "Probe Shooter" } },
  season: { id: "s1", name: "Season 1", slug: "season-1", start_date: "2036-11-09T23:00:00+00:00", end_date: "2037-01-18T22:59:59+00:00", matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 1, loss: 0 }, blocked_periods: [], registration_deadline: "2036-11-06" },
  look: {}, prizes: [], map_pool: null, divisions: [], rules: null, application: BLOCK,
};
const SQUAD = { squad_id: "sq1", squad_name: "Rudel Alpha", team_id: "t1", team_name: "Loewen Langername", display_name: "Loewen Langername · Rudel Alpha mit sehr langem Namen", member_count: 5, can_apply: true, state: "open", application: null, problems: [], warnings: ["Tom Beispiel: Die Spiel-ID fehlt im Profil."], can_submit: true };
const BLOCKED = { ...SQUAD, squad_id: "sq2", squad_name: "Horde", display_name: "Loewen Langername · Horde", problems: ["Horde hat 2 Spieler im Kader – die Liga verlangt mindestens 4."], warnings: [], can_submit: false };
const MINE = {
  application: BLOCK, season_problems: [], hint: null, squads: [SQUAD, BLOCKED],
  rules: { version_id: "v1", version: 2, label: "Version 2", title: "Regelwerk der Probe-Liga", valid_from: "2026-11-01", url: "/liga/probe-liga/season-1/regeln", pdf_url: "/api/league-rules/seasons/probe-liga/season-1/versions/v1/pdf" },
  privacy: { text: "Für die Anmeldung speichert der Verein die Angaben deines Co-Teams.", url: "/privacy" },
};
const ROW = {
  id: "a1", status: "submitted", squad_id: "sq1", team_id: "t1", display_name: "Loewen Langername · Rudel Alpha mit sehr langem Namen", submitted_at: "2026-11-02T18:00:00+00:00", applied_by_name: "Mila Mustermann", rules_version: 2, rules_at: "2026-11-02T18:00:00+00:00",
  // Seit #2313 offene Punkte statt Sperre: Die Leitung lässt trotzdem zu.
  privacy_at: "2026-11-02T18:00:00+00:00", member_count: 5, captain_name: "Mila Mustermann", vice_name: "Tom Beispiel", problems: [],
  shortfall: "Nur 3 von 5 Spielern sind spielberechtigt, die Season verlangt mindestens 4. Bis zum ersten Spiel im Profil nachtragen – sonst kann das Team nicht einchecken.",
  warnings: ["Ida: Die Spiel-ID fehlt im Profil.", "Tom Beispiel: Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein."], shared_with: [], own_team: false,
  history: [{ status: "submitted", at: "2026-11-02T18:00:00+00:00", by_name: "Mila Mustermann" }, { status: "in_review", at: "2026-11-02T19:00:00+00:00", by_name: "Leitung" }],
};
const INBOX = {
  configured: true, window: "open", stats: { slots: 8, taken: 5, free: 3, open: 1, waiting: 1, unassigned: 1, full: false },
  divisions: [{ id: "d1", label: "Liga 1", staffeln: [{ tournament_id: "t1", staffel: "A", participant_count: 7, max_participants: 8 }] }],
  items: [ROW, { ...ROW, id: "a2", status: "waitlist", problems: [] }, { ...ROW, id: "a3", status: "accepted", problems: [] }, { ...ROW, id: "a4", status: "accepted", problems: [], assignment: { tournament_id: "t1", label: "Liga 1 · Staffel A" } }, { ...ROW, id: "a5", status: "rejected", decision_reason: "Kader zu klein", problems: [] }],
};
const ADMIN_SEASON = {
  capabilities: ["season", "applications"], league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, game: { id: "g1", name: "Probe Shooter", modes: [] }, calendar: { weeks: [], blocked_weeks: [], active_weeks: 8, max_teams_per_staffel: 8 }, library: [], map_pool: null, look: {}, divisions: [],
  season: { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2036-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 3, game_mode_order: [], result_confirm_hours: 48, lineup_amend_hours: 48, visibility: "public", status: "draft", blocked_periods: [], entry_policy: "all", application_waitlist: true, application_opens_at: "2026-11-01T17:00:00+00:00", application_closes_at: "2036-11-20T19:00:00+00:00", application_slots: 8 },
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

function seasonRoutes(mine) {
  return (path) => {
    if (path === "/leagues/probe-liga/season-1") return SEASON_VIEW;
    if (path === "/leagues/probe-liga/season-1/application") return mine;
    return undefined;
  };
}

for (const [width, height] of WIDTHS) {
  test.describe(`Selbstanmeldung bei ${width} px`, () => {
    test.use({ viewport: { width, height } });

    test("Gast: Fenster und Plätze, Weg zum Einloggen, kein Meldeschluss doppelt", async ({ page }) => {
      await mock(page, null, seasonRoutes(MINE));
      await page.goto("/liga/probe-liga/season-1");
      await expect(page.getByTestId("league-application-seats")).toHaveText("3 von 8 Startplätzen frei");
      await expect(page.getByTestId("league-application-login")).toBeVisible();
      await expect(page.getByTestId("league-application-start")).toHaveCount(0);
      await expect(page.getByTestId("league-subline")).toHaveCount(0);
      await noSideScroll(page);
    });

    test("Captain: vier Schritte bis zum Einreichen", async ({ page }) => {
      let body = null;
      await mock(page, CAPTAIN, (path, request) => {
        if (path === "/leagues/probe-liga/season-1/applications" && request.method() === "POST") {
          body = request.postDataJSON();
          return { id: "a1", status: "submitted" };
        }
        return seasonRoutes(MINE)(path);
      });
      await page.goto("/liga/probe-liga/season-1");
      await page.getByTestId("league-application-start").click();
      await expect(page).toHaveURL(/\/anmelden$/);
      await noSideScroll(page);

      await page.getByTestId("apply-squad-sq2").check();
      await page.getByTestId("apply-next").click();
      await expect(page.getByTestId("apply-problems")).toContainText("mindestens 4");
      await expect(page.getByTestId("apply-next")).toBeDisabled();
      await noSideScroll(page);
      await page.getByTestId("apply-back").click();

      await page.getByTestId("apply-squad-sq1").check();
      await page.getByTestId("apply-next").click();
      await expect(page.getByTestId("apply-check-ok")).toContainText("kann angemeldet werden");
      await expect(page.getByTestId("apply-warnings")).toContainText("Spiel-ID fehlt");
      await expect(page.getByTestId("apply-warnings")).toContainText("Die Anmeldung geht trotzdem");
      await expect(page.getByTestId("apply-next")).toBeEnabled();
      await noSideScroll(page);
      await page.getByTestId("apply-next").click();

      await expect(page.getByTestId("apply-rules-version")).toContainText("Version 2");
      await expect(page.getByTestId("apply-next")).toBeDisabled();
      await page.getByTestId("apply-accept-rules").check();
      await page.getByTestId("apply-accept-privacy").check();
      await noSideScroll(page);
      await page.getByTestId("apply-next").click();

      await expect(page.getByTestId("apply-summary")).toContainText("Rudel Alpha");
      await noSideScroll(page);
      await page.getByTestId("apply-submit").click();
      await expect(page).toHaveURL(/season-1$/);
      expect(body).toEqual({ squad_id: "sq1", rule_version_id: "v1", accept_rules: true, accept_privacy: true });
    });

    test("Status auf der Ligaseite: Warteliste mit Rückzug, abgelehnt mit Grund", async ({ page }) => {
      await mock(page, CAPTAIN, seasonRoutes({ ...MINE, squads: [
        { ...SQUAD, state: "waitlist", application: { id: "a2", status: "waitlist", can_withdraw: true }, can_submit: false },
        { ...BLOCKED, state: "rejected", application: { id: "a3", status: "rejected", decision_reason: "Der Kader passt nicht zur Liga, bitte in der nächsten Season noch einmal versuchen.", can_withdraw: false } },
      ] }));
      await page.goto("/liga/probe-liga/season-1");
      await expect(page.getByTestId("league-application-row-sq1")).toContainText("Warteliste");
      await expect(page.getByTestId("league-application-withdraw-sq1")).toBeVisible();
      await expect(page.getByTestId("league-application-row-sq2")).toContainText("nächsten Season");
      await noSideScroll(page);
    });

    test("Leitung: Einstellungen und Eingang", async ({ page }) => {
      await mock(page, ADMIN, (path) => {
        if (path === "/admin/leagues/seasons/s1") return ADMIN_SEASON;
        if (path === "/admin/leagues/seasons/s1/applications") return INBOX;
        return undefined;
      });
      await page.goto("/admin/leagues/seasons/s1#anmeldungen");
      // Die Marke aus den Nachrichten des Servers öffnet seit #2267 den Reiter „Anmeldung und Kader“.
      await expect(page.getByTestId("season-tab-anmeldung")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("season-applications-stats")).toContainText("5 von 8 Startplätzen belegt");
      await expect(page.getByTestId("application-open-points-a1")).toContainText("Geburtsdatum fehlt");
      await expect(page.getByTestId("application-open-points-a1")).toContainText("Zulassen geht trotzdem");
      await expect(page.getByTestId("application-accept-a1")).toBeEnabled();
      await expect(page.getByTestId("application-assign-a3")).toBeDisabled();
      await page.getByTestId("application-reject-open-a1").click();
      await expect(page.getByTestId("application-reject-send-a1")).toBeDisabled();
      await expect(page.getByTestId("application-open-staffel-a4")).toBeVisible();
      await expect(page.getByTestId("season-form-application-opens")).toHaveValue("2026-11-01T18:00");
      await noSideScroll(page);
    });

    // Befangenheit (#2245): Über das eigene Team entscheidet eine zweite Person, der Superadmin nur mit Grund für die Notausnahme.
    for (const superadmin of [false, true]) {
      test(`Leitung: eigenes Team im Eingang (${superadmin ? "Superadmin" : "Zuständige"})`, async ({ page }) => {
        let body = null;
        await mock(page, superadmin ? ADMIN : { ...ADMIN, role: "user", areas: ["leagues"] }, (path, request) => {
          if (path === "/admin/leagues/seasons/s1") return ADMIN_SEASON;
          if (path === "/admin/leagues/seasons/s1/applications") return { ...INBOX, superadmin, items: [{ ...ROW, own_team: true }, { ...ROW, id: "a2", own_team: false, problems: [] }] };
          if (path === "/admin/leagues/seasons/s1/applications/a1/accept" && request.method() === "POST") {
            body = request.postDataJSON();
            return { id: "a1", status: "accepted" };
          }
          return undefined;
        });
        await page.goto("/admin/leagues/seasons/s1#anmeldungen");
        await expect(page.getByTestId("application-own-team-a1")).toHaveText("Über dein eigenes Team entscheidet eine andere Person.");
        await expect(page.getByTestId("application-accept-a2")).toBeEnabled();
        if (!superadmin) {
          await expect(page.getByTestId("application-accept-a1")).toHaveCount(0);
          await expect(page.getByTestId("application-conflict-reason-a1")).toHaveCount(0);
          await noSideScroll(page);
          return;
        }
        await expect(page.getByTestId("application-accept-a1")).toBeDisabled();
        await page.getByTestId("application-conflict-reason-a1").fill("Sonst ist niemand erreichbar");
        await noSideScroll(page);
        await page.getByTestId("application-accept-a1").click();
        await expect.poll(() => body).toEqual({ conflict_reason: "Sonst ist niemand erreichbar" });
      });
    }
  });
}
