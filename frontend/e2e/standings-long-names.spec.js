const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fixture = require("./fixtures/tableScheduleGenerated.json");

// Lange Teamnamen in allen Tabellen mit der Rangliste (#2498): Turnier-Rangliste, Ligaseite (Staffel) und Serienseite
// einer Team-Liga. Bei 320, 390 und 1440 px bricht ein Name nur an Leerzeichen, Bindestrich, Punkt oder Unterstrich um -
// mitten im Wort nur, wenn das Wort allein breiter ist als die Spalte; nichts ist abgeschnitten, die Seite schiebt nicht
// seitlich, und Name und Punkte stehen ohne Wischen nebeneinander. Mit SHOTS_2498=<Ordner> entstehen Bilder für Fabian.
// Nur erfundene Namen.

const SHOTS = process.env.SHOTS_2498 || "";
const STAGE = process.env.SHOTS_2498_STAGE || "nachher";

const NAMES = [
  "Wolkenkratzer-Sturmfalken Ostalpen · Zweite Mannschaft Reserve",
  "Donaudampfschifffahrtsgesellschaft Esports",
  "xX_Nebelwolf_Xx.Rudel.Ostmark",
  "Grenzlandfalken Südsteiermark · Akademie",
  "Eisbären Nord · Eisbären B",
  "Bergdohlen · Schwarm",
  "Löwen",
  "Raben",
];

async function consent(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
}

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

async function baseRoutes(page) {
  await consent(page);
  await page.route("**/api/**", json({}));
  for (const part of ["sponsors**", "notifications/me", "games", "partners", "streams", "teams/my", "achievements/me"]) await page.route(`**/api/${part}`, json([]));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/settings/public", json({ club_name: "THE LION SQUAD" }));
}

// Turnier-Rangliste: die Liga aus dem erzeugten Fixture, die Namen ersetzt.
async function tournamentPage(page) {
  await baseRoutes(page);
  const set = fixture.league;
  const standings = set.standings.map((row, index) => ({ ...row, display_name: NAMES[index] }));
  const base = `/api/tournaments/${set.tournament.id}`;
  await page.route(`**/api/tournaments/${set.tournament.slug}`, json(set.tournament));
  await page.route(`**${base}`, json(set.tournament));
  await page.route(`**${base}/bracket`, json(set.bracket));
  await page.route(`**${base}/standings`, json(standings));
  await page.route(`**${base}/matchdays`, json(set.matchdays || { applies: false, matchdays: [] }));
  await page.route(`**${base}/registrations`, json(set.bracket?.registrations || []));
  await page.goto(`/tournaments/${set.tournament.slug}/standings`);
  return page.locator(".tls-standings").first();
}

// Ligaseite mit einer Staffel (wie league-public.spec.js).
const SEASON = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: {
    name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00",
    matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4,
    match_points: { win: 3, draw: 1, loss: 0 }, rules_text: "", registration_deadline: "2026-11-06", blocked_periods: [],
  },
  map_pool: null,
  divisions: [{ id: "d1", level: 1, label: "Liga 1 · Elite", staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A" }] }],
};
const STAFFEL = {
  staffel: { staffel: "A", division_label: "Liga 1 · Elite" }, current: 1, weeks: [],
  standings: NAMES.map((name, index) => ({ registration_id: `r${index + 1}`, rank: index + 1, display_name: name, played: 3,
    won: 3 - Math.min(3, index), drawn: 0, lost: Math.min(3, index), points: 9 - 3 * Math.min(3, index), score_for: 6, score_against: 3,
    score_diff: 3 - index, form: ["W", "L", "W"] })),
  teams: NAMES.map((name, index) => ({ id: `r${index + 1}`, display_name: name, team_id: `team-${index + 1}` })),
};

async function leaguePage(page) {
  await baseRoutes(page);
  await page.route("**/api/leagues", json({ leagues: [] }));
  await page.route("**/api/leagues/probe-liga/season-1", json(SEASON));
  await page.route("**/api/leagues/probe-liga/season-1/staffeln/**", json(STAFFEL));
  await page.goto("/liga/probe-liga/season-1");
  return page.getByTestId("league-staffel-A").locator(".tls-standings");
}

// Serienseite einer Team-Liga (wie ReferenceSeriesTeamLeague.test.jsx).
const ROUNDS = [
  { id: "r1", position: 1, code: "ST1", club_day: "2026-11-02", time: "20:00", state: "scored", kind: "regular", counts: true, opponent: NAMES[1] },
  { id: "r2", position: 2, code: "ST2", club_day: "2026-11-09", time: "20:00", state: "scored", kind: "regular", counts: true, opponent: NAMES[0] },
];
const SERIES = {
  lineage: { title: "Probe Liga", slug: "probe-liga", kind: "team_league", label: "4vs4", organizer: "Probe Verband", game_name: "Probespiel" },
  series: { season: "2026", tier: "Division 1", title: null, season_slug: "2026-division-1", status: "active" },
  rules: {}, today: "2026-11-20", progress: { total: 2, scored: 2, cancelled: 0, remaining: 0, next: null }, rounds: ROUNDS,
  standings: null, final: null,
  team_league: {
    team_name: NAMES[2],
    rules: { match_points: { win: 2, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "wins"] },
    table: { round_id: "r2", rows: NAMES.map((name, index) => ({ key: name, team: name, rank: index + 1, previous_rank: null, played: 2,
      won: index < 3 ? 2 : 0, drawn: 0, lost: index < 3 ? 0 : 2, score_for: 6, score_against: 2, score_diff: 4 - index, points: index < 3 ? 4 : 0,
      own: index === 2, form: ["W", "L"] })) },
    rank_history: [], matchdays: [], lineup: { round_ids: [], players: [] }, path: [],
  },
};

async function seriesPage(page) {
  await baseRoutes(page);
  await page.route("**/api/reference-series/public/probe-liga/2026-division-1", json(SERIES));
  await page.goto("/references/series/probe-liga/2026-division-1");
  return page.getByTestId("team-league-table-wrap").locator(".tls-standings");
}

// Bricht der Name mitten in einem Wort um, das allein in die Spalte passte? Gibt solche Wörter zurück.
function badBreaks(name) {
  const chars = [];
  const walker = document.createTreeWalker(name, document.defaultView.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (let index = 0; index < node.data.length; index += 1) chars.push({ node, index, ch: node.data[index] });
  }
  const range = document.createRange();
  const rectOf = (from, to = from) => {
    range.setStart(chars[from].node, chars[from].index);
    range.setEnd(chars[to].node, chars[to].index + 1);
    return range.getBoundingClientRect();
  };
  const soft = (ch) => " -._/·".includes(ch);
  const bad = [];
  let previousTop = null;
  for (let at = 0; at < chars.length; at += 1) {
    if (chars[at].ch === " ") continue;
    const { top } = rectOf(at);
    if (previousTop !== null && top > previousTop + 2 && !soft(chars[at - 1].ch)) {
      let start = at;
      while (start > 0 && !soft(chars[start - 1].ch)) start -= 1;
      let end = at;
      while (end < chars.length - 1 && !soft(chars[end + 1].ch)) end += 1;
      const word = chars.slice(start, end + 1).map((item) => item.ch).join("");
      // Breiter als die Spalte: dann darf (und muss) es im Wort brechen. Gemessen in einer Zeile.
      const probe = document.createElement("span");
      probe.textContent = word;
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
      name.appendChild(probe);
      const wide = probe.getBoundingClientRect().width > name.clientWidth + 1;
      probe.remove();
      if (!wide) bad.push(word);
    }
    previousTop = top;
  }
  return bad;
}

const PAGES = [
  { key: "turnier-rangliste", open: tournamentPage },
  { key: "liga-staffel", open: leaguePage },
  { key: "serie-teamliga", open: seriesPage },
];

for (const { key, open } of PAGES) {
  for (const [width, height] of [[320, 740], [390, 844], [1440, 900]]) {
    test(`${key} (${width} px): lange Namen brechen an Wortgrenzen, Name und Punkte ohne Wischen (#2498)`, async ({ page }, info) => {
      test.skip(info.project.name !== "chromium", "Breiten werden hier selbst gesetzt");
      await page.setViewportSize({ width, height });
      const table = await open(page);
      await expect(table.getByText(NAMES[0])).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (SHOTS && width !== 320) {
        await table.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
        await table.screenshot({ path: path.join(SHOTS, `${key}-${STAGE}-${width}.png`) });
      }
      // Keine Seite, die seitlich schiebt.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      // Die Tabelle passt in ihren Rahmen: Name und Punkte ohne Wischen.
      const swipe = await table.evaluate((node) => node.scrollWidth - node.clientWidth);
      expect(swipe).toBeLessThanOrEqual(1);
      const box = await table.boundingBox();
      for (const cell of await table.locator('td[data-col="points"]').all()) {
        const cellBox = await cell.boundingBox();
        expect(cellBox, "Punkte sichtbar").not.toBeNull();
        expect(cellBox.x + cellBox.width).toBeLessThanOrEqual(box.x + box.width + 1);
      }
      const names = await table.locator(".tls-standing-name").all();
      for (const name of names) {
        // Nichts abgeschnitten, der volle Name ist zusätzlich im title erreichbar; lange Wörter trennt der Browser.
        const clipped = await name.evaluate((node) => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
        expect(clipped).toBe(false);
        expect(await name.getAttribute("title")).toBe(await name.textContent());
        expect(await name.evaluate((node) => getComputedStyle(node).hyphens)).toBe("auto");
      }
      // Ohne Silbentrennung (die setzt einen sichtbaren Bindestrich, den man im DOM nicht sieht): Bricht ein Name dann
      // mitten im Wort ohne Zeichen um, muss das Wort allein breiter sein als die Spalte.
      await page.addStyleTag({ content: ".tls-standing-name { -webkit-hyphens: manual !important; hyphens: manual !important; }" });
      for (const name of names) expect(await name.evaluate(badBreaks)).toEqual([]);
    });
  }
}
