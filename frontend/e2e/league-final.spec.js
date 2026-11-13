const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Saisonabschluss (F.1, #1645, docs/LIGA.md „F.1 Saisonabschluss“) im echten Browser, Server nachgestellt: das Cockpit im Reiter
// „Abschluss“ mit Checkliste und Link, Vorschau, Gleichstand auf Platz 1, Abschließen mit Bestätigung, Verlauf und Wieder öffnen -
// und der Endstand auf der Ligaseite. Bei 390 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab
// (f1-cockpit-…, f1-endstand-oeffentlich-…). Nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const TEAMS = ["Nordlicht · Nordlicht A", "Sturmfalken · Falken Rot", "Eisbären · Eisbären B", "Wüstenfüchse · Füchse A"];
// Jede Zeile aus ihren Spielen gerechnet (Best of 3, Sieg 3 Punkte, kein Remis): SP = S + N, Punkte = 3 × S, Maps und Form passen dazu.
const row = (index, rank, won, lost, mapsFor, mapsAgainst, form, extra = {}) => ({ registration_id: `r${index}`, display_name: TEAMS[index - 1], team_id: `team-${index}`,
  rank, played: won + lost, won, drawn: 0, lost, score_for: mapsFor, score_against: mapsAgainst, score_diff: mapsFor - mapsAgainst, points: won * 3, form,
  previous_rank: null, forfeit_won: 0, forfeit_lost: 0, deducted_points: 0, exit: null, tiebreak: null, lead_decision: null, contested: 0, ...extra });
// Staffel B, alles gespielt: 1 schlägt 2 (2:1), 3 (2:0), 4 (2:0); 2 schlägt 3 (2:1), 4 (2:0); 3 schlägt 4 (2:1).
const ROWS = [row(1, 1, 3, 0, 6, 1, ["W", "W", "W"]), row(2, 2, 2, 1, 5, 3, ["L", "W", "W"]), row(3, 3, 1, 2, 3, 5, ["L", "L", "W"]), row(4, 4, 0, 3, 1, 6, ["L", "L", "L"])];
const DECISION = { id: "d1", reason: "Am 10.01. mit 2:1 gewonnen", method: "playoff", decided_at: "2027-01-10T20:00:00+00:00" };
// Staffel A: Das Spiel 1 gegen 2 fiel aus. 1 schlägt 3 (2:0) und 4 (2:1), 2 schlägt 3 (2:1) und 4 (2:0) - beide stehen in allem gleich.
// 3 gegen 4 ist noch offen.
const TIED = [row(1, 1, 2, 0, 4, 1, ["W", "W"]), row(2, 1, 2, 0, 4, 1, ["W", "W"]), row(3, 3, 0, 2, 1, 4, ["L", "L"]), row(4, 3, 0, 2, 1, 4, ["L", "L"])];
// Staffel C: wie A, dazu 3 schlägt 4 (2:0) - das Entscheidungsspiel 2:1 machte 1 zum Meister.
const DECIDED = [row(1, 1, 2, 0, 4, 1, ["W", "W"], { tiebreak: "lead_decision", lead_decision: DECISION }),
  row(2, 2, 2, 0, 4, 1, ["W", "W"], { tiebreak: "lead_decision", lead_decision: DECISION }),
  row(3, 3, 1, 2, 3, 4, ["L", "L", "W"]), row(4, 4, 0, 3, 1, 6, ["L", "L", "L"])];
// Fassung 1 von Staffel C: Spieltag 2 war vertauscht eingetragen (4 schlägt 1 mit 2:1 statt umgekehrt) - damals stand 2 allein vorn.
const FIRST_VERSION = [row(2, 1, 2, 0, 4, 1, ["W", "W"]), row(1, 2, 1, 1, 3, 2, ["W", "L"]), row(3, 3, 1, 2, 3, 4, ["L", "L", "W"]), row(4, 4, 1, 2, 2, 5, ["L", "W", "L"])];
const RULES = { allow_draws: false, tiebreakers: ["head_to_head", "score_diff", "score_for", "lead_decision"], match_points: { win: 3, draw: 0, loss: 0 }, match_points_mode: "result" };

const ADMIN = { id: "admin-1", username: "leitung", display_name: "Leitung", role: "superadmin", areas: ["tournaments", "leagues"], mfa_enabled: true, auth_mfa_verified: true };
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const CALENDAR = { weeks: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: day(index * 7), end_day: day(index * 7 + 6), blocked: false })),
  blocked_weeks: [], active_weeks: 10, max_teams_per_staffel: 10, rounds_needed: 5, end_date: "2027-01-18T22:59:59+00:00" };
const SCORING = { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: RULES.tiebreakers, head_to_head_criteria: ["points", "score_diff", "score_for"],
  allow_draws: false, forfeit_score: "best_of", exit_rule: "all_for_opponents" };
const SEASON_PAGE = {
  capabilities: ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions", "rules"],
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" },
  season: { id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4,
    game_mode_order: [], scoring_rules: SCORING, result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "", visibility: "public", status: "active", blocked_periods: [] },
  game: { id: "g1", name: "Probe Shooter", slug: "probe-shooter", modes: [] }, calendar: CALENDAR, library: [], map_pool: null,
  divisions: [{ id: "d1", level: 1, overrides: {}, label: "Liga 1", calendar: CALENDAR, settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: SCORING },
    staffeln: [{ tournament_id: "t1", staffel: "A", status: "live", participant_count: 4, max_participants: 8 }] }],
};

const FINAL = { id: "f2", version: 2, closed_at: "2027-01-12T19:30:00+00:00", closed_by_name: "Zweite Leitung", rules_label: "Fassung 1.2",
  champion: { registration_id: "r1", display_name: TEAMS[0], team_id: "team-1" },
  decisions: [{ names: [TEAMS[0], TEAMS[1]], reason: DECISION.reason, method: "playoff", method_label: "Entscheidungsspiel" }] };
const HISTORY = [
  { id: "f2", version: 2, active: true, closed_at: "2027-01-12T19:30:00+00:00", closed_by_name: "Zweite Leitung", reopened_at: null, champion: TEAMS[0], teams: 4, rules_label: "Fassung 1.2" },
  { id: "f1", version: 1, active: false, closed_at: "2027-01-09T18:00:00+00:00", closed_by_name: "Erste Leitung", reopened_at: "2027-01-10T09:15:00+00:00",
    reopened_by_name: "Zweite Leitung", reopen_reason: "Ergebnis von Spieltag 2 war vertauscht eingetragen", champion: TEAMS[1], teams: 4, rules_label: "Fassung 1.2" },
];
const base = (letter, extra) => ({ tournament_id: `t${letter}`, title: `Probe-Liga · Season 1 · Liga 1 · Staffel ${letter}`, slug: `probe-${letter.toLowerCase()}`, staffel: letter,
  division_label: "Liga 1", status: "live", champion_place: true, own_team: false, history: [], closed: false, final: null, standings: ROWS, table_rules: RULES,
  blockers: [], ties: [], can_decide: true, champion: { registration_id: "r1", display_name: TEAMS[0] }, can_close: true, closed_by_me: false, can_reopen: false, ...extra });
const BLOCKED = base("A", { can_close: false, champion: null, standings: TIED,
  ties: [{ rank: 1, registration_ids: ["r1", "r2"], names: [TEAMS[0], TEAMS[1]], points: 6, own_team: false }],
  blockers: [
    { code: "open_matches", label: "Offene Spiele", count: 1, text: "Jedes Spiel braucht ein Ergebnis oder eine Entscheidung der Leitung (Ergebnis eintragen, kampflos werten, absagen).",
      items: [{ text: `Spieltag 3: ${TEAMS[2]} – ${TEAMS[3]}`, url: "/matches/m9" }] },
    { code: "procedures", label: "Offene Verfahren", count: 1, text: "Beanstandung, Protest oder Einspruch sind noch nicht entschieden.",
      items: [{ text: `Protest · Spieltag 2: ${TEAMS[0]} – ${TEAMS[2]}`, url: "/matches/m4#verfahren-p1" }] },
    { code: "deadlines", label: "Laufende Fristen", count: 1, text: "Solange eine Protest- oder Einspruchsfrist läuft, kann sich das Ergebnis noch ändern.",
      items: [{ text: `Protestfrist · Spieltag 2: ${TEAMS[1]} – ${TEAMS[3]}`, url: "/matches/m8", until: "2027-01-14T19:00:00+00:00" }] },
    { code: "champion_tie", label: "Gleichstand auf Platz 1", count: 1,
      text: "Der Meister steht nicht fest: Vor dem Abschluss braucht es einen begründeten Entscheid (Entscheidungsspiel, Los oder Leitung).",
      items: [{ text: `${TEAMS[0]} – ${TEAMS[1]}`, url: "/admin/leagues/seasons/s1#abschluss" }] },
  ] });
const READY = base("B", {});
const CLOSED = base("C", { closed: true, status: "completed", final: FINAL, history: HISTORY, standings: DECIDED, can_close: false, can_reopen: true });
const CLOSING = { season: { id: "s1", name: "Season 1", status: "active", closed: false }, can_act: true, superadmin: false, responsible: "„Season konfigurieren“",
  methods: { playoff: "Entscheidungsspiel", lot: "Los", lead: "Entscheid der Leitung" }, staffeln: [BLOCKED, READY, CLOSED] };

const LEAGUES = { leagues: [{ id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" },
  seasons: [{ id: "s1", slug: "season-1", name: "Season 1", status: "completed", start_date: "2026-11-09T23:00:00+00:00" }] }] };
const PUBLIC_SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: { name: "Season 1", slug: "season-1", status: "completed", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00", matchday_days: 7,
    default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4, match_points: { win: 3, draw: 0, loss: 0 }, blocked_periods: [] },
  map_pool: null,
  divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A", status: "completed" }] }],
};
const PUBLIC_STAFFEL = {
  staffel: { tournament_id: "t1", staffel: "A", division_label: "Liga 1", division_level: 1, status: "completed", table_rules: RULES,
    final: { version: 2, closed_at: FINAL.closed_at, champion: FINAL.champion, decisions: FINAL.decisions, rules_label: "Fassung 1.2" } },
  standings: DECIDED, current: 3, teams: [], weeks: [],
};

async function mockServer(page, { admin = false, closing = CLOSING } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  if (admin) await page.route("**/api/auth/me", json(ADMIN));
  else await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues", json(LEAGUES));
  await page.route("**/api/leagues/probe-liga/season-1", json(PUBLIC_SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(PUBLIC_STAFFEL));
  await page.route("**/api/admin/leagues/seasons/s1", json(SEASON_PAGE));
  await page.route("**/api/admin/leagues/seasons/s1/closing", json(closing));
  await page.route("**/api/admin/leagues/staffeln/*/final-tables/*", json({ ...HISTORY[1], standings: FIRST_VERSION, decisions: [], table_rules: RULES }));
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

test.describe("Liga: Saisonabschluss", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Cockpit bei ${width} px: Checkliste mit Link, Vorschau, Endstand und Verlauf`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { admin: true });
      await page.goto("/admin/leagues/seasons/s1#abschluss");
      await expect(page.getByTestId("season-tab-abschluss")).toHaveAttribute("aria-selected", "true");
      const panel = page.getByTestId("season-close");
      await expect(panel.getByTestId("season-close-summary")).toHaveText("1 von 3 Staffeln abgeschlossen. Die Season ist beendet, wenn alle abgeschlossen sind.");

      const blocked = panel.getByTestId("close-staffel-tA");
      await expect(blocked.getByTestId("close-state-tA")).toHaveText("4 offen");
      await expect(blocked.getByRole("link", { name: `Spieltag 3: ${TEAMS[2]} – ${TEAMS[3]}` })).toHaveAttribute("href", "/matches/m9");
      await expect(blocked.getByTestId("close-blocker-tA-deadlines")).toContainText("bis 14.01.2027, 20:00");
      await expect(blocked.getByTestId("close-decide-tA")).toBeVisible();
      await expect(blocked.getByTestId("close-button-tA")).toBeDisabled();

      const ready = panel.getByTestId("close-staffel-tB");
      await expect(ready.getByTestId("close-state-tB")).toHaveText("Bereit zum Abschluss");
      await expect(ready.getByRole("table", { name: "Vorschau Liga 1 · Staffel B" })).toBeVisible();

      const closed = panel.getByTestId("close-staffel-tC");
      await expect(closed.getByTestId("close-final-tC")).toContainText("Abgeschlossen am 12.01.2027, 20:30 von Zweite Leitung · Fassung 2");
      await expect(closed.getByTestId("close-final-tC")).toContainText(`Meister: ${TEAMS[0]}`);
      await expect(closed.getByTestId("close-final-tC")).toContainText("Entscheidungsspiel: Am 10.01. mit 2:1 gewonnen");
      await expect(closed.getByTestId("standing-notes-r1")).toContainText("Platz durch Entscheidungsspiel");
      await expect(closed.getByTestId("close-history-tC")).toContainText("Ergebnis von Spieltag 2 war vertauscht eingetragen");
      await noSideScroll(page);
      await shot(panel, `f1-cockpit-${width}`);

      await closed.getByTestId("close-version-tC-1").click();
      const version = page.getByTestId("version-sheet").getByRole("table", { name: "Endstand Fassung 1" });
      await expect(version).toBeVisible();
      await expect(version.getByRole("row").nth(1)).toContainText(TEAMS[1]);
      await noSideScroll(page);
    });

    test(`Abschließen, Meister entscheiden und wieder öffnen bei ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page, { admin: true });
      const sent = {};
      await page.route("**/api/admin/leagues/staffeln/tB/close", (route) => {
        sent.close = route.request().postDataJSON();
        return json({ ok: true, version: 1 })(route);
      });
      await page.route("**/api/admin/leagues/staffeln/tC/reopen", (route) => {
        sent.reopen = route.request().postDataJSON();
        return json({ ok: true, version: 2 })(route);
      });
      await page.route("**/api/admin/leagues/staffeln/tA/table-decision", (route) => {
        sent.decision = route.request().postDataJSON();
        return json({ id: "d9" })(route);
      });
      await page.goto("/admin/leagues/seasons/s1#abschluss");

      await page.getByTestId("close-decide-tA").click();
      const decide = page.getByTestId("table-decision-sheet");
      await decide.getByTestId("table-decision-method").selectOption("playoff");
      await decide.getByTestId("table-decision-reason").fill("Am 10.01. mit 2:1 gewonnen");
      await noSideScroll(page);
      await decide.getByTestId("table-decision-save").click();
      await expect.poll(() => sent.decision).toEqual({ registration_ids: ["r1", "r2"], reason: "Am 10.01. mit 2:1 gewonnen", method: "playoff" });

      await page.getByTestId("close-button-tB").click();
      const sheet = page.getByTestId("close-sheet");
      await expect(sheet.getByTestId("close-sheet-champion")).toContainText(TEAMS[0]);
      await noSideScroll(page);
      expect(sent.close).toBeUndefined();
      await sheet.getByTestId("close-confirm").click();
      await expect.poll(() => sent.close).toEqual({ confirm: true });

      await page.getByTestId("reopen-button-tC").click();
      const reopen = page.getByTestId("reopen-sheet");
      await reopen.getByTestId("reopen-confirm").click();
      expect(sent.reopen).toBeUndefined();
      await reopen.getByTestId("reopen-reason").fill("Ergebnis von Spieltag 2 war vertauscht");
      await reopen.getByTestId("reopen-confirm").click();
      await expect.poll(() => sent.reopen).toEqual({ reason: "Ergebnis von Spieltag 2 war vertauscht" });
    });

    test(`Ligaseite bei ${width} px: abgeschlossene Staffel zeigt Endstand und Meister`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto("/liga/probe-liga/season-1");
      const staffel = page.getByTestId("league-staffel-A");
      await expect(staffel.getByTestId("league-final-A")).toHaveText("Endstand · abgeschlossen am 12.01.2027");
      await expect(staffel.getByTestId("league-champion-A")).toContainText(`Meister ${TEAMS[0]}`);
      await expect(staffel.getByTestId("standing-notes-r1")).toContainText("Platz durch Entscheidungsspiel: Am 10.01. mit 2:1 gewonnen");
      await noSideScroll(page);
      await shot(staffel.locator(".tls-league-table"), `f1-endstand-oeffentlich-${width}`);
    });
  }
});
