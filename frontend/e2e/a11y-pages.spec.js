const { test, expect } = require("@playwright/test");

// Barrierefreiheit im Web (#1155): Turnier-, Match- und Event-Seite, Dashboard und Einstellungen
// - axe (WCAG 2.1 A/AA) ohne schwere Funde. Den Kontrast prüft #1232 (Stil-System I) - dort wird die Regel hier
//   eingeschaltet; bis dahin bleibt sie aus, damit dieser Test nicht dasselbe zweimal baut.
// - 200 % ohne Querlauf und ohne abgeschnittene Überschriften oder Knöpfe: am PC als Browser-Zoom (1440 px → 720 px
//   breit), am Handy als doppelte Schriftgröße bei 390 px (wie die Schriftgröße im Browser).
// Die API ist nachgestellt, alle Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
// Bilder für die Abnahme: SHOT_DIR=… legt je Seite ein Bild mit doppelter Schrift ab.
const SHOTS = process.env.SHOT_DIR || "";

const NAMES = [
  "KiwiKomet der Unaufhaltsame", "NeonFalke aus dem Mühlviertel", "Sternenstaub Lena", "Donnerbüffel Maximilian",
  "Pixelpirat Hochgeschwindigkeit", "Morgenrot Gamer", "Schattenläufer der Nordkurve", "Quantenquokka mit Turbo",
];
const ME = { id: "u1", username: "neonfalke", display_name: "NeonFalke", role: "player", email: "neonfalke@example.invalid", is_club_member: true, areas: [] };

const TOURNAMENT = {
  id: "t1", slug: "herbst-cup", title: "Herbst-LAN 2026 · EA SPORTS FC 26 Cup der langen Namen", status: "registration_open", format: "single_elim",
  platform: "PlayStation 5", game: { display_name: "EA SPORTS FC 26", short_name: "FC26" }, start_date: "2026-11-14T10:00:00+01:00",
  max_participants: 16, participant_count: 8, registration_enabled: true, team_mode: "solo",
  public_phase: { state: "registration", label: "Anmeldung offen", target_at: "2026-11-13T18:00:00+01:00", countdown_kind: "registration_close" },
};
const REGISTRATIONS = NAMES.map((name, index) => ({ id: `r${index + 1}`, display_name: name, status: "approved" }));

const MATCH = {
  match: {
    id: "m1", match_key: "A", status: "scheduled", round: 1, round_name: "Achtelfinale", scheduled_at: "2026-11-14T10:30:00+01:00",
    slots: [{ slot: 1, status: "filled", registration_id: "r1" }, { slot: 2, status: "filled", registration_id: "r2" }], results: [],
    station_text: "Station 3 · Switch 2",
  },
  tournament: { id: "t1", slug: "herbst-cup", title: TOURNAMENT.title },
  participants: [
    { slot: 1, status: "filled", registration_id: "r1", display_name: NAMES[0] },
    { slot: 2, status: "filled", registration_id: "r2", display_name: NAMES[1] },
  ],
  schedule_proposals: [], can_act: false, can_report_score: false, can_player_report_result: false, can_submit_result: false,
  can_staff_submit_result: false, can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false,
  event_mode: "local", result_entry_mode: "staff_only", schedule_mode: "fixed_by_staff", collection: "matches_v2", matchday: 1, matchday_label: "Achtelfinale",
};

const EVENT = {
  id: "e1", slug: "herbst-lan", name: "Herbst-LAN 2026 mit sehr langem Namen im Vereinsheim", status: "upcoming", visibility: "public", event_type: "lan",
  start_date: "2026-11-14T09:00:00+01:00", end_date: "2026-11-14T22:00:00+01:00", location: "Vereinsheim", city: "Linz",
  description: "Ein Tag LAN mit Turnieren und Fast Laps.", public_phase: { state: "announced", label: "Angekündigt" },
  registrations: [], sponsors: [], albums: [], news: [], f1_challenges: [],
  tournaments: [{ id: "t1", slug: "herbst-cup", title: TOURNAMENT.title, status: "registration_open", start_date: TOURNAMENT.start_date }],
};

const DASHBOARD = {
  me: {
    tournaments: [{ ...TOURNAMENT, my_registration: { status: "approved" } }],
    events: [EVENT], matches: [], staff_matches: [],
    actions: [{ id: "checkin-t1", type: "tournament_checkin", label: "Turnier Check-in offen", detail: TOURNAMENT.title, target_type: "tournament", target_id: "herbst-cup", priority: 10 }],
  },
  public: { tournaments: [TOURNAMENT], events: [EVENT] },
  news: [], streams: [],
  season: { id: "s1", slug: "2026", name: "Saison 2026", my_rank: 3, my_points: 42, participant_count: 20, leader: { display_name: NAMES[0], points: 99 } },
  stats: {},
};

const PAGES = [
  { name: "Turnier", path: "/tournaments/herbst-cup", ready: "tournament-title", user: null },
  { name: "Match", path: "/matches/m1", ready: "match-headline", user: null },
  { name: "Event", path: "/events/herbst-lan", ready: null, user: null },
  { name: "Dashboard", path: "/dashboard", ready: "dashboard-timeline", user: ME },
  { name: "Einstellungen", path: "/profile?tab=basic", ready: null, user: ME },
  { name: "Benachrichtigungen einstellen", path: "/profile?tab=notifications", ready: null, user: ME },
];

async function mockServer(page, user) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill(user ? json(user) : json({ detail: "anonym" }, 401));
    if (path === "/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.example" }));
    if (path === "/tournaments/herbst-cup") return route.fulfill(json(TOURNAMENT));
    if (/^\/tournaments\/(t1|herbst-cup)\/registrations$/.test(path)) return route.fulfill(json(REGISTRATIONS));
    if (/^\/tournaments\/(t1|herbst-cup)\/bracket$/.test(path)) return route.fulfill(json({ matches: [], registrations: REGISTRATIONS }));
    if (path === "/matches/m1/page") return route.fulfill(json(MATCH));
    if (path === "/events/herbst-lan") return route.fulfill(json(EVENT));
    if (path === "/mobile/dashboard") return route.fulfill(json(DASHBOARD));
    if (path === "/prizes/me/open-count") return route.fulfill(json({ count: 0 }));
    if (path === "/users/me/profile-completeness") return route.fulfill(json({ score: 80, missing: [] }));
    if (path === "/users/me") return route.fulfill(json(user || {}));
    return route.fulfill(json([]));
  });
}

async function open(page, entry) {
  await mockServer(page, entry.user);
  await page.goto(entry.path);
  if (entry.ready) await expect(page.getByTestId(entry.ready).first()).toBeVisible();
  else await expect(page.locator("main h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function seriousViolations(page) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    return result.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact))
      .map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  });
}

/**
 * Querlauf und abgeschnittene Überschriften, Texte, Knöpfe und Links: Text breiter als die eigene Fläche, die
 * abschneidet („…“), oder über den Rand einer Fläche darüber hinaus, die abschneidet (overflow hidden). Was mit
 * Absicht in einer waagrechten Scroll-Reihe steht, zählt nicht.
 */
async function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) problems.push(`Querlauf ${overflow}px`);
    const label = (element) => `${element.tagName.toLowerCase()} „${element.textContent.trim().replace(/\s+/g, " ").slice(0, 40)}“`;
    for (const element of document.querySelectorAll("main h1, main h2, main h3, main p, main button, main a, main label, header button, header a")) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || !element.textContent.trim()) continue;
      if (element.closest("[aria-hidden='true'], .sr-only")) continue;
      const clips = ["hidden", "clip"].includes(style.overflowX) || style.textOverflow === "ellipsis";
      if (clips && element.scrollWidth > element.clientWidth + 1) {
        problems.push(`abgeschnitten: ${label(element)}`);
        continue;
      }
      const rect = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (["auto", "scroll"].includes(parentStyle.overflowX)) break;
        if (!["hidden", "clip"].includes(parentStyle.overflowX)) continue;
        const box = parent.getBoundingClientRect();
        if (rect.right > box.right + 1 || rect.left < box.left - 1) problems.push(`über den Rand: ${label(element)}`);
        break;
      }
    }
    return [...new Set(problems)];
  });
}

/**
 * Tippflächen am Handy unter 44 × 44 px: von der Mitte 22 px nach oben, unten, links und rechts muss noch dasselbe
 * Element getroffen werden (so zählt auch eine unsichtbare Fläche wie `.tls-hit`). Links und Knöpfe im Fließtext sind
 * ausgenommen (wie in WCAG), Formularfelder auch - die werden mit #1326 (Stil-System) 44 px hoch.
 */
async function smallTargets(page) {
  const selector = "main button, main a[href], main [role=button], main [role=tab], main [role=switch], header button, header a[href]";
  const count = await page.locator(selector).count();
  const small = [];
  for (let index = 0; index < count; index += 1) {
    const element = page.locator(selector).nth(index);
    if (!(await element.isVisible())) continue;
    const problem = await element.evaluate((node) => {
      // In die Mitte holen: am Rand läge der feste Kopf über dem Element.
      node.scrollIntoView({ block: "center", inline: "nearest" });
      const style = getComputedStyle(node);
      if (style.display === "inline" || node.closest("p") || node.disabled) return "";
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hits = (px, py) => {
        const hit = document.elementFromPoint(px, py);
        return Boolean(hit && (hit === node || node.contains(hit)));
      };
      // 21 px statt 22: Bruchteile eines Pixels an der Kante sollen nicht zählen.
      if (hits(x, y - 21) && hits(x, y + 21) && hits(x - 21, y) && hits(x + 21, y)) return "";
      const name = (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 30);
      return `${node.getAttribute("data-testid") || node.tagName.toLowerCase()} „${name}“ ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    });
    if (problem) small.push(problem);
  }
  return small;
}

test.describe("Barrierefreiheit (#1155)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const entry of PAGES) {
    test(`${entry.name}: axe ohne schwere Funde bei 390 und 1440 px`, async ({ page }) => {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, entry);
        expect(await seriousViolations(page), `axe bei ${width} px`).toEqual([]);
      }
    });

    test(`${entry.name}: Tippflächen am Handy mindestens 44 px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, entry);
      expect(await smallTargets(page)).toEqual([]);
    });

    test(`${entry.name}: 200 % ohne Querlauf und ohne Abschneiden`, async ({ page }) => {
      // PC: Browser-Zoom 200 % - aus 1440 px werden 720 px Breite.
      await page.setViewportSize({ width: 720, height: 450 });
      await open(page, entry);
      expect(await layoutProblems(page), "PC mit 200 %").toEqual([]);
      // Handy: doppelte Schriftgröße bei 390 px.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForTimeout(100);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/a11y-200-${entry.path.replace(/[^a-z0-9]+/gi, "-")}.png`, fullPage: true });
      expect(await layoutProblems(page), "Handy mit doppelter Schrift").toEqual([]);
    });
  }
});
