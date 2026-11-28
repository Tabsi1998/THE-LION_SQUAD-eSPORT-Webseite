const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Season absagen (#2607, Entscheidung Nr. 302) im echten Browser, Server nachgestellt: der Knopf auf der Season-Seite, das
// Bestätigungsblatt mit den Folgen und dem Pflichtgrund, danach „Abgesagt“ mit Grund und Datum oben in der Verwaltung, auf der
// Ligaseite und in der Liga-Übersicht - für eine Team- und eine Solo-Season, bei 390 und 1440 px ohne seitliches Scrollen. Feste Uhr.
// Mit E2E_SCREENS_DIR legt der Test die Bilder ab (season-absagen-…). Nur erfundene Namen.

const NOW = new Date("2026-11-28T12:00:00+01:00");
const REASON = "Zu wenige Anmeldungen für einen Spielplan";
const CANCELLED_AT = "2026-11-28T10:30:00+00:00";

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const day = (offset) => new Date(Date.UTC(2026, 11, 8 + offset)).toISOString().slice(0, 10);
const CALENDAR = { weeks: Array.from({ length: 8 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false })),
  blocked_weeks: [], active_weeks: 8, max_teams_per_staffel: 9, rounds_needed: 3, end_date: "2027-02-01T22:59:59+00:00" };
const SCORING = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff", "lead_decision"], head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };

function world(kind) {
  const solo = kind === "solo";
  const league = { id: "l1", name: solo ? "Duell-Liga" : "Probe-Liga", slug: solo ? "duell-liga" : "probe-liga", ...(solo ? { participant_kind: "solo" } : {}) };
  const season = { id: "s2", league_id: "l1", number: 2, name: "Season 2", slug: "season-2", start_date: "2026-12-07T23:00:00+00:00", weeks_total: 8, matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: solo ? 1 : 4, min_squad_size: solo ? 1 : 4,
    game_mode_order: [], scoring_rules: SCORING, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "public", status: "draft", blocked_periods: [],
    application_opens_at: "2026-11-01T00:00:00+00:00", application_closes_at: "2026-11-27T23:00:00+00:00",
    ...(solo ? {} : { predecessor_id: "s1", predecessor: { id: "s1", name: "Season 1", number: 1, slug: "season-1" } }) };
  const division = { id: "d1", level: 1, overrides: {}, label: "Liga 1", calendar: CALENDAR, status: "active",
    settings: { best_of: 3, team_size: season.team_size, min_squad_size: season.min_squad_size, max_staffel_size: 8, scoring_rules: SCORING },
    zones: { promote: 0, relegate: 0, playoff_promote: 0, playoff_relegate: 0 }, zones_effective: { promote: 0, relegate: 0, playoff_promote: 0, playoff_relegate: 0, top: true, bottom: true },
    staffeln: [{ tournament_id: "t1", staffel: "A", status: "draft", participant_count: 1, max_participants: 8 }] };
  const page = {
    capabilities: ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules"],
    league, season, game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null, divisions: [division],
  };
  const plan = solo
    ? { season_id: "s2", cancelled: false, can_cancel: true, problems: [], kind: "solo", applications: 3, applications_by_status: { submitted: 2, in_review: 0, waitlist: 0, accepted: 1 },
      staffeln: 1, registrations: 1, people: 3, teams: 3, carried: 0, predecessor: null }
    : { season_id: "s2", cancelled: false, can_cancel: true, problems: [], kind: "team", applications: 4, applications_by_status: { submitted: 1, in_review: 1, waitlist: 1, accepted: 1 },
      staffeln: 1, registrations: 1, people: 8, teams: 4, carried: 2, predecessor: { id: "s1", name: "Season 1" } };
  const cancelled = { ...season, status: "cancelled", cancel_reason: REASON, cancelled_at: CANCELLED_AT };
  if (!solo) {
    delete cancelled.predecessor_id;
    cancelled.cancelled_predecessor_id = "s1";
  }
  const publicSeason = (row) => ({
    league: { ...league, game: { name: "Probe Shooter" } },
    season: { name: row.name, slug: row.slug, status: row.status, start_date: row.start_date, end_date: "2027-02-01T22:59:59+00:00", matchday_days: 7,
      default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: row.team_size, match_points: { win: 3, draw: 0, loss: 0 }, blocked_periods: [],
      cancel_reason: row.cancel_reason || null, cancelled_at: row.cancelled_at || null },
    map_pool: null, divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [{ tournament_id: "t1", slug: "probe-1a", staffel: "A", status: row.status === "cancelled" ? "cancelled" : "draft" }] }],
    application: { state: "closed", opens_at: row.application_opens_at, closes_at: row.cancelled_at || row.application_closes_at,
      ...(row.status === "cancelled" ? { cancelled: true, cancelled_at: row.cancelled_at } : {}), slots: null, slots_free: null, waitlist: false, waitlist_full: false },
  });
  return { league, season, page, plan, cancelled, publicSeason };
}

async function mockServer(page, w, user = ADMIN) {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "teams/invites/my", "teams/dissolved/mine", "teams?**", "teams/levels"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (user) await page.route("**/api/auth/me", json(user));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
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

for (const kind of ["team", "solo"]) {
  test.describe(`Liga: Season absagen (${kind === "solo" ? "Solo" : "Team"})`, () => {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      test(`Knopf, Bestätigungsblatt und danach „Abgesagt“ bei ${width} px`, async ({ page }) => {
        const w = world(kind);
        await page.setViewportSize({ width, height });
        await mockServer(page, w);
        let state = w.page;
        let sent = null;
        await page.route("**/api/admin/leagues/seasons/s2", (route) => json(state)(route));
        await page.route("**/api/admin/leagues/seasons/s2/cancel-plan", json(w.plan));
        await page.route("**/api/admin/leagues/seasons/s2/cancel", (route) => {
          sent = route.request().postDataJSON();
          state = { ...w.page, season: w.cancelled };
          return json({ ok: true, already: false, season: w.cancelled, rejected: w.plan.applications, staffeln: 1, notified: w.plan.people })(route);
        });

        await page.goto("/admin/leagues/seasons/s2");
        await page.getByTestId("season-cancel").click();
        const sheet = page.getByTestId("season-cancel-sheet");
        await expect(sheet.getByTestId("season-cancel-window")).toHaveText("Die Anmeldung schließt sofort.");
        if (kind === "solo") {
          await expect(sheet.getByTestId("season-cancel-applications")).toHaveText("3 offene Anmeldungen werden mit deinem Grund abgelehnt (2 eingereicht, 1 angenommen).");
          await expect(sheet.getByTestId("season-cancel-people")).toHaveText("3 Personen bekommen genau eine Nachricht mit Mail – 3 Spieler.");
          await expect(sheet.getByTestId("season-cancel-carried")).toHaveCount(0);
        } else {
          await expect(sheet.getByTestId("season-cancel-applications")).toContainText("4 offene Anmeldungen werden mit deinem Grund abgelehnt");
          await expect(sheet.getByTestId("season-cancel-people")).toHaveText("8 Personen bekommen genau eine Nachricht mit Mail – Captain und Vertreter von 4 Co-Teams.");
          await expect(sheet.getByTestId("season-cancel-carried")).toContainText("aus Season 1 übernommen: Ihre Startrechte gelten für die nächste Season weiter.");
        }
        await expect(sheet.getByTestId("season-cancel-staffeln")).toHaveText("1 Staffel steht danach auf „Abgesagt“.");
        await expect(sheet.getByTestId("season-cancel-final")).toContainText("Zurücknehmen geht nicht.");
        // Pflichtgrund: unter fünf Zeichen bleibt der Knopf gesperrt.
        const confirm = sheet.getByTestId("season-cancel-confirm");
        await sheet.getByTestId("season-cancel-reason").fill("zu");
        await expect(confirm).toBeDisabled();
        await sheet.getByTestId("season-cancel-reason").fill(REASON);
        await expect(confirm).toBeEnabled();
        await noSideScroll(page);
        await shot(page, `season-absagen-blatt-${kind}-${width}`);
        await confirm.click();
        await expect.poll(() => sent && sent.reason).toBe(REASON);

        const notice = page.getByTestId("season-admin-cancelled");
        await expect(notice).toBeVisible();
        await expect(notice).toContainText("Abgesagt");
        await expect(notice.getByTestId("season-admin-cancelled-date")).toHaveText("am 28.11.2026");
        await expect(notice.getByTestId("season-admin-cancelled-reason")).toContainText(REASON);
        if (kind === "team") {
          await expect(notice.getByTestId("season-admin-cancelled-predecessor")).toHaveAttribute("href", "/admin/leagues/seasons/s1");
        }
        await expect(page.getByTestId("season-cancel")).toHaveCount(0);
        await expect(page.getByTestId("season-delete")).toHaveCount(0);
        await expect(page.getByTestId("season-successor")).toHaveCount(0);
        await expect(page.getByTestId("season-form-status-cancelled")).toContainText("Abgesagt");
        await expect(page.getByTestId("season-phase-abschluss")).toHaveAttribute("data-state", "current");
        await noSideScroll(page);
        await shot(page, `season-absagen-verwaltung-${kind}-${width}`);
      });

      test(`Ligaseite und Übersicht zeigen „Abgesagt“ mit Grund und Datum bei ${width} px`, async ({ page }) => {
        const w = world(kind);
        await page.setViewportSize({ width, height });
        await mockServer(page, w, null);
        await page.route(`**/api/leagues/${w.league.slug}/season-2`, json(w.publicSeason(w.cancelled)));
        await page.route("**/api/leagues", json({ leagues: [{ ...w.league, game: { name: "Probe Shooter" },
          seasons: [{ id: "s2", number: 2, name: "Season 2", slug: "season-2", status: "cancelled", start_date: w.season.start_date, cancel_reason: REASON,
            cancelled_at: CANCELLED_AT, emblem_url: null, banner: null }] }] }));

        await page.goto(`/liga/${w.league.slug}/season-2`);
        const notice = page.getByTestId("season-cancelled");
        await expect(notice).toBeVisible();
        await expect(notice).toContainText("Abgesagt");
        await expect(notice.getByTestId("season-cancelled-date")).toHaveText("am 28.11.2026");
        await expect(notice.getByTestId("season-cancelled-reason")).toHaveText(`Grund: ${REASON}`);
        // Die Anmeldung endete mit der Absage - nie „Vorbei seit <Fensterende>“.
        await expect(page.getByText("Abgesagt am 28.11.2026, 11:30 Uhr")).toBeVisible();
        await expect(page.getByText(/Vorbei seit/)).toHaveCount(0);
        await noSideScroll(page);
        await shot(page, `season-absagen-ligaseite-${kind}-${width}`);

        await page.goto("/liga");
        await expect(page.getByTestId("league-index-season-state-season-2")).toHaveText("Abgesagt am 28.11.2026");
        await noSideScroll(page);
      });
    }
  });
}
