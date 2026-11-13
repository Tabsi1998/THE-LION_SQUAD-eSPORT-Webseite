const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Season-Seite (#2268) mit schlimmsten, aber echten Daten - Server nachgestellt: lange Liga-, Modus- und Teamnamen, Best of 7 mit
// sieben Maps in der Reihenfolge, ein Modus ohne Symbol und ohne Regel, ein Pool mit einer Map ohne Bild und einer mit neun, drei
// Ligen mit bis zu fünf Staffeln, zwölf Spielwochen, Teams ohne Logo, „1 Team“ und „1 Sperre“. Bei 390 und 1440 px: nichts schiebt
// die Seite zur Seite, Wischflächen bleiben in ihrem Bereich, nichts Wichtiges ist abgeschnitten. Nur erfundene Namen.
// SHOTS=<Ordner> legt Bilder zum Ansehen ab (nicht im Repo).

const SHOTS = process.env.SEASON_SHOTS || "";
const LONG_TEAM = "Donaustädter Wolkenkratzerkletterverein · Zweite Mannschaft der Abendrunde";
const MODES = [
  { mode: "hp", label: "Hardpoint", icon_url: null },
  { mode: "snd", label: "Suchen & Zerstören (Hardcore, Ranked)" },
  { mode: "ctl", label: "Kontrolle" },
  { mode: "neu", label: "Neuer Modus ohne Regel" },
];
const map = (index) => ({ map_id: `m${index}`, name: index === 3 ? "Großglockner-Hochalpenstraße Nordrampe" : `Map ${index}`, image_url: null });
const SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Tiroler Unterland Amateur-eSport-Liga", game: { name: "Call of Duty: Black Ops 7", modes: MODES } },
  season: {
    name: "Season 12 Winter", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-02-01T22:59:59+00:00",
    matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 7, team_size: 4, weeks_total: 12,
    round_robin_legs: 2, map_repeat: "always", result_confirm_hours: 1,
    game_mode_order: ["hp", "snd", "ctl", "hp", "snd", "ctl", "neu"],
    match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["head_to_head", "score_diff", "score_for", "wins", "lead_decision"],
    result_rules: { hp: { kind: "score", target: 250, time_limit_seconds: 600, overtime: true, draw_allowed: true },
      snd: { kind: "rounds", target: 6, round_limit: 11, round_time_seconds: 90 }, ctl: { kind: "highest" } },
    schedule_rules: { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 1, reschedule_max: 1, reschedule_same_week: false },
    blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachts- und Neujahrspause" }],
  },
  look: { emblem_url: null, banner: null, accent_color: null },
  rules: { version: 14, label: "Version 14", valid_from: "2026-11-03", url: "/liga/probe-liga/season-1/regeln", pdf_url: "/api/x.pdf" },
  map_pool: { id: "p1", modes: [
    { mode: "hp", label: "Hardpoint", maps: Array.from({ length: 9 }, (_, index) => map(index + 1)) },
    { mode: "snd", label: "Suchen & Zerstören (Hardcore, Ranked)", maps: [map(20)] },
  ] },
  loadout_bans: { entries: [{ kind: "item", item_id: "w1", name: "Präzisionsschützengewehr „Habicht 7“ mit Wärmebild", category_label: "Waffen", image_url: null, mode_labels: ["Suchen & Zerstören (Hardcore, Ranked)"] }] },
  platform: { allowed: ["PC", "PlayStation 5", "Xbox Series X|S"], crossplay: true, input_device: "both" },
  divisions: [
    { id: "d1", level: 1, label: "Liga 1 · Elite der Bezirksmeister", staffeln: [{ tournament_id: "t1", slug: "a", staffel: "A", status: "live" }] },
    { id: "d2", level: 2, label: "Liga 2", staffeln: ["A", "B", "C", "D", "E"].map((letter) => ({ tournament_id: `t2${letter}`, slug: `l2-${letter}`, staffel: letter, status: "live" })) },
    { id: "d3", level: 3, label: "Liga 3", staffeln: [] },
  ],
};
const TEAMS = [LONG_TEAM, "Jo", "Wölfe · Wölfe 2", "Adler · Adler A", "Luchse · Luchse B", "Füchse · Füchse A"];
const reg = (index) => ({ registration_id: `r${index}`, name: TEAMS[index - 1], team_id: index === 2 ? null : `team-${index}` });
const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset)).toISOString().slice(0, 10);
const weeks = Array.from({ length: 12 }, (_, index) => {
  const number = index + 1;
  const base = { week: number, first_day: day(index * 7), last_day: day(index * 7 + 6) };
  if (number === 7 || number === 8) return { ...base, kind: "pause", label: "Weihnachts- und Neujahrspause", matches: [] };
  if (number === 12) return { ...base, kind: "reserve", matchday: 10, label: "Reserve", matches: [] };
  const matchday = number > 8 ? number - 2 : number;
  return { ...base, kind: "matchday", matchday, label: `Spieltag ${matchday}`, matches: [[1, 2], [3, 4], [5, 6]].map(([a, b], pair) => {
    const done = matchday === 1;
    return { id: `m${matchday}-${pair}`, matchday, done, status: done ? "completed" : "scheduled", forfeit: done && pair === 2,
      contested: done && pair === 1, in_clarification: !done && pair === 0 && matchday === 2,
      scheduled_at: done ? null : `${day(index * 7 + 5)}T19:00:00+00:00`, schedule_source: "accepted",
      home: { ...reg(a), score: done ? 4 : null }, away: { ...reg(b), score: done ? 3 : null }, winner_registration_id: done ? `r${a}` : null,
      games: done && pair !== 2 ? Array.from({ length: 7 }, (_, position) => ({ position: position + 1, mode: SEASON.season.game_mode_order[position],
        mode_label: MODES.find((row) => row.mode === SEASON.season.game_mode_order[position]).label, map_name: position === 2 ? "Großglockner-Hochalpenstraße Nordrampe" : `Map ${position + 1}`,
        winner_registration_id: position % 2 ? `r${b}` : `r${a}`, ...(position === 1 ? { status: "replayed" } : {}) })) : [] };
  }) };
});
const STAFFEL = {
  staffel: { staffel: "A", division_label: "Liga 1", table_rules: { tiebreakers: SEASON.season.table_tiebreakers } }, current: 2, weeks,
  standings: TEAMS.map((name, index) => ({ registration_id: `r${index + 1}`, rank: index + 1, display_name: name, played: 1, won: 1, drawn: 0,
    lost: 0, points: 1284 - index, score_for: 4, score_against: 3, score_diff: 1, form: ["W", "L", "W", "W", "L"] })),
  teams: TEAMS.map((name, index) => ({ id: `r${index + 1}`, display_name: name, team_id: index === 1 ? null : `team-${index + 1}`, logo_url: null })),
};
const ONE_TEAM = { ...STAFFEL, teams: STAFFEL.teams.slice(0, 1), standings: STAFFEL.standings.slice(0, 1), weeks: [] };

async function mockServer(page, season = SEASON) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/leagues/probe-liga/season-1", json(season));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", (route) => json(route.request().url().endsWith("/t2E") ? ONE_TEAM : STAFFEL)(route));
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Durchscrollen: gestaffelte Teile erscheinen erst, wenn sie sichtbar werden - wie beim Lesen.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`Season-Seite (${width} px): lange Namen, Best of 7, viele Staffeln - nichts schiebt die Seite`, async ({ page }) => {
    test.skip(test.info().project.name !== "chromium", "Größe stellt der Test selbst ein");
    await page.setViewportSize({ width, height });
    await mockServer(page);
    await page.goto("/liga/probe-liga/season-1");
    await expect(page.getByTestId("season-map-order").getByRole("listitem")).toHaveCount(7);
    await expect(page.getByTestId("season-mode-neu-rule")).toHaveText("Regel steht im Regelwerk");
    await expect(page.getByTestId("season-bans-toggle")).toContainText("1 Sperre");
    await expect(page.getByTestId("league-staffel-A").first()).toBeVisible();
    await expect(page.getByTestId("league-division-2").getByRole("tab")).toHaveCount(5);
    await page.getByTestId("league-division-2").getByTestId("league-staffel-tab-E").click();
    await expect(page.getByTestId("league-division-2").getByTestId("league-teams-link-E")).toHaveText(/1 Team\b/);
    await expect(page.getByTestId("league-division-3")).toContainText("werden gerade eingeteilt");
    // Map-Pool: ab 1024 px vier Karten in einer Zeile (bei vier Maps steht keine allein), am Handy eine wischbare Reihe.
    const cards = page.getByTestId("league-map-pool").getByTestId("map-pool-mode").first().getByTestId("map-card");
    // Lage der Listeneinträge (ohne die Bewegung beim Einblenden).
    const tops = await cards.evaluateAll((nodes) => nodes.slice(0, 5).map((node) => node.parentElement.offsetTop));
    expect(new Set(tops.slice(0, 4)).size).toBe(1);
    if (width >= 1024) expect(tops[4]).toBeGreaterThan(tops[0]);
    await noSideScroll(page);
    await shot(page, `worst-uebersicht-${width}.png`);

    await page.goto("/liga/probe-liga/season-1/spieltage?staffel=a&woche=1");
    const panel = page.getByTestId("league-weekpanel-1");
    await expect(panel.getByTestId("league-match-m1-0")).toContainText("4 : 3");
    await expect(panel.getByTestId("league-match-m1-2")).toContainText("kampflos");
    await expect(panel.getByTestId("league-match-m1-1-contested")).toBeVisible();
    // Die Namen bleiben im Spiel: abgeschnitten mit vollem Namen als Titel, der Stand dazwischen bleibt ganz.
    // Namen ganz lesbar (#2268): kein Abschneiden, kein Kürzen auf zwei Zeilen; am Handy fällt nur ein doppelt genanntes Hauptteam weg.
    const names = await panel.locator(".tls-league-match__name").evaluateAll((nodes) => nodes.map((node) => ({
      clipped: node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
      clamp: getComputedStyle(node).webkitLineClamp, text: node.innerText })));
    expect(names.filter((row) => row.clipped || (row.clamp && row.clamp !== "none"))).toEqual([]);
    expect(names.some((row) => row.text.includes("Abendrunde"))).toBe(true);
    const winners = await panel.locator("[data-testid$='-winner']").evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length);
    expect(winners).toBe(0);
    const score = await panel.getByTestId("league-match-m1-0").locator(".tls-league-match__score").boundingBox();
    expect(score.width).toBeGreaterThan(40);
    await noSideScroll(page);
    await shot(page, `worst-spieltage-${width}.png`);

    await page.goto("/liga/probe-liga/season-1/teams");
    await expect(page.getByTestId("season-teams-a").getByTestId("season-team-r1")).toContainText("Wolkenkratzerkletterverein");
    await noSideScroll(page);
    await shot(page, `worst-teams-${width}.png`);
  });
}
