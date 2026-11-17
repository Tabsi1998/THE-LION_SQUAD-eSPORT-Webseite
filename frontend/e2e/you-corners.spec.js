const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fixture = require("./fixtures/tableScheduleGenerated.json");

// Ecken-Klammern (#1316): „das bist du“ trägt vier cyane Winkel, eine leichte Fläche und das Etikett „Du“ - in der
// Rangliste, im Turnierbaum und im Kalender, nur bei der eigenen Person. Derselbe Winkel ist der Tastatur-Fokus an
// Knöpfen, dazu ein durchsichtiger Rahmen für den Kontrast-Modus. Nichts davon schiebt die Seite seitlich (360/390/1440).
// Die API ist nachgestellt. Mit YOU_SHOTS=<Ordner> (und YOU_PHASE=vorher|nachher) legt der Lauf die Vergleichsbilder ab.

const SHOTS = process.env.YOU_SHOTS || "";
const PHASE = process.env.YOU_PHASE || "nachher";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const PLAYER = { id: "spieler-1", username: "spieler", display_name: "Spieler", role: "user" };

async function consent(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false,
      tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
}

// Turnier aus den echten Generatoren (scripts/make_table_schedule_fixture.py), angemeldet als die eigene Person.
async function mockTournament(page, set) {
  await consent(page);
  const { tournament } = set;
  const base = `/api/tournaments/${tournament.id}`;
  const answers = {
    [`/api/tournaments/${tournament.slug}`]: tournament,
    [base]: tournament,
    [`${base}/bracket`]: set.bracket,
    [`${base}/standings`]: set.standings || [],
    [`${base}/matchdays`]: set.matchdays || { applies: false, matchdays: [] },
    [`${base}/registrations`]: set.bracket?.registrations || [],
    "/api/auth/me": PLAYER,
    "/api/settings/public": { club_name: "THE LION SQUAD" },
  };
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") return route.fulfill(json({}, 405));
    if (pathname in answers) return route.fulfill(json(answers[pathname]));
    const list = /\/(sponsors|notifications|games|partners|teams\/my|achievements\/me|streams)/.test(pathname);
    return route.fulfill({ contentType: "application/json", body: list ? "[]" : "{}" });
  });
}

const LAN = {
  id: "e-lan", kind: "event", slug: "lan", title: "Herbst-LAN", start: "2026-12-12T10:00:00+01:00", end: "2026-12-12T22:00:00+01:00",
  status: "scheduled", phase: null, location: "Vereinsheim", path: "/events/lan", visibility: "public", mine: false, marker: null,
};
const CUP = {
  id: "t-cup", kind: "tournament", slug: "cup", title: "Winter-Cup", start: "2026-12-12T19:00:00+01:00", end: null, status: "registration_open",
  phase: { label: "Anmeldung offen", state: "registration_open" }, location: "Mario Kart 8", path: "/tournaments/cup", visibility: "public", mine: true, marker: null,
};

async function mockCalendar(page) {
  await page.clock.setFixedTime(new Date("2026-12-02T10:00:00+00:00"));
  await consent(page);
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/calendar") return route.fulfill(json({ items: [LAN, CUP], signed_in: true, feed_path: "/api/calendar/feed.ics" }));
    if (pathname === "/api/calendar/personal") return route.fulfill(json({ active: false, created_at: null, last_used_at: null }));
    if (pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }));
    if (pathname === "/api/auth/me") return route.fulfill(json(PLAYER));
    return route.fulfill(json({}));
  });
}

// Spieler mit den Leveln, die früher einen Ecken-Effekt im Rahmen hatten (3, 7, 9, 24).
const PLAYERS = [3, 7, 9, 24].map((level) => ({
  id: `p-${level}`, username: `level${level}`, display_name: `Level ${level}`, achievement_level: { level }, avatar_url: null,
}));

async function mockPlayers(page) {
  await consent(page);
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/users/public-list") return route.fulfill(json({ items: PLAYERS, total: PLAYERS.length }));
    if (pathname === "/api/achievements/crowns") return route.fulfill(json({ crowns: {} }));
    if (pathname === "/api/membership/public") return route.fulfill(json([]));
    if (pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD" }));
    if (pathname === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    return route.fulfill(json({}));
  });
}

async function sideScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Die Ecken eines Elements: das Pseudo-Element mit den acht Verläufen (::after für „du“, ::before für den Fokus). */
function corners(locator, pseudo) {
  return locator.evaluate((node, which) => {
    const style = getComputedStyle(node, which);
    return { content: style.content, layers: (style.backgroundImage.match(/linear-gradient/g) || []).length, inset: style.top };
  }, pseudo);
}

const ownRegistration = (set) => set.bracket.registrations.find((reg) => reg.is_mine);

/**
 * Tabellenzeile (#1316, Fix-Runde): die Winkel liegen als Hintergrund an der ersten und der letzten sichtbaren Zelle -
 * je vier Striche plus die Fläche. Dazu: hängt etwas an der Zeile selbst (::after)?
 */
function rowCorners(row) {
  return row.evaluate((tr) => {
    const cells = [...tr.children].filter((cell) => getComputedStyle(cell).display !== "none");
    const layers = (cell) => (getComputedStyle(cell).backgroundImage.match(/linear-gradient/g) || []).length;
    const pos = (cell) => getComputedStyle(cell).backgroundPosition;
    return {
      first: layers(cells[0]), firstPos: pos(cells[0]),
      last: layers(cells[cells.length - 1]), lastPos: pos(cells[cells.length - 1]),
      middle: cells.slice(1, -1).map(layers),
      rowAfter: getComputedStyle(tr, "::after").content,
      firstColor: getComputedStyle(cells[0]).backgroundColor,
    };
  });
}

const SEASON_ROW = (rank, id, name) => ({ rank, user_id: id, username: name.toLowerCase(), display_name: name, points: 120 - rank * 10, events_count: 4, wins: 1, source_breakdown: [] });
const SEASON = {
  season: { id: "s1", slug: "2026", name: "Jahreswertung 2026", status: "active" },
  standings: [SEASON_ROW(1, "u-1", "NeonFalke"), SEASON_ROW(2, PLAYER.id, "Spieler"), SEASON_ROW(3, "u-3", "LunaByte"), SEASON_ROW(4, "u-4", "PixelPirat"), SEASON_ROW(5, "u-5", "KartKönigin")],
};

async function mockSeason(page) {
  await consent(page);
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/seasons/2026/standings") return route.fulfill(json(SEASON));
    if (pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD" }));
    if (pathname === "/api/auth/me") return route.fulfill(json(PLAYER));
    return route.fulfill(json({}));
  });
}

const GAMES = ["Rocket League", "Mario Kart 8", "EA FC 26", "Valorant"].map((name, index) => ({ id: `g${index}`, name, slug: `spiel-${index}`, tournaments: 3 + index, references: 0 }));

async function mockEsports(page) {
  await consent(page);
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/home/about") return route.fulfill(json({ games: GAMES }));
    if (pathname === "/api/tournaments" || pathname === "/api/f1/challenges") return route.fulfill(json([]));
    if (pathname === "/api/leagues") return route.fulfill(json({ leagues: [] }));
    if (pathname === "/api/settings/public") return route.fulfill(json({ club_name: "THE LION SQUAD" }));
    if (pathname === "/api/auth/me") return route.fulfill(json({ detail: "anonym" }, 401));
    return route.fulfill(json({}));
  });
}

// Baum mit Team-Anmeldung: die eigene Anmeldung gehört einem Team - das Etikett heißt „Dein Team“.
const teamFinished = () => {
  const set = JSON.parse(JSON.stringify(fixture.finished));
  for (const reg of set.bracket.registrations) if (reg.is_mine) reg.team_id = "tm-1";
  return set;
};

test.describe("„du“ mit Ecken und Etikett (#1316)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Breite wird hier selbst gesetzt");

  for (const width of [360, 390, 1440]) {
    test(`Rangliste: nur die eigene Zeile trägt Ecken und „Du“ - ${width} px ohne Querlauf`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockTournament(page, fixture.league);
      await page.goto(`/tournaments/${fixture.league.tournament.slug}/standings`);
      const own = page.locator("tr[data-mine='true']");
      await expect(own).toHaveCount(1);
      await expect(own).toHaveClass(/\btls-you\b/);
      await expect(own.locator(".tls-standing-me")).toHaveText("Du");
      // Nichts hängt an der Zeile selbst: erste und letzte sichtbare Zelle tragen je vier Striche und die Fläche.
      const cells = await rowCorners(own);
      expect(cells).toMatchObject({ first: 5, last: 5, rowAfter: "none" });
      expect(cells.firstPos).toContain("0% 0%");
      expect(cells.lastPos).toContain("100% 0%");
      expect(cells.middle.every((count) => count === 1)).toBe(true);
      await expect(page.locator("tr.tls-you")).toHaveCount(1);
      expect(await sideScroll(page)).toBeLessThanOrEqual(1);
    });

    test(`Rangliste mit Sticky-Spalten: die Winkel bleiben über der Fläche der Spalte - ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockTournament(page, fixture.league);
      await page.goto(`/tournaments/${fixture.league.tournament.slug}/standings`);
      const own = page.locator("tr[data-mine='true']");
      await expect(own).toHaveCount(1);
      // Dieselbe Tabelle in der Hülle der Staffel-Seite (#2262): # und Name kleben beim Wischen und haben eine eigene Fläche.
      await page.locator(".tls-standings").first().evaluate((node) => node.parentElement.classList.add("staffel-standings"));
      const cells = await rowCorners(own);
      expect(cells).toMatchObject({ first: 5, last: 5 });
      if (width < 640) {
        const sticky = await own.evaluate((tr) => getComputedStyle(tr.children[0]).position);
        expect(sticky).toBe("sticky");
        // Die Fläche der Sticky-Spalte bleibt deckend, die Winkel liegen darauf.
        expect(cells.firstColor).not.toBe("rgba(0, 0, 0, 0)");
      }
      expect(await sideScroll(page)).toBeLessThanOrEqual(1);
    });

    test(`Turnierbaum: das eigene Match trägt Ecken statt Leuchten - ${width} px ohne Querlauf`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockTournament(page, fixture.finished);
      await page.goto(`/tournaments/${fixture.finished.tournament.slug}/bracket`);
      const mineId = ownRegistration(fixture.finished).id;
      const ownCount = fixture.finished.bracket.matches_v2.filter((match) => (match.slots || []).slice(0, 2).some((slot) => slot.registration_id === mineId)).length;
      await expect(page.locator("[data-mine='true']").first()).toBeVisible();
      // Am PC steht der ganze Baum da, am Handy Runde für Runde - dort zählen die gezeigten eigenen Matches.
      const shown = width >= 1024 ? ownCount : await page.locator(".tls-bracket-node[data-mine='true']").count();
      expect(shown).toBeGreaterThan(0);
      await expect(page.locator(".tls-bracket-node.tls-you")).toHaveCount(shown);
      await expect(page.locator(".tls-bracket-node.tls-you:not([data-mine='true'])")).toHaveCount(0);
      const node = page.locator(".tls-bracket-node.tls-you").first();
      expect(await corners(node, "::after")).toMatchObject({ layers: 8, inset: "-5px" });
      await expect(node.locator(".tls-you-tag").first()).toHaveText("Du");
      // Pille in gemischter Schreibung - nicht wie ein Initialen-Kästchen „DU“.
      expect(await node.locator(".tls-you-tag").first().evaluate((tag) => getComputedStyle(tag).textTransform)).toBe("none");
      expect(await sideScroll(page)).toBeLessThanOrEqual(1);
    });

    test(`Jahreswertung: Ecken an deiner Zeile, am Podest nur „Du“ - ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockSeason(page);
      await page.goto("/seasons/2026");
      const own = width >= 768 ? page.getByTestId(`season-row-${PLAYER.id}`) : page.getByTestId(`season-item-${PLAYER.id}`);
      await expect(own).toHaveClass(/\btls-you\b/);
      await expect(page.locator(".tls-you:visible")).toHaveCount(1);
      const podium = page.locator("a[href='/u/spieler']").filter({ hasNot: page.locator("tr") }).first();
      await expect(podium.locator(".tls-you-tag")).toHaveText("Du");
      await expect(podium).not.toHaveClass(/\btls-you\b/);
      expect(await sideScroll(page)).toBeLessThanOrEqual(1);
    });

    test(`Kalender: der eigene Termin trägt Ecken und „Du“, fremde nicht - ${width} px ohne Querlauf`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockCalendar(page);
      await page.goto("/calendar");
      await page.getByTestId("calendar-view-list").click();
      const own = page.getByTestId("calendar-list").getByTestId("calendar-item-tournament-t-cup");
      const frame = own.getByTestId("calendar-you-frame-tournament-t-cup");
      await expect(frame).toHaveClass(/\btls-you\b/);
      await expect(own.locator(".tls-you-tag")).toHaveText("Du");
      expect(await corners(frame, "::after")).toMatchObject({ layers: 8, inset: "-5px" });
      await expect(page.getByTestId("calendar-list").getByTestId("calendar-item-event-e-lan").locator(".tls-you")).toHaveCount(0);
      expect(await sideScroll(page)).toBeLessThanOrEqual(1);
      // Monat: der Tag mit deinem Termin trägt die Ecken an der Kante, ohne Etikett; die Legende zeigt dasselbe Zeichen.
      await page.getByTestId("calendar-view-month").click();
      const day = page.getByTestId("calendar-day-2026-12-12");
      await expect(day).toHaveClass(/\btls-you\b/);
      expect(await corners(day, "::after")).toMatchObject({ layers: 8, inset: "0px" });
      await expect(day.locator(".tls-you-tag")).toHaveCount(0);
      await expect(page.getByTestId("calendar-day-2026-12-11")).not.toHaveClass(/\btls-you\b/);
      await expect(page.getByTestId("calendar-legend-you")).toHaveClass(/\btls-you\b/);
      // Kleines Zeichen: Winkel von 4 px - sonst sähe es aus wie ein Kästchen.
      expect(await page.getByTestId("calendar-legend-you").evaluate((node) => getComputedStyle(node, "::after").backgroundSize)).toContain("4px 2px");
      expect(await sideScroll(page)).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("Tastatur-Fokus mit Ecken (#1316)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Tastatur nur am PC");

  test("Knopf: Ecken außen, durchsichtiger Rahmen - im Kontrast-Modus sichtbar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockCalendar(page);
    await page.goto("/calendar");
    const button = page.getByTestId("calendar-view-month");
    await expect(button).toBeVisible();
    await button.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    expect(await button.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
    expect(await corners(button, "::before")).toMatchObject({ layers: 8, inset: "-5px" });
    const outline = await button.evaluate((node) => { const s = getComputedStyle(node); return { style: s.outlineStyle, width: s.outlineWidth }; });
    expect(outline).toEqual({ style: "solid", width: "2px" });
    // Kontrast-Modus: der Rahmen bekommt die Systemfarbe und bleibt 2 px breit.
    await page.emulateMedia({ forcedColors: "active" });
    const forced = await button.evaluate((node) => { const s = getComputedStyle(node); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }; });
    expect(forced.style).toBe("solid");
    expect(forced.width).toBe("2px");
    expect(forced.color).not.toBe("rgba(0, 0, 0, 0)");
    // „du“ hängt im Kontrast-Modus nicht nur am Wort: der Tag mit deinem Termin bekommt einen Rahmen in der Systemfarbe.
    const you = page.locator("[data-testid^='calendar-day-'].tls-you").first();
    await expect(you).toBeVisible();
    const youOutline = await you.evaluate((node) => { const s = getComputedStyle(node); return { style: s.outlineStyle, width: s.outlineWidth }; });
    expect(youOutline).toEqual({ style: "solid", width: "2px" });
    await page.emulateMedia({ forcedColors: "none" });
    expect(await you.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
    expect(await sideScroll(page)).toBeLessThanOrEqual(1);
  });

  test("wischbare Leiste: die Fokus-Winkel einer Karte sitzen an der Kante und werden nicht abgeschnitten (390 px)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockEsports(page);
    await page.goto("/esports");
    const card = page.getByTestId("esports-game-g0");
    await expect(card).toBeVisible();
    await card.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    expect(await corners(card, "::after")).toMatchObject({ layers: 8, inset: "0px" });
    // Erst messen, wenn die Karte fertig angehoben ist (5 px).
    await page.waitForTimeout(600);
    // Die Leiste schneidet an ihrer Innenkante - die Winkel liegen ganz innerhalb der Karte.
    const fits = await card.evaluate((node) => {
      const strip = node.closest(".tls-swipe").getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return box.top >= strip.top && box.bottom <= strip.bottom;
    });
    expect(fits).toBe(true);
    expect(await sideScroll(page)).toBeLessThanOrEqual(1);
  });

  test("Live-Karte mit Fokus: Live-Licht (::before) und Fokus-Winkel (::after) nebeneinander", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockEsports(page);
    await page.goto("/esports");
    const card = page.getByTestId("esports-game-g1");
    await expect(card).toBeVisible();
    await card.evaluate((node) => node.classList.add("tls-live-frame"));
    await card.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    expect(await card.evaluate((node) => getComputedStyle(node, "::before").backgroundImage)).toContain("conic-gradient");
    expect(await corners(card, "::after")).toMatchObject({ layers: 8 });
  });

  test("ohne Tastatur keine Ecken: ein Mausklick zeigt keinen Fokus-Winkel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockCalendar(page);
    await page.goto("/calendar");
    const button = page.getByTestId("calendar-view-month");
    await button.click();
    expect(await corners(button, "::before")).toMatchObject({ content: "none" });
  });
});

// Bilder der Fix-Runde (nur mit YOU_SHOTS und YOU_PHASE=v2): Rangliste 390, Jahreswertung mit Podest, Kalender Monat
// und Liste, Fokus in einer wischbaren Leiste, Baum mit Team-Etikett.
test.describe("Bilder v2 (#1316)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile) || !SHOTS || PHASE !== "v2", "nur mit YOU_SHOTS und YOU_PHASE=v2");
  const save = (name) => path.join(SHOTS, `${name}-v2.png`);

  test("Bilder v2", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 900 });
    await mockTournament(page, fixture.league);
    await page.goto(`/tournaments/${fixture.league.tournament.slug}/standings`);
    await page.locator("tr[data-mine='true']").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(600);
    await page.screenshot({ path: save("rangliste-390") });

    for (const width of [390, 1440]) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.setViewportSize({ width, height: 900 });
      await mockSeason(page);
      await page.goto("/seasons/2026");
      await page.getByText("Top Teilnehmer").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await page.screenshot({ path: save(`jahreswertung-${width}`), fullPage: true });
    }

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockCalendar(page);
    await page.goto("/calendar");
    await page.getByTestId("calendar-view-month").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: save("kalender-monat-1440") });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByTestId("calendar-view-list").click();
    await page.getByTestId("calendar-list").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: save("kalender-liste-390") });

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockEsports(page);
    await page.goto("/esports");
    const card = page.getByTestId("esports-game-g0");
    await card.scrollIntoViewIfNeeded();
    await card.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(400);
    const strip = await page.getByTestId("esports-game-competitive").boundingBox();
    await page.screenshot({ path: save("fokus-swipe-390"), clip: { x: 0, y: Math.max(0, strip.y - 30), width: 390, height: strip.height + 60 } });

    for (const width of [390, 1440]) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.setViewportSize({ width, height: 900 });
      await mockTournament(page, teamFinished());
      await page.goto(`/tournaments/${fixture.finished.tournament.slug}/bracket`);
      const node = page.locator(".tls-bracket-node[data-mine='true']").first();
      await node.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -150));
      await page.waitForTimeout(800);
      await page.screenshot({ path: save(`turnierbaum-team-${width}`) });
    }
  });
});

// Vergleichsbilder für Fabian (nur mit YOU_SHOTS): je Motiv 390 und 1440 px.
test.describe("Bilder vorher/nachher (#1316)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile) || !SHOTS || PHASE === "v2", "nur mit YOU_SHOTS");

  const save = (motiv, width) => path.join(SHOTS, `${motiv}-${PHASE}-${width}.png`);

  for (const width of [390, 1440]) {
    test(`Bilder ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });

      await mockTournament(page, fixture.league);
      await page.goto(`/tournaments/${fixture.league.tournament.slug}/standings`);
      const row = page.locator("tr[data-mine='true']");
      await row.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(600);
      await page.screenshot({ path: save("rangliste", width) });

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockTournament(page, fixture.finished);
      await page.goto(`/tournaments/${fixture.finished.tournament.slug}/bracket`);
      const node = page.locator(".tls-bracket-node[data-mine='true']").first();
      await node.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -150));
      await page.waitForTimeout(800);
      await page.screenshot({ path: save("turnierbaum", width) });

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockCalendar(page);
      await page.goto("/calendar");
      if (width >= 1024) {
        await page.getByTestId("calendar-view-month").click();
        await page.getByText("12", { exact: true }).first().click();
        await page.getByTestId("calendar-day-items").scrollIntoViewIfNeeded();
      } else {
        await page.getByTestId("calendar-view-list").click();
        await page.getByTestId("calendar-list").scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(600);
      await page.screenshot({ path: save("kalender", width) });

      // Fokus mit der Tastatur auf einem Knopf: Ausschnitt rund um den Knopf.
      await page.goto("/calendar");
      const button = page.getByTestId("calendar-view-month");
      await button.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const box = await button.boundingBox();
      await page.screenshot({ path: save("fokus-knopf", width), clip: { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 40), width: Math.min(width - Math.max(0, box.x - 60), box.width + 180), height: box.height + 80 } });

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockPlayers(page);
      await page.goto("/players");
      await page.getByTestId("player-card-level24").scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: save("level-rahmen", width) });
    });
  }
});
