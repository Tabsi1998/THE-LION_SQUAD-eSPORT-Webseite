const { test, expect } = require("@playwright/test");

// Ein Datumsformat (#1307): Startseite, Kalender und Turnierliste schreiben „Sa 23. Mai · 18:00“, „heute“/„morgen“ und
// „vor 12 Min.“ - bei 390, 768, 1440 und 2560 px in einer Zeile, ohne „…“ und ohne abgeschnittene Daten (scrollWidth).
// Die API ist nachgestellt, die Uhr steht fest: Mittwoch, 2. Dezember 2026, 11:00 in Wien. Bilder in SHOT_DIR.

const SHOTS = process.env.SHOT_DIR || "";
const WIDTHS = [390, 768, 1440, 2560];
const NOW = new Date("2026-12-02T10:00:00+00:00");
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const TOURNAMENTS = [
  { id: "t-cup", slug: "winter-cup", title: "Winter-Cup", game: "mario_kart", game_name: "Mario Kart 8", start_date: "2026-12-12T18:00:00+00:00", status: "registration_open",
    public_phase: { state: "registration_open", label: "Anmeldung offen" }, max_participants: 16, participant_count: 5, event_mode: "local" },
  { id: "t-heute", slug: "heute-cup", title: "Abend-Cup", game: "rocket_league", game_name: "Rocket League", start_date: "2026-12-02T18:30:00+00:00", status: "registration_open",
    public_phase: { state: "registration_open", label: "Anmeldung offen" }, max_participants: 8, participant_count: 2, event_mode: "online" },
  { id: "t-neujahr", slug: "neujahr-cup", title: "Neujahrs-Cup", game: "fifa", game_name: "EA FC", start_date: "2027-01-09T16:00:00+00:00", status: "scheduled",
    public_phase: { state: "scheduled", label: "Bald" }, max_participants: 32, participant_count: 0, event_mode: "online" },
];
const EVENT = { id: "e-lan", slug: "herbst-lan", name: "Winter-LAN", title: "Winter-LAN", start_date: "2026-12-03T17:00:00+00:00", end_date: "2026-12-03T22:00:00+00:00", status: "scheduled", location: "Vereinsheim" };
const NEWS = [
  { id: "n1", slug: "neue-season", title: "Die neue Season startet", excerpt: "Alles zur Anmeldung.", published_at: "2026-12-02T09:48:00+00:00", category: "verein" },
  { id: "n2", slug: "rueckblick", title: "Rückblick Herbst-LAN", excerpt: "Danke an alle.", published_at: "2026-12-01T18:00:00+00:00", category: "event" },
  { id: "n3", slug: "termine", title: "Termine für den Winter", excerpt: "Was ansteht.", published_at: "2026-11-20T09:00:00+00:00", category: "verein" },
];
const CALENDAR = [
  { id: "t-cup", kind: "tournament", slug: "winter-cup", title: "Winter-Cup", start: "2026-12-12T19:00:00+01:00", end: null, status: "registration_open",
    phase: { label: "Anmeldung offen", state: "registration_open" }, location: "Mario Kart 8", path: "/tournaments/winter-cup", visibility: "public", mine: false, marker: null },
  ...[17, 18, 19].map((day, index) => ({
    id: `e-lan-tag-${index + 1}`, kind: "event", slug: "lan", title: `Herbst-LAN – Tag ${index + 1}/3`, start: `2026-12-${day}T10:00:00+01:00`, end: `2026-12-${day}T22:00:00+01:00`,
    status: "scheduled", phase: null, location: "Vereinsheim", path: "/events/lan", visibility: "public", mine: false, marker: "event_day", event_id: "e-lan", event_name: "Herbst-LAN",
  })),
];
const HOME = {
  has_live: false,
  live: { events: [], tournaments: [], challenges: [] },
  today: { events: [], tournaments: [TOURNAMENTS[1]], challenges: [] },
  soon: { events: [EVENT], tournaments: [], challenges: [] },
  upcoming: { events: [], tournaments: [TOURNAMENTS[0], TOURNAMENTS[2]], challenges: [] },
  // Angepinnt (Aufmacher) ist eine ältere News - die drei neuen stehen im Raster mit „vor 12 Min.“, „gestern“ und dem Tag.
  news: NEWS, featured_news: [{ id: "n0", slug: "angepinnt", title: "Angepinnt: Vereinsregeln", excerpt: "Bitte lesen.", published_at: "2026-11-25T09:00:00+00:00", category: "verein", pinned: true }],
  stats: {}, club_numbers: {},
};

async function mockApi(page) {
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    if (path === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (path === "/api/home/state") return route.fulfill(json(HOME));
    if (path === "/api/calendar") return route.fulfill(json({ items: CALENDAR, signed_in: false, feed_path: "/api/calendar/feed.ics" }));
    if (path === "/api/tournaments") return route.fulfill(json({ items: TOURNAMENTS, total: TOURNAMENTS.length, games: [] }));
    return route.fulfill(json([]));
  });
}

// Jede Stelle mit Datum: ganz sichtbar - kein „…“, kein Abschneiden.
async function cutDates(page) {
  return page.evaluate(() => {
    const DATE = /\b(?:Mo|Di|Mi|Do|Fr|Sa|So) \d{1,2}\.|\bheute \d\d:\d\d|\bmorgen \d\d:\d\d|\bvor \d+ (?:Min|Std)\./;
    const out = [];
    for (const node of document.querySelectorAll("body *")) {
      if (!node.childNodes.length || [...node.children].some((child) => DATE.test(child.textContent || ""))) continue;
      const text = (node.textContent || "").trim();
      if (!DATE.test(text)) continue;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || node.getClientRects().length === 0) continue;
      const cut = node.scrollWidth > node.clientWidth + 1 && style.overflow !== "visible";
      if (cut || style.textOverflow === "ellipsis" && node.scrollWidth > node.clientWidth) out.push(text.slice(0, 80));
    }
    return out;
  });
}

const OLD = /\b\d{2}\.\d{2}\.\d{4}\b|\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\.,|\d{2}\.\d{2}\., \d\d:\d\d/;

test.describe("Ein Datumsformat", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of WIDTHS) {
    test(`Startseite, Kalender und Turnierliste bei ${width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await mockApi(page);

      await page.goto("/");
      const next = page.getByTestId("home-next-up");
      await expect(next).toBeVisible();
      await expect(next).toContainText("heute 19:30");
      await expect(next).toContainText("morgen 18:00");
      await expect(next).toContainText("Sa 12. Dezember · 19:00");
      await expect(next).toContainText("Sa 9. Jänner 2027 · 17:00");
      await expect(page.getByTestId("home-news")).toContainText("vor 12 Min.");
      await expect(page.getByTestId("home-news")).toContainText("gestern");
      await expect(page.locator("body")).not.toContainText(OLD);
      expect(await cutDates(page), "abgeschnittene Daten auf der Startseite").toEqual([]);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/datum-start-${width}.png`, fullPage: false });

      await page.goto("/calendar");
      const calendar = page.getByTestId(width < 768 ? "calendar-list" : "calendar-grid");
      await expect(calendar).toBeVisible();
      if (width < 768) await expect(calendar.getByTestId("calendar-item-event-e-lan")).toContainText("Do 17. – Sa 19. Dezember");
      await expect(page.locator("body")).not.toContainText(OLD);
      expect(await cutDates(page), "abgeschnittene Daten im Kalender").toEqual([]);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/datum-kalender-${width}.png`, fullPage: false });

      await page.goto("/tournaments");
      const cup = page.getByTestId("tournament-card-winter-cup");
      await expect(cup).toBeVisible();
      await expect(cup.locator("time")).toHaveAttribute("datetime", "2026-12-12T18:00:00.000Z");
      await expect(cup.locator("time")).toHaveText("Sa 12. Dezember · 19:00");
      await expect(page.getByTestId("tournament-card-neujahr-cup").locator("time")).toHaveText("Sa 9. Jänner 2027 · 17:00");
      await expect(page.locator("body")).not.toContainText(OLD);
      expect(await cutDates(page), "abgeschnittene Daten in der Turnierliste").toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/datum-turniere-${width}.png`, fullPage: false });
      await testInfo.attach(`turniere-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
