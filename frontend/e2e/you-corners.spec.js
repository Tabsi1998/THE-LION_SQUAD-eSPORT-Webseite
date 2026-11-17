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
      expect(await corners(own, "::after")).toMatchObject({ layers: 8 });
      await expect(page.locator("tr.tls-you")).toHaveCount(1);
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
      await expect(node.getByText("Du", { exact: true }).first()).toBeVisible();
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
    expect(await sideScroll(page)).toBeLessThanOrEqual(1);
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

// Vergleichsbilder für Fabian (nur mit YOU_SHOTS): je Motiv 390 und 1440 px.
test.describe("Bilder vorher/nachher (#1316)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile) || !SHOTS, "nur mit YOU_SHOTS");

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
