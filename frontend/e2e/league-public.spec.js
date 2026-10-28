const { test, expect } = require("@playwright/test");

// Ligaseite (docs/LIGA.md, P5, #1625) im echten Browser, Server nachgestellt: Übersicht, Season mit Kopf, Staffel mit
// Tabelle, Spielwochen (Pause sichtbar), Ergebnis mit Maps; „Liga“ im Menü. Bei 390 und 1440 px ohne seitliches
// Scrollen - die Tabelle scrollt in ihrem eigenen Bereich. Nur erfundene Namen.

const LEAGUES = { leagues: [{ id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" },
  seasons: [{ id: "s1", slug: "season-1", name: "Season 1", status: "active", start_date: "2026-11-09T23:00:00+00:00" }] }] };
const SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga mit langem Namen", game: { name: "Probe Shooter" } },
  season: {
    name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00",
    matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4,
    match_points: { win: 3, draw: 1, loss: 0 }, rules_text: "## Fairplay\n- Pünktlich sein\n- Kein Cheaten", registration_deadline: "2026-11-06",
    blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
  },
  map_pool: { id: "p1", modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [
    { map_id: "m1", name: "Hafenkante", image_url: null }, { map_id: "m2", name: "Nebelwerk", image_url: null }] }] },
  divisions: [{ id: "d1", level: 1, label: "Liga 1 · Elite", staffeln: [
    { tournament_id: "t1", slug: "probe-a", staffel: "A" }, { tournament_id: "t2", slug: "probe-b", staffel: "B" }] }],
};
const TEAMS = ["Löwen · Löwen Nachwuchs B", "Falken · Falken A", "Bären · Bären Rot", "Wölfe · Wölfe 2", "Adler · Adler A", "Luchse · Luchse B", "Füchse · Füchse A", "Raben · Raben Schwarz"];
const reg = (index) => ({ registration_id: `r${index}`, name: TEAMS[index - 1], team_id: `team-${index}` });
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const weeks = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1;
  const base = { week: number, first_day: day(index * 7), last_day: day(index * 7 + 6) };
  if (number === 7 || number === 8) return { ...base, kind: "pause", label: "Weihnachtspause", matches: [] };
  const matchday = number > 8 ? number - 2 : number;
  if (matchday > 7) return { ...base, kind: "reserve", matchday, label: "Reserve", matches: [] };
  return { ...base, kind: "matchday", matchday, label: `Spieltag ${matchday}`, matches: [1, 2, 3, 4].map((pair) => {
    const home = reg(pair);
    const away = reg(9 - pair);
    const done = matchday === 1;
    return { id: `m${matchday}-${pair}`, matchday, done, status: done ? "completed" : "scheduled",
      scheduled_at: done ? null : `${day(index * 7 + 5)}T19:00:00+00:00`, schedule_source: "default",
      home: { ...home, score: done ? 2 : null }, away: { ...away, score: done ? 1 : null },
      winner_registration_id: done ? home.registration_id : null,
      games: done ? [{ position: 1, map_name: "Hafenkante", winner_registration_id: home.registration_id },
        { position: 2, map_name: "Nebelwerk", winner_registration_id: away.registration_id },
        { position: 3, map_name: "Hafenkante", winner_registration_id: home.registration_id }] : [] };
  }) };
});
const STAFFEL = {
  staffel: { staffel: "A", division_label: "Liga 1 · Elite" }, current: 2, weeks,
  standings: TEAMS.map((name, index) => ({ registration_id: `r${index + 1}`, rank: index + 1, display_name: name, played: 1,
    won: index < 4 ? 1 : 0, drawn: 0, lost: index < 4 ? 0 : 1, points: index < 4 ? 3 : 0, score_for: index < 4 ? 2 : 1,
    score_against: index < 4 ? 1 : 2, score_diff: index < 4 ? 1 : -1, form: [index < 4 ? "W" : "L"] })),
  teams: TEAMS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, team_id: `team-${index + 1}` })),
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
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues", json(LEAGUES));
  await page.route("**/api/leagues/probe-liga/season-1", json(SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(STAFFEL));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Liga-Übersicht (${width} px): Seasons, die man sehen darf`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Liga");
    await expect(page.getByTestId("league-index-season-season-1")).toHaveAttribute("href", "/liga/probe-liga/season-1");
    await noSideScroll(page);
  });

  test(`Ligaseite (${width} px): Kopf, Tabelle, Spielwochen mit Pause, Ergebnis mit Maps`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe-liga/season-1");
    await expect(page.getByTestId("league-fact-breaks")).toContainText("Weihnachtspause 21.12.–3.1.");
    const staffel = page.getByTestId("league-staffel-A");
    await expect(staffel.getByTestId("standing-row-r1")).toContainText("Löwen · Löwen Nachwuchs B");
    await expect(staffel.getByTestId("league-week-7")).toContainText("Weihnachtspause");
    await expect(staffel.getByTestId("league-match-m2-1")).toBeVisible();
    await staffel.getByTestId("league-week-1").getByRole("button").click();
    await expect(staffel.getByTestId("league-match-m1-1")).toContainText("2 : 1");
    await expect(staffel.getByTestId("league-match-m1-1")).toContainText("Nebelwerk");
    await noSideScroll(page);
  });
}
