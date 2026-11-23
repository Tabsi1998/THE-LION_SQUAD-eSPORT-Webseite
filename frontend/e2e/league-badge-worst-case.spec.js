const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Gegenprobe zu Liga-Abzeichen (#1638), „Aktuelle Ligen“ und Saisonverlauf (#1630) mit dem schlimmsten Fall: lange Co-Team-Namen und
// Beinamen, neun Seasons mit Auf- und Abstieg, Meister, ein Rückzug, lange Season-Namen („Herbst 2026/27“, ein Name ohne Leerzeichen),
// sechs Co-Teams und ein Profil mit nur einer Season - bei 320, 390, 768 und 1440 px. Geprüft wird je Breite: nichts mit „…“ gekürzt,
// nichts von einer Fläche abgeschnitten, keine Beschriftung der Linie über einer anderen, kein Querlauf. Mit E2E_SCREENS_DIR legt der
// Test Bilder ab (worst-profil-…, worst-team-…). Server nachgestellt, nur erfundene Namen.

const json = (body) => (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
const consent = () => {
  window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
};

const LONG_TEAM = "Donaudampfschifffahrtsgesellschaft";
const LONG_SQUAD = "Donaudampfschifffahrtsgesellschaftskapitäne Nachwuchs";
const LONG_NICK = "Donaudampfschifffahrtsgesellschaft-Nachwuchsliga";
const SEASONS = ["Herbst 2024/25", "Frühjahr 2025", "Sommer 2025", "Herbst 2025/26", "Donaudampfschifffahrtssaison", "Frühjahr 2026",
  "Sommer 2026", "Herbst 2026/27", "Winter 2026/27"];
const NICK = { 1: "Elite", 2: "Herausforderer", 3: LONG_NICK };

const current = (id, level, squad, extra = {}) => ({
  registration_id: id, squad_name: squad, display_name: `${LONG_TEAM} · ${squad}`, team_id: "team-1",
  league: { name: "Probe-Liga der Donaudampfschifffahrtsgesellschaft", slug: "probe-liga" }, season: { name: SEASONS[8], slug: "winter" },
  division_label: NICK[level] ? `Liga ${level} · ${NICK[level]}` : `Liga ${level}`, staffel: "A", badge: { level, nickname: NICK[level] || null, champion: false },
  emblem_url: null, link: "/liga/probe-liga/winter#staffel-probe-a", internal: false,
  rank: 2, of: 12, zone: "promotion", zone_label: "Aufstieg",
  next_match: { match_id: `m-${id}`, scheduled_at: "2026-11-26T19:00:00+00:00", matchday: 4, opponent: `${LONG_TEAM} · Sturmfalken Rot`, link: `/matches/m-${id}` },
  ...extra,
});

// Je Season (Index 0-8): [Liga N, Platz] bzw. "x" für den Rückzug; Meister mit Platz 1 in Liga 1.
const season = (index, team, cell) => {
  const [level, rank, exit] = cell === "x" ? [2, null, "withdrawn"] : cell;
  return {
    season_id: `s${index}`, season_name: SEASONS[index], season_number: index + 1, league_name: "Probe-Liga", url: "/liga/probe-liga/s",
    division_label: `Liga ${level}`, staffel: "A", display_name: team, rank, of: 12, points: 12, champion: level === 1 && rank === 1, zone: null,
    closed_at: `2026-0${index + 1}-15T20:00:00+00:00`, badge: { level, nickname: NICK[level] || null, champion: level === 1 && rank === 1 },
    internal: false, exit: exit || null,
  };
};
// Auf- und Abstieg über neun Seasons, Meister in Season 4 und 9, Rückzug in Season 6; auf der Teamseite dazu ein zweiter Rückzug in
// Season 6 und einer in Season 7 (zwei „ausgetreten“ übereinander bzw. nebeneinander).
const PERSON_PATH = [[4, 2], [3, 1], [2, 3], [1, 1], [1, 7], "x", [2, 1], [1, 4], [1, 1]];
const TEAM_PATHS = [
  [`${LONG_TEAM} · ${LONG_SQUAD}`, PERSON_PATH],
  [`${LONG_TEAM} · Zweite Garnitur der Donaudampfer`, [[3, 5], [3, 2], [2, 6], [3, 1], [2, 2], "x", [2, 3], [2, 2], [1, 5]]],
  [`${LONG_TEAM} · Nachwuchs`, [[4, 8], [4, 3], [3, 2], [3, 4], [3, 6], [4, 1], "x", [3, 1], [2, 4]]],
  [`${LONG_TEAM} · Damen`, [[4, 1], [3, 3], [3, 1], [2, 8], [3, 2], [2, 5], [2, 7], [3, 1], [2, 1]]],
  [`${LONG_TEAM} · Ü30`, [[4, 4], [4, 6], [4, 2], [3, 9], [4, 3], [4, 5], [4, 1], [3, 6], [3, 2]]],
  [`${LONG_TEAM} · Akademie`, [[4, 9], [4, 10], [4, 7], [4, 8], [4, 4], [4, 2], [3, 8], [4, 2], [4, 3]]],
];
const historyOf = (team, cells) => cells.map((cell, index) => season(index, team, cell)).reverse();
const HISTORY = historyOf(TEAM_PATHS[0][0], PERSON_PATH);
const TEAM_HISTORY = TEAM_PATHS.flatMap(([team, cells]) => historyOf(team, cells));

const CURRENT = [current("a", 1, LONG_SQUAD, { rank: 1, internal: true }), current("b", 3, "Zweite Garnitur der Donaudampfer", { rank: null, status_note: "Warteliste" })];
const TEAM_LEAGUE = TEAM_PATHS.map(([team], index) => ({
  ...current(`t${index}`, [1, 1, 2, 2, 3, 4][index], team.split(" · ")[1], { rank: index + 1 }), staffel_label: `${[1, 1, 2, 2, 3, 4][index] === 3 ? `Liga 3 · ${LONG_NICK}` : `Liga ${[1, 1, 2, 2, 3, 4][index]}`} · Staffel A`,
}));

const profileOf = (username, history, leagueCurrent) => ({ id: username, username, display_name: "NeonFalke", role: "player", country: "AT",
  created_at: "2025-03-01T10:00:00+00:00", stats: {}, teams: [], tournaments: [], awards: [], featured_award: null, featured_title: null, featured_emblems: [],
  league_history: history, league_overall: [], league_current: leagueCurrent, achievement_level: { level: 7, progress: 40 }, privacy_public_profile: true });
const TEAM = { id: "team-1", name: LONG_TEAM, tag: "DDSG", leader_id: "p9", co_leader_ids: [], member_ids: ["p9"], members: [{ id: "p9", username: "kapitaen", display_name: "Kapitän" }],
  is_member: false, can_manage: false, awards: [], featured_award: null, featured_title: null, featured_emblems: [], rank_banners: [],
  league_history: TEAM_HISTORY, league_overall: [] };

async function mockServer(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(consent);
  await page.route("**/api/**", json({}));
  for (const item of ["sponsors**", "notifications/me", "games", "streams/live", "teams?**"]) await page.route(`**/api/${item}`, json([]));
  await page.route("**/api/friends", json({ incoming: [], friends: [], outgoing: [] }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/me/rewards/unseen", json({ rewards: [] }));
  await page.route("**/api/users/public/neonfalke**", json(profileOf("neonfalke", HISTORY, CURRENT)));
  await page.route("**/api/users/public/einmalig**", json(profileOf("einmalig", HISTORY.slice(-1), CURRENT.slice(0, 1))));
  await page.route("**/api/teams/team-1", json(TEAM));
  await page.route("**/api/teams/team-1/overview", json({ upcoming: [], recent: [], league: TEAM_LEAGUE }));
}

/** Was im Bereich nicht ganz zu sehen ist: Text mit „…“, mit text-overflow bzw. line-clamp gekürzt, oder von einem Vorfahren mit
 *  overflow abgeschnitten (außerhalb einer Wischfläche .tls-swipe) - dazu alles, was rechts über den Bildschirm ragt. */
function problems(ids) {
  const out = [];
  for (const id of ids) {
    const root = document.querySelector(`[data-testid="${id}"]`);
    if (!root) continue;
    for (const node of [root, ...root.querySelectorAll("*")]) {
      if (!node.getClientRects().length) continue;
      const style = getComputedStyle(node);
      const label = `${id}: ${node.tagName.toLowerCase()}.${String(node.className?.baseVal ?? node.className).split(" ")[0]} „${(node.textContent || "").trim().slice(0, 30)}“`;
      const own = [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join("");
      if (own.includes("…")) out.push(`${label}: „…“ im Text`);
      if (style.textOverflow === "ellipsis" && node.scrollWidth > node.clientWidth + 1) out.push(`${label}: text-overflow`);
      if (style.webkitLineClamp && style.webkitLineClamp !== "none" && node.scrollHeight > node.clientHeight + 1) out.push(`${label}: line-clamp`);
      const box = node.getBoundingClientRect();
      if (box.width <= 0) continue;
      if (box.right > window.innerWidth + 1 && !node.parentElement?.closest(".tls-swipe")) out.push(`${label}: ragt rechts hinaus (${Math.round(box.right)} > ${window.innerWidth})`);
      for (let up = node.parentElement; up && up !== root.parentElement; up = up.parentElement) {
        if (up.classList.contains("tls-swipe")) break;
        const clip = getComputedStyle(up);
        if (clip.overflowX === "visible" && clip.overflowY === "visible") continue;
        const frame = up.getBoundingClientRect();
        if (box.right > frame.right + 1 || box.left < frame.left - 1) out.push(`${label}: von ${up.tagName.toLowerCase()}.${String(up.className).split(" ")[0]} abgeschnitten`);
        break;
      }
    }
  }
  return [...new Set(out)].slice(0, 12);
}

/** Beschriftungen der Linie, die sich überdecken (je zwei Texte im SVG), oder die über den Rand des SVG laufen. */
function overlaps(id) {
  const svg = document.querySelector(`[data-testid="${id}"] svg.tls-season-line__svg`);
  if (!svg) return ["keine Linie"];
  const frame = svg.getBoundingClientRect();
  const texts = [...svg.querySelectorAll("text")].map((node) => ({ text: node.textContent.trim(), box: node.getBoundingClientRect() })).filter((row) => row.box.width > 0);
  const out = [];
  for (const row of texts) {
    if (row.box.left < frame.left - 1 || row.box.right > frame.right + 1) out.push(`„${row.text}“ läuft über den Rand`);
  }
  for (let a = 0; a < texts.length; a += 1) {
    for (let b = a + 1; b < texts.length; b += 1) {
      const [one, two] = [texts[a].box, texts[b].box];
      const x = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const y = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (x > 1 && y > 1) out.push(`„${texts[a].text}“ über „${texts[b].text}“`);
    }
  }
  return out.slice(0, 12);
}

/** Platz-Zahlen und „ausgetreten“, die auf einem Kreis irgendeiner Linie liegen (Review #1638: „6.“ lag auf dem Kreis eines anderen). */
function onCircles(id) {
  const svg = document.querySelector(`[data-testid="${id}"] svg.tls-season-line__svg`);
  if (!svg) return ["keine Linie"];
  const circles = [...svg.querySelectorAll("circle")].map((node) => node.getBoundingClientRect());
  const out = [];
  for (const text of svg.querySelectorAll(".tls-season-line__rank, .tls-season-line__exit")) {
    const box = text.getBoundingClientRect();
    for (const circle of circles) {
      const x = Math.min(box.right, circle.right) - Math.max(box.left, circle.left);
      const y = Math.min(box.bottom, circle.bottom) - Math.max(box.top, circle.top);
      if (x > 1 && y > 1) out.push(`„${text.textContent}“ auf einem Kreis bei ${Math.round(circle.left)},${Math.round(circle.top)}`);
    }
  }
  return out.slice(0, 12);
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "kein Querlauf").toBeLessThanOrEqual(1);
}

const HIDE_CHROME = ".tls-bottom-nav, [data-testid=site-header], [data-testid=scroll-top-btn], .tls-skip-link { visibility: hidden !important; } .sticky { position: static !important; }";

async function shotSpan(page, first, last, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await first.scrollIntoViewIfNeeded();
  const a = await first.boundingBox();
  const b = await last.boundingBox();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const pad = 8;
  const left = Math.max(0, Math.min(a.x, b.x) - pad);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true, animations: "disabled", style: HIDE_CHROME,
    clip: { x: left + scroll.x, y: Math.max(0, a.y - pad) + scroll.y, width: Math.max(a.x + a.width, b.x + b.width) + pad - left, height: b.y + b.height - a.y + 2 * pad } });
}

async function ready(page, url, first) {
  await page.goto(url);
  await expect(page.getByTestId(first)).toBeVisible();
  await page.evaluate(() => document.fonts?.ready);
}

test.describe("Liga-Abzeichen und Saisonverlauf im schlimmsten Fall", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[320, 700], [390, 844], [768, 1024], [1440, 900]]) {
    test(`Profil bei ${width} px: lange Namen, neun Seasons, Meister und Rückzug - nichts gekürzt oder überdeckt`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await ready(page, "/u/neonfalke", "profile-league-current");
      const line = page.getByTestId("profile-season-line");
      if ([390, 1440].includes(width)) await shotSpan(page, page.getByTestId("profile-league-current"), line, `worst-profil-${width}`);
      expect(await page.evaluate(problems, ["profile-league-current", "profile-season-line", "profile-league-history"])).toEqual([]);
      expect(await page.evaluate(overlaps, "profile-season-line")).toEqual([]);
      expect(await page.evaluate(onCircles, "profile-season-line")).toEqual([]);
      await noSideScroll(page);
      // Der volle Co-Team-Name steht da - umgebrochen, nicht gekürzt.
      await expect(page.getByTestId("profile-league-current-a")).toContainText(LONG_SQUAD);
      // Alle neun Seasons stehen auf der Achse, auch die mit dem Rückzug - voller Name im <title>.
      const labels = line.locator(".tls-season-line__season");
      await expect(labels).toHaveCount(9);
      await expect(labels.nth(7).locator("title")).toHaveText("Herbst 2026/27");
      // Rückzug in Season 6: grauer Punkt mit „ausgetreten“ ohne Platz, die Linie ist dort unterbrochen.
      await expect(line.getByTestId("profile-season-line-exit-0-5")).toContainText("ausgetreten");
      await expect(line.locator("polyline.tls-season-line__path")).toHaveCount(2);
      await expect(line.getByTestId("profile-season-line-point-0-8")).toHaveAttribute("data-champion", "true");
      // Bei vielen Seasons bleibt die Fläche seitlich wischbar, statt die Seite zu verbreitern.
      const region = line.getByRole("region");
      const wide = await region.evaluate((node) => node.scrollWidth > node.clientWidth);
      if (width <= 390) expect(wide, "neun Seasons am Handy: wischen").toBe(true);
    });

    test(`Teamseite bei ${width} px: sechs Co-Teams mit langen Namen - nichts gekürzt oder überdeckt`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await ready(page, "/teams/team-1", "team-league");
      const line = page.getByTestId("team-season-line");
      await line.scrollIntoViewIfNeeded();
      if ([390, 1440].includes(width)) await shotSpan(page, page.getByTestId("team-league"), line, `worst-team-${width}`);
      expect(await page.evaluate(problems, ["team-league", "team-season-line", "team-league-history"])).toEqual([]);
      expect(await page.evaluate(overlaps, "team-season-line")).toEqual([]);
      expect(await page.evaluate(onCircles, "team-season-line")).toEqual([]);
      await noSideScroll(page);
      await expect(page.getByTestId("team-league").locator(".tls-league-now__row")).toHaveCount(6);
      await expect(line.getByTestId("team-season-line-legend").locator("li")).toHaveCount(4);
      await expect(line.getByTestId("team-season-line-more")).toHaveText("und 2 weitere Co-Teams");
      await expect(line.locator(".tls-season-line__season")).toHaveCount(9);
      // Drei Rückzüge (zwei in Season 6 nebeneinander, einer in Season 7): drei Punkte, je Season ein lesbares „ausgetreten“ - die zwei
      // nebeneinander teilen sich ihre Beschriftung, keine liegt über einer anderen oder auf einem Kreis.
      await expect(line.locator("[data-exit]")).toHaveCount(3);
      await expect(line.locator("[data-exit] text.tls-season-line__exit")).toHaveCount(2);
    });
  }

  // Zoom 200 % an einem 1440-px-Bildschirm: 720 CSS-Pixel bei doppelter Pixeldichte.
  test.describe("Zoom 200 %", () => {
    test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });

    test("Profil und Teamseite: keine Beschriftung auf einem Kreis oder über einer anderen, nichts gekürzt", async ({ page }) => {
      await mockServer(page);
      await ready(page, "/u/neonfalke", "profile-league-current");
      expect(await page.evaluate(problems, ["profile-league-current", "profile-season-line", "profile-league-history"])).toEqual([]);
      expect(await page.evaluate(overlaps, "profile-season-line")).toEqual([]);
      expect(await page.evaluate(onCircles, "profile-season-line")).toEqual([]);
      await ready(page, "/teams/team-1", "team-league");
      expect(await page.evaluate(problems, ["team-league", "team-season-line", "team-league-history"])).toEqual([]);
      expect(await page.evaluate(overlaps, "team-season-line")).toEqual([]);
      expect(await page.evaluate(onCircles, "team-season-line")).toEqual([]);
      await noSideScroll(page);
    });
  });

  test("Profil mit nur einer Season: keine Linie, Historie und Karte vollständig", async ({ page }) => {
    for (const [width, height] of [[320, 700], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await ready(page, "/u/einmalig", "profile-league-current");
      await expect(page.getByTestId("profile-season-line")).toHaveCount(0);
      await expect(page.getByTestId("profile-league-history")).toBeVisible();
      expect(await page.evaluate(problems, ["profile-league-current", "profile-league-history"])).toEqual([]);
      await noSideScroll(page);
    }
  });
});
