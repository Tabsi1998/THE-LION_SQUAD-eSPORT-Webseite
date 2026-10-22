const { test, expect } = require("@playwright/test");

// Fahrer-Anpassung auch in der Teamwertung (#2000) im echten Browser, Server nachgestellt: Teamwertung mit „−5 (Fahrer)“
// bei der Teamsumme, Fahrer-Detail „zählt auch fürs Team“, in der Verwaltung der Haken mit Hinweis je Modus, die Liste
// mit „als Ersatz gefahren“ und die Vorgabe in den Regeln der Saison. Bei 1440 und 390 px ohne seitliches Scrollen.
// `ANPASSUNG_SHOTS` legt Bilder ab, `ANPASSUNG_PHASE=vorher` nur die Bilder (alter Stand). Nur erfundene Namen.

const SHOTS = process.env.ANPASSUNG_SHOTS || "";
const PHASE = process.env.ANPASSUNG_PHASE || "nachher";
const BOARD = { id: "vorstand-1", username: "vorstand", display_name: "Vorstand", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };

const ROUNDS = [1, 2, 3, 4].map((number) => ({
  id: `r${number}`, position: number, code: `R${number}`, venue: ["Probering", "Testkurs", "Musterberg", "Probering"][number - 1],
  club_day: `2026-10-${String(4 + number * 7).padStart(2, "0")}`, time: "20:30", kind: "regular", counts: true, weekend: number,
  state: number < 4 ? "scored" : "planned", status: number < 4 ? "scored" : "planned",
}));
const result = (round_id, place, points) => ({ round_id, place, points, marks: [], counted: true, dropped: false });
const SCHEME = [25, 18, 15, 12, 10, 8];
const PEOPLE = [["lion1", "Probe Lion Eins"], ["ext1", "Fremd Eins"], ["lion2", "Probe Lion Zwei"], ["ext2", "Fremd Zwei"], ["ext3", "Fremd Drei"], ["ext4", "Fremd Vier"]];
const PLACES = { r1: [1, 2, 3, 4, 5, 6], r2: [2, 1, 4, 3, 6, 5], r3: [1, 3, 2, 5, 4, 6] };
const MINUS = { points: -5, reason: "WM-Abzug: Nichtteilnahme nach Anmeldung", day: "2026-10-18", round_id: "r2", counts_for_team: true, credited_team: "Probe Löwen" };
const SUBSTITUTE = { points: -3, reason: "Video fehlt", day: "2026-10-25", round_id: "r3", counts_for_team: true, team_note: "substitute" };
const ROWS = PEOPLE.map(([key, name], index) => {
  const results = Object.entries(PLACES).map(([round, places]) => result(round, places[index], SCHEME[places[index] - 1]));
  const adjustments = key === "lion1" ? [MINUS] : key === "ext2" ? [SUBSTITUTE] : [];
  const extra = adjustments.reduce((sum, item) => sum + item.points, 0);
  const points = results.reduce((sum, item) => sum + item.points, 0) + extra;
  return {
    key, name, name_hidden: false, club_member: key.startsWith("lion"), profile_slug: key.startsWith("lion") ? `probe-${key}` : null,
    points, computed_points: points, official_points: null, deviation: null, adjustment_points: extra, adjustments, previous_rank: null, results,
  };
}).sort((a, b) => b.points - a.points).map((row, index) => ({ ...row, rank: index + 1 }));

const team = (name, rank, points, drivers, extra = {}) => ({
  key: name, team: name, rank, points, computed_points: points, official_points: null, deviation: null, previous_rank: rank, drivers,
  adjustments: [], adjustment_points: 0, driver_adjustments: [], driver_adjustment_points: 0,
  results: ["r1", "r2", "r3"].map((round_id, index) => ({ round_id, points: [43, 33, 40][index], drivers })), ...extra,
});
const TEAMS = [
  team("Probe Löwen", 1, 111, ["lion1", "lion2"], { driver_adjustment_points: -5, driver_adjustments: [{ ...MINUS, driver: "lion1" }] }),
  team("Fremd Rot", 2, 104, ["ext1", "ext2"]),
  team("Fremd Blau", 3, 66, ["ext3", "ext4"]),
];

const PAGE = {
  lineage: { title: "Probe Racing", slug: "probe-racing", kind: "racing", label: "F1", organizer: "Probe Liga", game_name: "Probe Rennspiel" },
  series: { season: "2026", tier: "F1", title: null, season_slug: "2026-f1", status: "active" },
  rules: { points_mode: "scheme", points_by_place: SCHEME, count_mode: "all", count_n: 0, final_top_n: null, tiebreakers: ["countback"], bonuses: { fastest_lap: { points: 0 }, pole: { points: 0 } }, activity_points: { points: 0, from_round: 1 } },
  successor: null, rule_changes: [], today: "2026-10-30",
  progress: { total: 4, scored: 3, cancelled: 0, remaining: 1, next: ROUNDS[3] },
  rounds: ROUNDS, standings: { round_id: "r3", rows: ROWS }, final: null,
  racing: {
    seasons: [{ season: "2026", tier: "F1", season_slug: "2026-f1", status: "active", current: true }],
    team_scoring: { enabled: true, counting_drivers: 2, guests_count: true, mode: "per_race", adjustments_count_for_team: true },
    teams: { round_id: "r3", source: "computed", rows: TEAMS },
    drivers: Object.fromEntries(PEOPLE.map(([key], index) => [key, { team: index === 0 || index === 2 ? "Probe Löwen" : index < 4 ? "Fremd Rot" : "Fremd Blau", guest: false, team_since: null, round_teams: {} }])),
    club_teams: ["Probe Löwen"], club_drivers: ["lion1", "lion2"], qualifying: [],
  },
};

const RULES = { ...PAGE.rules, dnf_points: 0, dns_points: 0, dsq_points: 0, match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: [], min_participants: null,
  team_scoring: { enabled: true, counting_drivers: 2, guests_count: true, mode: "per_race", no_team_names: ["Ersatzfahrer"], adjustments_count_for_team: true } };
const ADMIN_SERIES = {
  id: "serie-1", lineage_id: "spur-1", season: "2026", tier: "F1", status: "active", rules_version: 1, rules: RULES,
  own_teams: [{ name: "Probe Löwen", aliases: [] }], team_name: "Probe Löwen", visibility: "public", publish_mode: "review",
  adjustments: [
    { id: "a1", kind: "participant", participant_id: "p-lion1", team: null, ...MINUS },
    { id: "a2", kind: "participant", participant_id: "p-ext2", team: null, ...SUBSTITUTE },
    { id: "a3", kind: "team", participant_id: null, team: "Fremd Blau", points: 4, reason: "Korrektur laut Veranstalter", day: "2026-10-27", round_id: null },
  ],
  adjustment_teams: { a1: { team: "Probe Löwen", note: null }, a2: { team: null, note: "substitute" } },
  lineage: { id: "spur-1", title: "Probe Racing", kind: "racing", slug: "probe-racing" }, access: { role: "board", can_publish: true },
};
const PARTICIPANTS = PEOPLE.map(([key, name], index) => ({ id: `p-${key}`, name, default_team: index === 0 || index === 2 ? "Probe Löwen" : "Fremd Rot", link: key.startsWith("lion") ? "member" : "external", link_status: "decided" }));

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
  await page.route("**/api/reference-series/public/probe-racing/2026-f1", json(PAGE));
  await page.route("**/api/reference-series/admin", json({ lineages: [{ ...ADMIN_SERIES.lineage, series: [ADMIN_SERIES] }], points_schemes: [], default_rules: RULES }));
  await page.route("**/api/reference-series/admin/series/serie-1", json(ADMIN_SERIES));
  await page.route("**/api/reference-series/admin/series/serie-1/calendar", json({ version: 3, today: "2026-10-30", counts: {}, hints: [], archived: [], rounds: ROUNDS.map((round) => ({ ...round, session: null })) }));
  await page.route("**/api/reference-series/admin/series/serie-1/staff", json({ staff: [] }));
  await page.route("**/api/reference-series/admin/series/serie-1/close", json({ entries: [], current: null, candidates: [], cancelled: false, open_rounds: 1 }));
  await page.route("**/api/reference-series/admin/series/serie-1/participants", json({ participants: PARTICIPANTS, counts: { member: 2, guest: 0, external: 4, open: 0, club: 2 }, profiles: [] }));
}

async function shot(locator, name, width) {
  if (!SHOTS) return;
  // Punkte zählen beim ersten Sichtbarwerden hoch (#1969) - erst danach das Bild.
  await locator.scrollIntoViewIfNeeded();
  await locator.page().waitForTimeout(1500);
  const style = await locator.page().addStyleTag({ content: "[data-sonner-toaster]{display:none!important} body > div header { visibility: hidden !important; }" });
  await locator.screenshot({ path: `${SHOTS}/${PHASE}-${name}-${width}.png`, animations: "disabled" });
  await style.evaluate((node) => node.remove());
}

async function noSidewaysScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`Serienseite: Fahrer-Anpassung bei der Teamsumme und im Fahrer-Detail (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/references/series/probe-racing/2026-f1?fahrer=lion1");
    const teams = page.getByTestId("racing-teams");
    await expect(teams).toBeVisible();
    await noSidewaysScroll(page);
    await shot(teams, "teamwertung", width);
    await shot(page.getByTestId("racing-driver"), "fahrer-detail", width);
    if (PHASE !== "nachher") return;
    // Tabelle (breit) und Karten (Handy) stehen beide im Dokument - gezählt wird, was sichtbar ist.
    const mark = teams.locator("[data-testid=\"racing-driver-adjustment\"]:visible");
    await expect(mark).toContainText("−5 (Probe Lion Eins)");
    await expect(mark).toHaveAttribute("title", /WM-Abzug: Nichtteilnahme nach Anmeldung · R2 · 18\.10\.2026 – Probe Lion Eins, zählt auch fürs Team/);
    await expect(page.getByTestId("racing-driver").getByTestId("series-adjustment-team")).toHaveText("zählt auch fürs Team · Probe Löwen");
  });

  test(`Verwaltung: Haken „zählt auch für die Teamwertung“ mit Hinweis und Vorgabe der Saison (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/admin/reference-series/serie-1");
    const section = page.getByTestId("series-adjustments-admin");
    await expect(section.getByTestId("adjustment-row")).toHaveCount(3);
    await expect(section.getByTestId("adjustment-row").first()).toContainText("Probe Lion Eins");
    await noSidewaysScroll(page);
    await shot(section, "verwaltung-anpassungen", width);
    if (PHASE !== "nachher") return;
    await expect(section.getByTestId("adjustment-team-note")).toHaveText(["zählt auch fürs Team · Probe Löwen", "zählt für kein Team – im Termin als Ersatz gefahren"]);
    await section.getByTestId("adjustment-new").click();
    const sheet = page.getByTestId("adjustment-sheet");
    await expect(sheet.getByTestId("adjustment-counts-for-team")).toBeChecked();
    await sheet.getByTestId("adjustment-participant").selectOption("p-ext3");
    await sheet.getByTestId("adjustment-reason").fill("Verspätete Abmeldung");
    await noSidewaysScroll(page);
    await shot(sheet, "verwaltung-anpassung-neu", width);
    await page.keyboard.press("Escape");

    await page.getByTestId("series-detail-edit").click();
    const box = page.getByTestId("series-rules-team-adjustments");
    await expect(box).toBeChecked();
    await shot(page.getByTestId("series-rules-team-section"), "verwaltung-regeln-teamwertung", width);
  });
}
