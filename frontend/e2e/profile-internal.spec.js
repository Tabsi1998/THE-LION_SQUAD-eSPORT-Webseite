const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Vereinsinterne Erfolge (#2516) im echten Browser, Server nachgestellt wie der echte (services/profile_visibility.py): ein
// angemeldetes Vereinsmitglied sieht im fremden Profil auch das interne Turnier mit dem Etikett „Vereinsintern“, ein Gast nie.
// Schaltet die Person „Vereinsinterne Erfolge zeigen“ in den Einstellungen aus, sieht auch das Mitglied nur Öffentliches.
// Bei 390 und 1440 px ohne seitliches Scrollen. Mit E2E_SCREENS_DIR legt der Test die Bilder ab. Nur erfundene Namen.

const OWNER = { id: "u-owner", username: "neonfalke", display_name: "NeonFalke", role: "player", email: "neon@example.test", privacy_public_profile: true,
  updated_at: "2026-11-18T08:00:00.000000+00:00" };
const MEMBER = { id: "u-member", username: "nachtfalke", display_name: "Nachtfalke", role: "player", is_club_member: true, email: "nacht@example.test" };

const PUBLIC_REF = { id: "tournament:t-offen", kind: "tournament", title: "Offen-Cup", subtitle: "Rennspiel", rank: 1, date: "2026-10-04T18:00:00+02:00",
  target_id: "offen-cup", participant_count: 16, internal: false };
const INTERNAL_REF = { id: "tournament:t-verein", kind: "tournament", title: "Vereinsabend-Cup", subtitle: "Rennspiel", rank: 2, date: "2026-10-11T18:00:00+02:00",
  target_id: "vereinsabend-cup", participant_count: 8, internal: true };
const award = (id, title, rank, internal) => ({ id, kind: "trophy", rank, rank_label: `${rank}. Platz`, participants: 8, matches: { played: 3, won: 2 },
  record: "2 Siege · 1 Niederlage", tournament: { id: `t-${id}`, slug: `${id}-cup`, title }, game: { name: "Rennspiel" }, season: null, team: null,
  league: null, image_url: null, date: "2026-10-11", reward: null, internal });
const PUBLIC_AWARD = award("offen", "Offen-Cup", 1, false);
const INTERNAL_AWARD = award("verein", "Vereinsabend-Cup", 2, true);

// Runde 2 (#2521): Teilnahmen ohne Ergebnis, Fast-Lap-Bestzeiten, Zahlen und Liga-Historie nach derselben Regel.
const tour = (id, slug, title, internal) => ({ id, slug, title, status: "registration_open", start_date: "2026-12-04T18:00:00+01:00",
  game: { name: "Rennspiel" }, final_position: null, internal });
const PUBLIC_TOUR = tour("t-offen-2", "offener-abend", "Offener Abend", false);
const INTERNAL_TOUR = tour("t-verein-2", "vereins-training", "Vereins-Training", true);
const PUBLIC_LAP = { track: { name: "Spielberg", country: "AT" }, challenge: { id: "c-offen", slug: "offen-hotlap", title: "Offener Hotlap" },
  time_ms: 65123, time_str: "1:05.123", is_leader: false, internal: false };
const INTERNAL_LAP = { track: { name: "Monza", country: "IT" }, challenge: { id: "c-verein", slug: "vereins-hotlap", title: "Vereins-Hotlap" },
  time_ms: 80500, time_str: "1:20.500", is_leader: true, internal: true };
const season = (id, number, rank, internal) => ({ season_id: id, season_name: `Season ${number}`, season_number: number, league_name: "Probe-Liga",
  url: null, division_label: "Liga 1", staffel: "A", display_name: "Neon Racing", rank, of: 6, points: 12, champion: rank === 1, zone: null, internal });
const overall = (place, points, internal) => ({ league_name: "Probe-Liga", period_name: "Jahr 2026", division_label: "Liga 1", level: 1, place, of: 6,
  points, closed: false, complete: false, url: null, internal });
// Gast: nur Öffentliches, dieselben Zahlen wie ohne interne Einträge. Mitglied: das Interne zählt mit.
const GUEST_STATS = { tournaments: 1, wins: 1, top3: 2, fast_laps: 1, pole_positions: 0 };
const MEMBER_STATS = { tournaments: 3, wins: 1, top3: 4, fast_laps: 2, pole_positions: 1 };

function profileFor(viewer, owner) {
  // Dieselbe Regel wie am Server: selbst alles, Mitglied bei Schalter an dazu Internes, sonst nur Öffentliches.
  const sees = Boolean(viewer && (viewer.id === owner.id || (viewer.is_club_member && owner.privacy_members_see_internal !== false)));
  const items = sees ? [INTERNAL_REF, PUBLIC_REF] : [PUBLIC_REF];
  return {
    ...owner, created_at: "2025-03-01T10:00:00+00:00", teams: [],
    stats: sees ? MEMBER_STATS : GUEST_STATS,
    tournaments: sees ? [INTERNAL_TOUR, PUBLIC_TOUR] : [PUBLIC_TOUR],
    f1_bests: sees ? [PUBLIC_LAP, INTERNAL_LAP] : [PUBLIC_LAP],
    league_history: sees ? [season("s-verein", 2, 1, true), season("s-offen", 1, 3, false)] : [season("s-offen", 1, 3, false)],
    league_overall: [sees ? overall(1, 21, true) : overall(3, 9, false)],
    achievement_level: { level: 4, progress: 20 }, featured_award: null, featured_title: null, featured_emblems: [],
    awards: sees ? [INTERNAL_AWARD, PUBLIC_AWARD] : [PUBLIC_AWARD],
    references: { items, stats: { total: items.length, tournaments: items.length, fastlaps: 0, wins: 1, podiums: items.length } },
  };
}

async function mockServer(page, { viewer = null } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  const server = { owner: { ...OWNER }, viewer, patches: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (apiPath.startsWith("/changes")) return route.abort();
    if (apiPath === "/auth/me") {
      if (!server.viewer) return json({}, 401);
      return json(server.viewer.id === server.owner.id ? server.owner : server.viewer);
    }
    if (apiPath === "/users/me" && request.method() === "PATCH") {
      const body = request.postDataJSON() || {};
      server.patches.push(body);
      server.owner = { ...server.owner, ...body };
      return json(server.owner);
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (apiPath === `/users/public/${OWNER.username}`) {
      const asGuest = url.searchParams.get("view_as") === "public";
      return json(profileFor(asGuest ? null : server.viewer, server.owner));
    }
    if (apiPath === "/friends") return json({ incoming: [], friends: [], outgoing: [] });
    if (apiPath === "/me/rewards/unseen") return json({ rewards: [] });
    if (apiPath === "/me/platform-links") return json({ links: [], available: {}, platforms: {} });
    if (apiPath === "/users/me/notification-preferences") return json({});
    if (apiPath.startsWith("/achievements/user/")) return json({ groups: [], awards: [] });
    if (apiPath.startsWith("/profile/")) return json({ opponents: [] });
    const objects = ["/settings/public", "/home/about", "/chats/unread", "/seasonal/active"];
    return json(objects.includes(apiPath) ? {} : []);
  });
  return server;
}

// Leiste unten, Kopfzeile und „nach oben“ liegen sonst über dem Ausschnitt.
const HIDE_CHROME = ".tls-bottom-nav, [data-testid=site-header], [data-testid=scroll-top-btn], .tls-skip-link { visibility: hidden !important; } .sticky { position: static !important; }";

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(target, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await target.screenshot({ path: path.join(dir, `${name}.png`), animations: "disabled",
    style: HIDE_CHROME });
}

// Ausschnitt über mehrere Schalter-Zeilen: von der Zeile mit `first` bis zur Zeile mit `last`.
async function shotRows(page, first, last, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  const top = first.locator("xpath=..");
  const bottom = last.locator("xpath=..");
  await top.scrollIntoViewIfNeeded();
  const a = await top.boundingBox();
  const b = await bottom.boundingBox();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const pad = 8;
  const left = Math.max(0, Math.min(a.x, b.x) - pad);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true, animations: "disabled", style: HIDE_CHROME,
    clip: { x: left + scroll.x, y: Math.max(0, a.y - pad) + scroll.y, width: Math.max(a.x + a.width, b.x + b.width) + pad - left, height: b.y + b.height - a.y + 2 * pad } });
}

test.describe("Vereinsinterne Erfolge im Profil", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`Mitglied bei ${width} px: interner Eintrag mit Etikett „Vereinsintern“`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page, { viewer: MEMBER });
      await page.goto(`/u/${OWNER.username}`);
      const references = page.getByTestId("profile-references-preview");
      await expect(references.getByTestId("profile-reference-tournament:t-verein")).toContainText("Vereinsabend-Cup");
      await expect(references.getByTestId("internal-tag-reference-tournament:t-verein")).toContainText("Vereinsintern");
      await expect(references.getByTestId("internal-tag-reference-tournament:t-offen")).toHaveCount(0);
      await expect(page.getByTestId("internal-tag-award-verein")).toBeVisible();
      await expect(page.getByTestId("internal-tag-award-offen")).toHaveCount(0);
      await noSideScroll(page);
      await shot(references, `profil-mitglied-${width}`);

      await page.getByTestId("profile-tab-awards").click();
      await expect(page.getByTestId("internal-tag-trophy-verein")).toContainText("Vereinsintern");
      await expect(page.getByTestId("internal-tag-trophy-offen")).toHaveCount(0);
      await noSideScroll(page);
    });

    test(`Gast bei ${width} px: kein interner Eintrag, kein Etikett`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await mockServer(page);
      await page.goto(`/u/${OWNER.username}`);
      const references = page.getByTestId("profile-references-preview");
      await expect(references.getByTestId("profile-reference-tournament:t-offen")).toContainText("Offen-Cup");
      await expect(references.getByTestId("profile-reference-tournament:t-verein")).toHaveCount(0);
      await expect(page.getByText("Vereinsintern")).toHaveCount(0);
      await noSideScroll(page);
      await shot(references, `profil-gast-${width}`);
    });

    test(`Schalter bei ${width} px: aus heißt, auch Mitglieder sehen nur Öffentliches`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      const server = await mockServer(page, { viewer: OWNER });
      await page.goto("/profile?tab=privacy");
      const row = page.getByTestId("profile-privacy-internal");
      await expect(row).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText("Mitglieder sehen auch deine vereinsinternen Turniere, Zeiten und Trophäen. Öffentlich sind sie nie zu sehen.")).toBeVisible();
      await noSideScroll(page);
      await shotRows(page, page.getByTestId("profile-privacy-achievements"), page.getByTestId("profile-privacy-season-finds"), `schalter-${width}`);
      await row.click();
      await expect.poll(() => server.patches.at(-1)).toEqual({ privacy_members_see_internal: false });
      await expect(row).toHaveAttribute("aria-checked", "false");

      // Jetzt schaut ein Mitglied: nur noch das Öffentliche.
      server.viewer = MEMBER;
      await page.goto(`/u/${OWNER.username}`);
      const references = page.getByTestId("profile-references-preview");
      await expect(references.getByTestId("profile-reference-tournament:t-offen")).toBeVisible();
      await expect(references.getByTestId("profile-reference-tournament:t-verein")).toHaveCount(0);
      await expect(page.getByText("Vereinsintern")).toHaveCount(0);
    });
  }
});

// Ausschnitt von `first` bis `last` (beide sichtbar im selben Reiter) - für die Bilder der Runde 2.
async function shotSpan(page, first, last, name) {
  const dir = process.env.E2E_SCREENS_DIR;
  if (!dir) return;
  await first.scrollIntoViewIfNeeded();
  const a = await first.boundingBox();
  const b = await last.boundingBox();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const pad = 8;
  const left = Math.max(0, Math.min(a.x, b.x) - pad);
  const right = Math.max(a.x + a.width, b.x + b.width) + pad;
  const top = Math.max(0, Math.min(a.y, b.y) - pad);
  const bottom = Math.max(a.y + a.height, b.y + b.height) + pad;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true, animations: "disabled", style: HIDE_CHROME,
    clip: { x: left + scroll.x, y: top + scroll.y, width: right - left, height: bottom - top } });
}

test.describe("Vereinsintern, Runde 2: Teilnahmen, Bestzeiten, Zahlen und Liga (#2521)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    for (const [who, viewer] of [["mitglied", MEMBER], ["gast", null]]) {
      test(`${who} bei ${width} px: Teilnahmen, Bestzeiten, Zahlen und Seasons nach derselben Regel`, async ({ page }) => {
        const member = Boolean(viewer);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width, height });
        await mockServer(page, { viewer });
        await page.goto(`/u/${OWNER.username}`);

        // Zahlen: das Mitglied zählt das Interne mit, der Gast sieht die öffentlichen Werte.
        const stats = member ? MEMBER_STATS : GUEST_STATS;
        await expect(page.getByTestId("profile-stat-tournaments")).toContainText(String(stats.tournaments));
        await expect(page.getByTestId("profile-stat-fastlaps")).toContainText(String(stats.fast_laps));
        await expect(page.getByTestId("profile-stat-top3")).toContainText(String(stats.top3));

        const history = page.getByTestId("profile-league-history");
        await expect(history.getByTestId("profile-league-history-s-offen")).toContainText("Season 1");
        await expect(history.getByTestId("profile-league-history-s-offen-internal")).toHaveCount(0);
        const standing = page.getByTestId("profile-league-overall");
        if (member) {
          await expect(history.getByTestId("profile-league-history-s-verein-internal")).toContainText("Vereinsintern");
          await expect(standing.getByTestId("profile-league-overall-1-internal")).toContainText("Vereinsintern");
        } else {
          await expect(history.getByTestId("profile-league-history-s-verein")).toHaveCount(0);
          await expect(standing.getByTestId("profile-league-overall-1-internal")).toHaveCount(0);
          await expect(page.getByText("Vereinsintern")).toHaveCount(0);
        }
        await noSideScroll(page);
        await shotSpan(page, page.getByTestId("profile-stats"), standing, `profil-${who}-${width}-zahlen-liga`);

        await page.getByTestId("profile-tab-references").click();
        const tournaments = page.getByTestId("public-profile-tournaments");
        const laps = page.getByTestId("public-profile-fastlaps");
        await expect(tournaments.getByTestId("profile-tournament-offener-abend")).toContainText("Offener Abend");
        await expect(tournaments.getByTestId("internal-tag-tournament-t-offen-2")).toHaveCount(0);
        await expect(laps.getByTestId("profile-fastlap-offen-hotlap")).toContainText("Spielberg");
        await expect(laps.getByTestId("internal-tag-fastlap-c-offen")).toHaveCount(0);
        if (member) {
          await expect(tournaments.getByTestId("internal-tag-tournament-t-verein-2")).toContainText("Vereinsintern");
          await expect(laps.getByTestId("internal-tag-fastlap-c-verein")).toContainText("Vereinsintern");
        } else {
          await expect(tournaments.getByTestId("profile-tournament-vereins-training")).toHaveCount(0);
          await expect(laps.getByTestId("profile-fastlap-vereins-hotlap")).toHaveCount(0);
          await expect(page.getByText("Vereinsintern")).toHaveCount(0);
        }
        await noSideScroll(page);
        await shotSpan(page, tournaments, laps, `profil-${who}-${width}-teilnahmen-bestzeiten`);
      });
    }
  }
});
