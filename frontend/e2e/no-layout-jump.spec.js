const { test, expect } = require("@playwright/test");

// Seiten springen beim Laden nicht mehr (#1231): Turnier, Turnierbaum, Event, Live, Partner, Referenz und Impressum
// bei 390 und 1440 px. Die Antworten kommen absichtlich spät (700 ms); solange steht ein Skelett in der Form der
// Seite da, die Fußzeile bleibt unter dem ersten Bildschirm, und der Layout-Sprung (CLS) bleibt unter 0,1.
// Die API ist nachgestellt, alle Namen sind erfunden.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const DELAY = 700;
const LONG = "Ein langer Absatz, damit die Seite wie im Alltag mehr als einen Bildschirm füllt. ".repeat(6);
const NAMES = ["KiwiKomet", "NeonFalke", "Sternenstaub", "Donnerbüffel", "Pixelpirat", "Morgenrot", "Schattenläufer", "Quantenquokka"];

const TOURNAMENT = {
  id: "t1", slug: "herbst-cup", title: "Herbst-Cup 2026", status: "registration_open", format: "single_elim", platform: "PC",
  game: { display_name: "Rocket League", short_name: "RL" }, start_date: "2026-11-14T10:00:00+01:00", max_participants: 16,
  participant_count: 8, registration_enabled: true, description: LONG, rules: [LONG, LONG],
  public_phase: { state: "registration", label: "Anmeldung offen" },
};
const REGS = NAMES.map((name, index) => ({ id: `r${index + 1}`, display_name: name, status: "approved" }));
const duel = (id, round, order, a, b) => ({
  id, stage_id: "s1", section: "WB", round, order, match_key: id.toUpperCase(), match_type: "duel", status: "scheduled",
  slots: [{ slot: 1, registration_id: a, status: "filled" }, { slot: 2, registration_id: b, status: "filled" }], results: [],
});
const BRACKET = {
  tournament: TOURNAMENT, stages: [{ id: "s1", name: "Playoffs", number: 1 }], registrations: REGS,
  matches_v2: [duel("a", 1, 0, "r1", "r2"), duel("b", 1, 1, "r3", "r4"), duel("c", 1, 2, "r5", "r6"), duel("d", 1, 3, "r7", "r8")],
};
const EVENT = {
  id: "e1", slug: "herbst-lan", name: "Herbst-LAN 2026", status: "upcoming", visibility: "public", event_type: "lan",
  start_date: "2026-11-14T09:00:00+01:00", end_date: "2026-11-14T22:00:00+01:00", location: "Vereinsheim", city: "Linz",
  description: LONG, public_phase: { state: "announced", label: "Angekündigt" }, registrations: [], sponsors: [], albums: [], news: [],
  f1_challenges: [], tournaments: [{ id: "t1", slug: "herbst-cup", title: "Herbst-Cup 2026", status: "registration_open", start_date: TOURNAMENT.start_date }],
};
const PARTNER = {
  id: "p1", slug: "pixelwerk", name: "Pixelwerk Linz", kind: "partner", description: LONG, logo_url: null, url: "https://example.invalid",
  channels: [], tools: [], news: [], events: [],
};
const REFERENCE = {
  id: "ref1", title: "Landesmeisterschaft 2026", organizer: "eSport-Verband", team_name: "Lions Rocket", description: LONG,
  status: "completed", placement: 2, placement_label: "2. Platz", start_date: "2026-05-23", location: "Wels", game_name: "Rocket League",
};
const IMPRINT = {
  title: "Impressum", legal_ready: true,
  sections: Array.from({ length: 6 }).map((_, index) => ({ id: `s${index}`, title: `Abschnitt ${index + 1}`, blocks: [{ type: "paragraph", text: LONG }] })),
};

const PAGES = [
  { name: "Turnier", path: "/tournaments/herbst-cup", ready: "tournament-title" },
  { name: "Turnierbaum", path: "/tournaments/herbst-cup/bracket", ready: null },
  { name: "Event", path: "/events/herbst-lan", ready: null },
  { name: "Live", path: "/events/herbst-lan/live", ready: null },
  { name: "Partner", path: "/partners/pixelwerk", ready: null },
  { name: "Referenz", path: "/references/ref1", ready: null },
  { name: "Impressum", path: "/imprint", ready: null },
];

async function mockServer(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
    // Layout-Sprünge mitzählen wie Chrome für CLS (ohne Sprünge direkt nach einer Eingabe).
    window.__cls = 0;
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const late = (body) => (route) => setTimeout(() => route.fulfill(json(body)).catch(() => {}), DELAY);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    if (path === "/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.example" }));
    if (path === "/tournaments/herbst-cup") return late(TOURNAMENT)(route);
    if (path === "/tournaments/t1/bracket") return late(BRACKET)(route);
    if (/^\/tournaments\/(t1|herbst-cup)\/registrations$/.test(path)) return late(REGS)(route);
    if (path === "/events/herbst-lan") return late(EVENT)(route);
    if (path === "/partners/pixelwerk") return late(PARTNER)(route);
    if (path === "/references/ref1") return late(REFERENCE)(route);
    if (path === "/settings/public/legal/imprint") return late(IMPRINT)(route);
    return route.fulfill(json([]));
  });
}

test.describe("Seiten springen beim Laden nicht (#1231)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breiten werden hier selbst gesetzt");

  for (const entry of PAGES) {
    for (const width of [390, 1440]) {
      test(`${entry.name} bei ${width} px: Skelett, Fußzeile unten, CLS unter 0,1`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        await mockServer(page);
        await page.goto(entry.path, { waitUntil: "domcontentloaded" });
        // Während des Ladens: ein Skelett, keine Fußzeile im ersten Bildschirm.
        await expect(page.locator("[aria-busy='true']").first()).toBeVisible();
        // In einem Schritt gemessen: beim Wechsel vom Rahmen des Seitenwechsels zur Seite wird der Rahmen getauscht.
        const footerTop = await page.evaluate(() => document.querySelector("footer")?.getBoundingClientRect().top ?? Infinity);
        expect(footerTop, "Fußzeile während des Ladens").toBeGreaterThanOrEqual(page.viewportSize().height);
        // Nach dem Laden: Inhalt da, kein Skelett mehr, kaum Sprung.
        if (entry.ready) await expect(page.getByTestId(entry.ready)).toBeVisible();
        await expect(page.locator("main [aria-busy='true']")).toHaveCount(0, { timeout: 10000 });
        await page.waitForTimeout(800);
        const cls = await page.evaluate(() => window.__cls);
        expect(cls, `CLS ${entry.name}`).toBeLessThan(0.1);
      });
    }
  }
});
