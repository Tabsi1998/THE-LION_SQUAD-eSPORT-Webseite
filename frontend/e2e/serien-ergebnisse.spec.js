const { test, expect } = require("@playwright/test");

// Ergebnisse eintragen (#1744) im echten Browser, Server nachgestellt: Saison öffnen → „Ergebnis eintragen“ → Liste
// einfügen → Vorschau mit Meldung an der Zeile und neuem Stand → Veröffentlichen. Bei 390 px ohne seitliches Scrollen.
// Die Abnahme gegen den echten Server steht in e2e/abnahme/serien-ergebnisse-abnahme.spec.js. Nur erfundene Namen.

const BOARD = { id: "vorstand-1", username: "vorstand", display_name: "Vorstand", role: "club_admin", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true };
const SERIES = {
  id: "serie-1", season: "2026", stage: "Division 1", status: "running", rules_version: 1,
  rules: { points_mode: "scheme", points_by_place: [25, 18, 15, 12], count_mode: "all", final_top_n: 2, tiebreakers: [] },
  lineage: { id: "spur-1", title: "Probe Racing F1", kind: "racing" }, access: { role: "board", can_publish: true },
};
const CALENDAR = {
  version: 2, today: "2026-10-20", counts: { missing: 1, planned: 1 }, hints: [], archived: [],
  rounds: [
    { id: "r1", code: "R1", club_day: "2026-10-15", time: "20:30", venue: "Probering", status: "planned", state: "missing", counts: true, kind: "regular" },
    { id: "r2", code: "R2", club_day: "2026-10-29", time: "20:30", venue: "Teststadt", status: "planned", state: "planned", counts: true, kind: "regular" },
  ],
};
const RESULTS = {
  round: { id: "r1", code: "R1", club_day: "2026-10-15", time: "20:30", venue: "Probering" },
  series: { id: "serie-1", kind: "racing", team_name: "Probe Lions", rules: SERIES.rules },
  access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet",
  participants: [
    { id: "p1", name: "Alpha Probe", start_number: "7", default_team: "Probe Lions" },
    { id: "p2", name: "Beta Test", start_number: "12", default_team: "Test GP" },
  ],
};
const PREVIEW = {
  version: 0, target: "sheet", can_save: true, errors: [],
  warnings: [{ code: "points_mismatch", message: "Punkte 20 passen nicht zum Schlüssel (18).", rows: [1] }],
  rows: [
    { index: 0, participant_id: "p1", scored: { points: 26, base: 25, bonus: 1, penalty: 0 } },
    { index: 1, participant_id: "p2", scored: { points: 18, base: 18, bonus: 0, penalty: 0 } },
    { index: 2, participant_id: "neu:gamma", scored: { points: 0, base: 0, bonus: 0, penalty: 0 } },
  ],
  unknown_names: [{ participant_id: "neu:gamma", name: "Gamma Muster", alias: null, suggestions: [{ target: "member", profile_id: "m1", label: "Gamma", reason: "Spiel-ID passt" }] }],
  club_members: [{ participant_id: "p1", name: "Alpha Probe", profile_name: "Alpha" }],
  standings: { round_seq: 1, scopes: { drivers: [
    { participant_id: "p1", name: "Alpha Probe", rank: 1, rank_change: null, points: 26, is_club_member: true },
    { participant_id: "p2", name: "Beta Test", rank: 2, rank_change: null, points: 18 },
    { participant_id: "neu:gamma", name: "Gamma Muster", rank: 3, rank_change: null, points: 0, is_new: true },
  ] } },
  final: { top_n: 2, participant_ids: ["p1", "p2"], entered: [], left: [] }, latest: null,
};

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
  await page.route("**/api/reference-series/admin/series/serie-1", json(SERIES));
  await page.route("**/api/reference-series/admin/series/serie-1/calendar", json(CALENDAR));
  const saved = [];
  await page.route("**/api/reference-series/admin/series/serie-1/rounds/r1/results", (route) => {
    if (route.request().method() === "PUT") {
      saved.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ target: "sheet", version: 1, created_participants: [], warnings: [] }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(RESULTS) });
  });
  await page.route("**/api/reference-series/admin/series/serie-1/rounds/r1/results/preview", json(PREVIEW));
  return saved;
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Ergebnis eintragen (${width} px): Liste einfügen, Vorschau, veröffentlichen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const saved = await mockServer(page);
    await page.goto("/admin/reference-series/serie-1");
    const round = page.getByTestId("results-round").filter({ hasText: "R1" });
    await round.getByTestId("results-open").click();
    const sheet = page.getByTestId("result-sheet");
    await expect(sheet).toBeVisible();

    await sheet.getByTestId("result-paste-toggle").click();
    await sheet.getByTestId("result-paste-text").fill("1. Alpha Probe 25 FL\n2. Beta Test 20\n3. Gamma Muster DNF");
    await sheet.getByTestId("result-paste-apply").click();
    await expect(sheet.getByTestId("result-preview")).toBeVisible();
    await expect(sheet.getByTestId("result-row")).toHaveCount(3);
    await expect(sheet.getByTestId("result-row").nth(1).getByTestId("result-row-problems")).toContainText("passen nicht zum Schlüssel");
    await expect(sheet.getByTestId("preview-standing-row")).toHaveCount(3);
    await expect(sheet.getByTestId("preview-unknown")).toContainText("Gamma Muster");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.getByTestId("result-submit")).toHaveText("Veröffentlichen");
    await page.getByTestId("result-submit").click();
    await expect(sheet).toHaveCount(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ status: "published", expected_version: 0 });
    expect(saved[0].rows.map((row) => row.marks)).toEqual([["fastest_lap"], [], ["dnf"]]);
  });
}
