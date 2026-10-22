const { test, expect } = require("@playwright/test");

// TFT-Saison mit offenen Terminen und Double Up wie PineApps (#2015) im echten Browser, Server nachgestellt: Kalender
// mit „4 von 9 vorgesehenen angelegt“ und „Fehlende Termine anlegen“, Terminliste mit „offen“, Regeln mit „Double-Up-Punkte“, Serienseite
// mit „4 von 9“ und dem Double-Up-Tag (Team-Platz, Punkte wie Einzelplatz 2k−1). Bei 1440 und 390 px ohne seitliches
// Scrollen. `TFT_SHOTS` legt Bilder ab, `TFT_PHASE=vorher` stellt den Server wie vor #2015 nach (vier Termine, Double
// Up nach Team-Platz) und prüft nichts Neues. Nur erfundene Namen.

const SHOTS = process.env.TFT_SHOTS || "";
const PHASE = process.env.TFT_PHASE || "nachher";
const AFTER = PHASE === "nachher";
const BOARD = { id: "vorstand-1", username: "vorstand", display_name: "Vorstand", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
const SCHEME = [35, 30, 26, 23, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1];

const dated = (number, day) => ({ id: `t${number}`, position: number, code: `T${number}`, club_day: day, time: "19:00", kind: "regular", counts: true, state: "scored", status: "scored", weekend: number });
const open = (number) => ({ id: `t${number}`, position: number, code: `T${number}`, club_day: null, time: "19:00", kind: "regular", counts: true, state: "planned", status: "planned", weekend: number });
const PLAYED = [dated(1, "2026-09-17"), dated(2, "2026-09-24"), dated(3, "2026-10-01"), dated(4, "2026-10-08")];
const ALL = [...PLAYED, ...[5, 6, 7, 8, 9].map(open)];

// Turnier 3 ist Double Up: Team-Plätze 1, 2, 3, 4 und zweimal 6 - Punkte nach PineApps (2k−1) bzw. früher nach k.
const NAMES = ["Probe Ada", "Probe Bruno", "Probe Cleo", "Probe Dario", "Probe Ella", "Probe Finn", "Probe Gina", "Probe Hugo", "Probe Ida", "Probe Jan", "Probe Kim", "Probe Lea"];
const TEAMS = [[1, 4], [0, 5], [2, 3], [6, 7], [8, 9], [10, 11]];
const TEAM_PLACE = [1, 2, 3, 4, 6, 6];
const pointsFor = (place) => SCHEME[(AFTER ? 2 * place - 1 : place) - 1];
const T3 = {};
TEAMS.forEach(([a, b], index) => {
  const place = TEAM_PLACE[index];
  const day = 40 - index * 5;
  T3[a] = { round_id: "t3", place, points: pointsFor(place), day_points: index >= 4 ? 15 : day, partner: { name: NAMES[b], name_hidden: false, club_member: false }, day_rounds: [8, 7, 6, 5, 4].map((points) => ({ points: Math.max(points - index, 1) })) };
  T3[b] = { ...T3[a], partner: { name: NAMES[a], name_hidden: false, club_member: false } };
});
const single = (round, order) => order.map((person, index) => [person, { round_id: round, place: index + 1, points: SCHEME[index], day_points: 40 - index * 2, day_rounds: [8, 7, 6, 5, 4].map((points) => ({ points: Math.max(points - Math.floor(index / 2), 1) })) }]);
const RESULTS = {};
for (const [round, order] of [["t1", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], ["t2", [3, 0, 1, 2, 5, 4, 7, 6, 9, 8, 11, 10]], ["t4", [2, 0, 3, 1, 4, 6, 5, 7, 8, 10, 9, 11]]]) {
  for (const [person, result] of single(round, order)) (RESULTS[person] ||= []).push(result);
}
for (const [person, result] of Object.entries(T3)) RESULTS[person].push(result);
const ROWS = NAMES.map((name, index) => {
  const results = RESULTS[index].sort((a, b) => a.round_id.localeCompare(b.round_id)).map((item) => ({ ...item, marks: [], counted: true, dropped: false }));
  const points = results.reduce((sum, item) => sum + item.points, 0);
  return { key: `p${index}`, name, name_hidden: false, club_member: index === 2, profile_slug: index === 2 ? "probe-cleo" : null, points, computed_points: points, results, wins: 0, bonus_points: 0 };
}).sort((a, b) => b.points - a.points).map((row, index) => ({ ...row, rank: index + 1 }));

const RULES = {
  points_mode: "scheme", points_by_place: SCHEME, count_mode: "best_n", count_n: 6, final_top_n: null,
  tiebreakers: ["wins", "top_n", "countback"], tiebreak_top_n: 4, activity_points: { points: 2, from_round: 7 },
  bonuses: { fastest_lap: { points: 0 }, pole: { points: 0 } }, dnf_points: 0, dns_points: 0, dsq_points: 0,
  day_rounds: { count: 5, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] }, custom_bonuses: [{ key: "bingo", label: "Bingo", points: 3 }],
  ...(AFTER ? { double_up_points: "best_player_place" } : {}),
};
const PAGE = {
  lineage: { title: "Probe TFT Masters", slug: "probe-tft", kind: "series", organizer: "Probe Veranstalter", game_name: "Probe Taktikspiel" },
  series: { season: "2026/27", tier: null, title: null, season_slug: "2026-27", status: "active", ...(AFTER ? { planned_rounds: 9 } : {}) },
  rules: RULES, successor: null, rule_changes: [], today: "2026-10-20",
  progress: { total: AFTER ? 9 : 4, scored: 4, cancelled: 0, remaining: AFTER ? 5 : 0, next: AFTER ? ALL[4] : null },
  rounds: AFTER ? ALL : PLAYED,
  standings: { round_id: "t4", round_seq: 4, rows: ROWS }, final: null, team_league: null, racing: null, map_pool: null,
};

const ADMIN_RULES = { ...RULES, team_scoring: { enabled: false }, match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: [], min_participants: null };
const ADMIN_SERIES = {
  id: "serie-1", lineage_id: "spur-1", season: "2026/27", status: "active", rules_version: 1, rules: ADMIN_RULES, default_weekday: 3, default_time: "19:00",
  own_teams: [], visibility: "public", publish_mode: "review", ...(AFTER ? { planned_rounds: 9 } : {}),
  lineage: { id: "spur-1", title: "Probe TFT Masters", kind: "series", slug: "probe-tft" }, access: { role: "board", can_publish: true },
};
const CALENDAR = (rounds, version) => ({
  version, today: "2026-10-20", counts: { scored: 4, planned: rounds.length - 4 }, hints: [], archived: [], rounds,
  ...(AFTER ? { planned: { planned: 9, count: rounds.length, missing: 9 - rounds.length } } : {}),
});
const PASTE_ROWS = [5, 6, 7].map((number, index) => (AFTER
  ? { line: index + 1, code: `T${number}`, day: null, open: true, time: index === 1 ? "20:30" : "19:00", venue: index === 1 ? "Halle Nord" : null, sessions: [{ session: null, day: null, time: "19:00", counts: true }] }
  // Vorher: eine Zeile ohne Datum bekam den nächsten Standard-Wochentag.
  : { line: index + 1, code: `T${number}`, day: `2026-10-${15 + index * 7}`, derived_day: true, time: index === 1 ? "20:30" : "19:00", venue: index === 1 ? "Halle Nord" : null, sessions: [{ session: null, day: `2026-10-${15 + index * 7}`, time: "19:00", counts: true }] }));

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  let calendar = CALENDAR(PLAYED, 4);
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(BOARD));
  await page.route("**/api/reference-series/public/probe-tft/2026-27", json(PAGE));
  await page.route("**/api/reference-series/admin", json({ lineages: [{ ...ADMIN_SERIES.lineage, series: [ADMIN_SERIES] }], points_schemes: [], default_rules: ADMIN_RULES }));
  await page.route("**/api/reference-series/admin/series/serie-1", json(ADMIN_SERIES));
  await page.route("**/api/reference-series/admin/series/serie-1/calendar", (route) => json(calendar)(route));
  await page.route("**/api/reference-series/admin/series/serie-1/rounds/fill-planned", (route) => {
    calendar = CALENDAR(ALL, 5);
    return json({ created: 5, codes: ["T5", "T6", "T7", "T8", "T9"], ...calendar })(route);
  });
  await page.route("**/api/reference-series/admin/series/serie-1/rounds/paste", json({ rows: PASTE_ROWS, errors: [], count: 3 }));
  await page.route("**/api/reference-series/admin/series/serie-1/staff", json({ staff: [] }));
  await page.route("**/api/reference-series/admin/series/serie-1/close", json({ entries: [], current: null, candidates: [], cancelled: false, open_rounds: 5 }));
  await page.route("**/api/reference-series/admin/series/serie-1/participants", json({ participants: [], counts: { member: 0, guest: 0, external: 0, open: 0, club: 0 }, profiles: [] }));
}

async function shot(locator, name, width) {
  if (!SHOTS) return;
  const style = await locator.page().addStyleTag({ content: "[data-sonner-toaster]{display:none!important} body > div header { visibility: hidden !important; }" });
  await locator.screenshot({ path: `${SHOTS}/${PHASE}-${name}-${width}.png`, animations: "disabled" });
  await style.evaluate((node) => node.remove());
}

async function noSidewaysScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`Serienseite: 4 von 9 und Double Up wie PineApps (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/references/series/probe-tft/2026-27");
    const progress = page.getByTestId("series-progress");
    await expect(progress).toBeVisible();
    await noSidewaysScroll(page);
    await shot(progress, "fortschritt", width);
    await shot(page.getByTestId("series-rules"), "regeln", width);
    const days = page.getByTestId("series-days");
    await days.getByTestId("series-day-pick").filter({ hasText: "T3" }).click();
    await expect(days.getByTestId("series-day-double-up")).toBeVisible();
    await noSidewaysScroll(page);
    await shot(days, "double-up-tag", width);
    if (!AFTER) return;
    await expect(progress).toContainText("4 von 9 Runden gewertet");
    await expect(progress).toContainText("Termin offen");
    await expect(page.getByTestId("series-rules")).toContainText("Team-Platz k zählt wie Einzelplatz 2k−1");
    await expect(days.getByTestId("series-day-double-up-rule")).toContainText("Platz = Team-Platz, Punkte wie Einzelplatz 2k−1");
  });

  test(`Verwaltung: Kalender mit geplanten Terminen und Liste mit „offen“ (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/reference-series/serie-1");
    const calendar = page.getByTestId("series-calendar");
    await expect(calendar.getByTestId("calendar-round").first()).toBeVisible();
    await noSidewaysScroll(page);
    await shot(calendar, "kalender", width);
    if (AFTER) {
      await expect(calendar.getByTestId("series-calendar-planned")).toContainText("4 von 9 vorgesehenen angelegt");
      await calendar.getByTestId("calendar-fill-planned").click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(calendar.getByTestId("calendar-round")).toHaveCount(9);
      await expect(calendar.getByTestId("calendar-round").nth(4)).toContainText("Termin offen · 19:00");
      await expect(calendar.getByTestId("calendar-fill-planned")).toHaveCount(0);
      await noSidewaysScroll(page);
      await shot(calendar, "kalender-aufgefuellt", width);
    }
    await calendar.getByTestId("calendar-paste").click();
    const sheet = page.getByTestId("paste-sheet");
    await sheet.getByTestId("paste-text").fill("T5 · offen\nT6 · ? · 20:30 · Halle Nord\nT7 · tbd");
    await sheet.getByTestId("paste-submit").click();
    await expect(sheet.getByTestId("paste-preview")).toBeVisible();
    await shot(sheet, "liste-offen", width);
    if (AFTER) {
      await expect(sheet.getByTestId("paste-open")).toHaveCount(3);
      await expect(sheet).toContainText("„offen“, „?“ oder „tbd“ statt des Datums");
    }
  });

  test(`Verwaltung: Regeln mit Double-Up-Punkten und geplanten Terminen (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/reference-series/serie-1");
    await page.getByTestId("series-detail-edit").click();
    const days = page.getByTestId("series-rules-days-section");
    await expect(days).toBeVisible();
    await days.scrollIntoViewIfNeeded();
    await noSidewaysScroll(page);
    await shot(days, "regeln-turniertage", width);
    if (!AFTER) return;
    await expect(page.getByTestId("series-rules-double-up")).toHaveValue("best_player_place");
    await expect(page.getByTestId("series-planned-rounds")).toHaveValue("9");
    await page.getByTestId("series-planned-rounds").scrollIntoViewIfNeeded();
    await shot(page.getByTestId("series-planned-rounds").locator("xpath=ancestor::*[contains(@class,'grid')][1]"), "saison-geplant", width);
  });
}
