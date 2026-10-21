const { test, expect } = require("@playwright/test");

// Sonderregeln einer Rennliga (#1960) im echten Browser, Server nachgestellt: Serienseite mit „−5“ samt Grund,
// Fahrer-Detail mit Anpassung und „im Team seit“, Teamwertung mit Quelle und Modus, Regeländerung ab Runde 5, Termin
// ohne Wertung, umgekehrte Startaufstellung; die abgebrochene Saison mit Nachfolger; in der Verwaltung Anpassungen,
// Saison abbrechen und die Teamwertung laut Veranstalter im Ergebnisblatt. Bei 1440 und 390 px ohne seitliches Scrollen.
// `SONDER_SHOTS` legt Bilder ab, `SONDER_PHASE=vorher` nur die Bilder der Serienseite (alter Stand). Nur erfundene Namen.

const SHOTS = process.env.SONDER_SHOTS || "";
const PHASE = process.env.SONDER_PHASE || "nachher";
const BOARD = { id: "vorstand-1", username: "vorstand", display_name: "Vorstand", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };

const ROUNDS = Array.from({ length: 6 }, (_, index) => ({
  id: `r${index + 1}`, position: index + 1, code: `R${index + 1}`, venue: ["Probering", "Testkurs", "Musterberg", "Probering", "Testkurs", "Musterberg"][index],
  club_day: `2026-10-${String(4 + index * 7).padStart(2, "0")}`, time: "20:30", kind: "regular", counts: true, weekend: index + 1,
  state: index < 4 ? "scored" : "planned", status: index < 4 ? "scored" : "planned",
}));
ROUNDS[2] = { ...ROUNDS[2], counts: false, state: "missing", status: "planned", no_score_reason: "too_few", no_score_note: "Nur fünf Fahrer am Start" };

const result = (round_id, place, points, extra = {}) => ({ round_id, place, points, marks: [], counted: true, dropped: false, ...extra });
const NAMES = ["Probe Lion Eins", "Fremd Eins", "Probe Lion Zwei", "Fremd Zwei", "Fremd Drei", "Fremd Vier"];
const KEYS = ["lion1", "ext1", "lion2", "ext2", "ext3", "ext4"];
const PENALTY = { points: -5, reason: "Nichtteilnahme nach Anmeldung", day: "2026-10-12", round_id: "r2" };
const VIDEO = { points: -5, reason: "Video fehlt", day: "2026-10-26", round_id: "r4" };
const PLACES = { r1: [1, 2, 3, 4, 5, 6], r2: [2, 1, 4, 3, 6, 5], r4: [1, 3, 2, 5, 4, 6] };
const SCHEME = [25, 18, 15, 12, 10, 8];
const ROWS = KEYS.map((key, index) => {
  const results = Object.entries(PLACES).map(([round, places]) => result(round, places[index], SCHEME[places[index] - 1], { grid: places[index] === 1 ? 1 : undefined }));
  const raw = results.reduce((sum, item) => sum + item.points, 0);
  const adjustments = key === "lion1" ? [PENALTY] : key === "ext2" ? [VIDEO] : [];
  const extra = adjustments.reduce((sum, item) => sum + item.points, 0);
  return {
    key, name: NAMES[index], name_hidden: false, club_member: key.startsWith("lion"), profile_slug: key.startsWith("lion") ? `probe-${key}` : null,
    points: raw + extra, computed_points: raw + extra, official_points: raw + extra, deviation: 0, adjustment_points: extra, adjustments, previous_rank: null, results,
  };
}).sort((a, b) => b.points - a.points).map((row, index) => ({ ...row, rank: index + 1 }));

const TEAMS = [
  { key: "Probe Löwen", team: "Probe Löwen", rank: 1, points: 120, computed_points: 116, official_points: 120, deviation: 4, previous_rank: 1, drivers: ["lion1", "lion2"], adjustments: [], adjustment_points: 0, results: [], driver_points: { lion1: 61, lion2: 55 } },
  { key: "Fremd Rot", team: "Fremd Rot", rank: 2, points: 104, computed_points: 104, official_points: 104, deviation: 0, previous_rank: 2, drivers: ["ext1", "ext2"], adjustments: [], adjustment_points: 0, results: [] },
  { key: "Fremd Blau", team: "Fremd Blau", rank: 3, points: 66, computed_points: 66, official_points: 66, deviation: 0, previous_rank: 3, drivers: ["ext3", "ext4"], adjustments: [], adjustment_points: 0, results: [] },
];

const WEEKEND = { formats: [
  { from_round: 1, sessions: [{ label: "Rennen", grid: "qualifying", counts: true, points: "series" }] },
  { from_round: 5, note: "Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge", sessions: [{ label: "Sprint", grid: "reverse_qualifying", reverse_top: 8, counts: true, points: [12, 9, 7, 6, 5, 4, 3, 2, 1] }, { label: "Rennen", grid: "reverse_standings_before_round", counts: true, points: "series" }] },
] };

const PAGE = {
  lineage: { title: "Probe Racing", slug: "probe-racing", kind: "racing", label: "F2", organizer: "Probe Liga", game_name: "Probe Rennspiel" },
  series: { season: "2026", tier: "F2", title: null, season_slug: "2026-f2", status: "active", weekend: WEEKEND },
  rules: { points_mode: "scheme", points_by_place: SCHEME, count_mode: "all", count_n: 0, final_top_n: null, tiebreakers: ["countback"], bonuses: { fastest_lap: { points: 0 }, pole: { points: 2 } }, activity_points: { points: 0, from_round: 1 } },
  successor: null,
  rule_changes: [{ kind: "format", from_round: 5, to_round: null, day: "2026-11-01", note: "Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge", sessions: ["Sprint", "Rennen"] }],
  today: "2026-10-30",
  progress: { total: 5, scored: 3, cancelled: 0, remaining: 2, next: ROUNDS[4] },
  rounds: ROUNDS,
  standings: { round_id: "r4", rows: ROWS },
  final: null,
  racing: {
    seasons: [{ season: "2026", tier: "F2", season_slug: "2026-f2", status: "active", current: true }, { season: "2026", tier: "F2 Altstart", season_slug: "2026-f2-alt", status: "cancelled", current: false }],
    team_scoring: { enabled: true, counting_drivers: 2, guests_count: true, mode: "current_lineup" },
    teams: { round_id: "r4", source: "official", rows: TEAMS },
    drivers: Object.fromEntries(KEYS.map((key, index) => [key, { team: index < 1 || index === 2 ? "Probe Löwen" : index < 4 ? "Fremd Rot" : "Fremd Blau", guest: false, team_since: key === "lion1" ? "r4" : null, round_teams: {} }])),
    club_teams: ["Probe Löwen"],
    club_drivers: ["lion1", "lion2"],
    qualifying: [],
  },
};

const CANCELLED = {
  ...PAGE,
  series: { ...PAGE.series, season_slug: "2026-f2-alt", tier: "F2 Altstart", status: "cancelled", cancelled_on: "2026-10-20", cancel_reason: "Neustart mit anderem Auto" },
  successor: { season: "2026", tier: "F2", title: null, season_slug: "2026-f2", status: "active", lineage_slug: "probe-racing", lineage_title: "Probe Racing" },
};

const ADMIN_SERIES = {
  id: "serie-1", lineage_id: "spur-1", season: "2026", tier: "F2", status: "active", rules_version: 2, rules_note: "Pole-Bonus 2 Punkte",
  rules: { ...PAGE.rules, dnf_points: 0, dns_points: 0, dsq_points: 0, team_scoring: { enabled: true, counting_drivers: 2, guests_count: true, mode: "current_lineup" }, match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: [], min_participants: 8 },
  weekend: WEEKEND, own_teams: [{ name: "Probe Löwen", aliases: [] }], team_name: "Probe Löwen", visibility: "public", publish_mode: "review",
  adjustments: [
    { id: "a1", kind: "participant", participant_id: "p-lion1", team: null, ...PENALTY },
    { id: "a2", kind: "participant", participant_id: "p-ext2", team: null, ...VIDEO },
    { id: "a3", kind: "team", participant_id: null, team: "Probe Löwen", points: 4, reason: "Korrektur laut Veranstalter", day: "2026-10-27", round_id: null },
  ],
  lineage: { id: "spur-1", title: "Probe Racing", kind: "racing", slug: "probe-racing" }, access: { role: "board", can_publish: true },
};
const PARTICIPANTS = KEYS.map((key, index) => ({ id: `p-${key}`, name: NAMES[index], default_team: index < 1 || index === 2 ? "Probe Löwen" : "Fremd Rot", link: key.startsWith("lion") ? "member" : "external", link_status: "decided" }));
const ADMIN_ROUNDS = ROUNDS.map((round) => ({ ...round, session: null }));

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const path of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${path}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", json(BOARD));
  await page.route("**/api/reference-series/public/probe-racing/2026-f2", json(PAGE));
  await page.route("**/api/reference-series/public/probe-racing/2026-f2-alt", json(CANCELLED));
  await page.route("**/api/reference-series/admin", json({ lineages: [{ ...ADMIN_SERIES.lineage, series: [ADMIN_SERIES, { id: "serie-2", season: "2026", tier: "F2 Neustart", status: "planned" }] }], points_schemes: [], default_rules: ADMIN_SERIES.rules }));
  await page.route("**/api/reference-series/admin/series/serie-1", json(ADMIN_SERIES));
  await page.route("**/api/reference-series/admin/series/serie-1/calendar", json({ version: 3, today: "2026-10-30", counts: {}, hints: [], archived: [], rounds: ADMIN_ROUNDS }));
  await page.route("**/api/reference-series/admin/series/serie-1/staff", json({ staff: [] }));
  await page.route("**/api/reference-series/admin/series/serie-1/close", json({ entries: [], current: null, candidates: [], cancelled: false, open_rounds: 2 }));
  await page.route("**/api/reference-series/admin/series/serie-1/participants", json({ participants: PARTICIPANTS, counts: { member: 2, guest: 0, external: 4, open: 0, club: 2 }, profiles: [] }));
  await page.route("**/api/reference-series/admin/series/serie-1/rounds/r4/results", json({
    round: ADMIN_ROUNDS[3], series: { kind: "racing", rules: ADMIN_SERIES.rules, own_teams: ["Probe Löwen"], team_name: "Probe Löwen" },
    access: { role: "board", can_publish: true }, version: 2, target: "sheet", participants: PARTICIPANTS,
    sheet: { status: "published", version: 2, rows: PARTICIPANTS.map((person, index) => ({ participant_id: person.id, place: index + 1, points_source: "scheme", marks: [] })), matches: [], official_table: [], official_totals: {}, official_team_totals: { "Probe Löwen": 120, "Fremd Rot": 104, "Fremd Blau": 66 } },
  }));
}

async function shot(locator, name, width) {
  if (!SHOTS) return;
  // Kopfleiste und Hinweise liegen sonst über dem Ausschnitt - nur für das Bild ausgeblendet.
  const style = await locator.page().addStyleTag({ content: "[data-sonner-toaster]{display:none!important} body > div header { visibility: hidden !important; }" });
  await locator.screenshot({ path: `${SHOTS}/${PHASE}-${name}-${width}.png`, animations: "disabled" });
  await style.evaluate((node) => node.remove());
}

async function noSidewaysScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`Serienseite mit Sonderregeln (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/references/series/probe-racing/2026-f2?fahrer=lion1");
    const drivers = page.getByTestId("racing-drivers");
    await expect(drivers).toBeVisible();
    await noSidewaysScroll(page);
    await shot(drivers, "fahrerwertung", width);
    await shot(page.getByTestId("racing-driver"), "fahrer-detail", width);
    await shot(page.getByTestId("racing-teams"), "teamwertung", width);
    await shot(page.getByTestId("racing-calendar"), "rennkalender", width);
    if (PHASE !== "nachher") return;
    await expect(drivers.getByTestId("series-rule-changes")).toContainText("Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge");
    await expect(drivers.getByTestId("racing-session-grid")).toContainText("Sprint: Start in umgekehrter Quali-Reihenfolge (Top 8)");
    await expect(drivers.getByTestId("series-adjustment").first()).toContainText("−5");
    await expect(page.getByTestId("racing-driver").getByTestId("series-adjustments")).toContainText("Nichtteilnahme nach Anmeldung · R2");
    await expect(page.getByTestId("racing-driver-team-since")).toContainText("im Team seit R4");
    await expect(page.getByTestId("racing-team-source")).toContainText("laut Veranstalter (nach R4)");
    await expect(page.getByTestId("racing-calendar").getByTestId("series-no-score")).toContainText("Ohne Wertung · Zu wenig Fahrer");
  });

  test(`abgebrochene Saison mit Nachfolger (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/references/series/probe-racing/2026-f2-alt");
    await expect(page.getByTestId("racing-drivers")).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page.getByTestId("series-page"), "abgebrochen", width);
    if (PHASE !== "nachher") return;
    await expect(page.getByTestId("series-cancelled")).toContainText("Saison abgebrochen am 20.10.2026 – Neustart mit anderem Auto");
    await expect(page.getByTestId("series-successor")).toHaveAttribute("href", "/references/series/probe-racing/2026-f2");
  });

  test(`Verwaltung: Anpassungen, Saison abbrechen, Teamwertung laut Veranstalter (${width} px)`, async ({ page }) => {
    test.skip(PHASE !== "nachher", "Neu mit #1960");
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/reference-series/serie-1");
    const section = page.getByTestId("series-adjustments-admin");
    await expect(section.getByTestId("adjustment-row")).toHaveCount(3);
    await expect(section.getByTestId("adjustment-row").first()).toContainText("Probe Lion Eins");
    await noSidewaysScroll(page);
    await shot(section, "verwaltung-anpassungen", width);
    await section.getByTestId("adjustment-new").click();
    const sheet = page.getByTestId("adjustment-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("adjustment-participant").selectOption("p-ext3");
    await sheet.getByTestId("adjustment-reason").fill("Verspätete Abmeldung");
    await shot(sheet, "verwaltung-anpassung-neu", width);
    await page.keyboard.press("Escape");

    await page.getByTestId("series-detail-edit").click();
    const form = page.getByTestId("series-sheet");
    await form.getByTestId("series-status").selectOption("cancelled");
    await form.getByTestId("series-cancel-reason").fill("Neustart mit anderem Auto");
    await form.getByTestId("series-successor").selectOption("serie-2");
    await expect(form.getByTestId("series-rules-team-mode")).toHaveValue("current_lineup");
    await shot(form.getByTestId("series-cancel-reason").locator("xpath=ancestor::div[contains(@class,'grid')][1]"), "verwaltung-abbrechen", width);
    await shot(form.getByTestId("series-weekend"), "verwaltung-ablauf-umgekehrt", width);
    await page.keyboard.press("Escape");

    await page.getByTestId("results-open").nth(3).click();
    const totals = page.getByTestId("result-team-totals");
    await expect(totals.getByTestId("result-team-total")).toHaveCount(3);
    await shot(totals, "verwaltung-teamwertung-veranstalter", width);
  });
}
