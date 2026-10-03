const { test, expect } = require("@playwright/test");
const { activePayload, mockSeason, seasonOverlaps } = require("./seasonQa");

// Ostereiersuche (#646, #754, #755, #758): Eier auf echten Seiten, im Browser geprüft, was kein Unit-Test sieht -
// sie liegen in Ecken echter Karten, nie über Schrift oder Bildern, die unter der Seite warten, bis man hinscrollt;
// kein Querscrollen, auch nicht durch den Hinweis am Rand; Gäste werden eingeladen, angemeldet zählt der Fund, das
// Widget folgt, das letzte Ei füllt den Korb. Dazu die Seite /ostern und die Verwaltung. Server und Konto sind
// Attrappen im Browser.

const NOW = "2027-03-27T11:00:00+01:00";
const SEASON = { key: "easter_hunt", label: "Ostereiersuche", phase: "suche", intensity: "normal", channels: ["web", "app"], texts: {}, data: { good_friday: "2027-03-26", easter_monday: "2027-03-29" }, starts_at: "2027-03-26T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", forced: false };
const USER = { id: "u-anna", email: "anna@example.test", display_name: "Anna", username: "anna", role: "user", seasonal_decorations: "on" };
const ADMIN = { id: "admin-1", email: "admin@example.test", display_name: "Vorstand", username: "vorstand", role: "superadmin", is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };
const TOTAL = 12;
/** Nummer, Art, Element, Ecke, Muster - wie der Server die Verstecke einer Seite beschreibt. */
const HIDDEN = {
  "/news": [[1, "card", 0, "bottom-right", "dots"], [2, "card", 2, "top-left", "stripes"], [3, "header", 0, "top-right", "lion"], [4, "footer", 0, "bottom-left", "waves"]],
  "/": [[5, "hero", 0, "bottom-right", "flowers"], [6, "card", 1, "top-right", "stars"]],
};
const PATTERN_OF = Object.fromEntries(Object.values(HIDDEN).flat().map(([no, , , , pattern]) => [no, pattern]));

function fresh(overrides = {}) {
  return { user: null, before: [], found: [], finds: [], eggRequests: [], ...overrides };
}

function foundCount(state) {
  return state.before.length + state.found.length;
}

function basket(state) {
  const count = foundCount(state);
  return { active: true, found: count, total: TOTAL, completed_at: count >= TOTAL ? "2027-03-27T10:59:00+01:00" : null, rank: count >= TOTAL ? 2 : null };
}

function huntPage(state) {
  const count = foundCount(state);
  const mine = [...state.before, ...state.found].map((no, i) => ({ egg_no: no, pattern: PATTERN_OF[no] || ["zigzag", "checks", "leaves", "hearts", "spiral", "diamonds"][no % 6], found_at: `2027-03-26T${String(9 + (i % 10)).padStart(2, "0")}:00:00+01:00` }));
  return {
    phase: "running", year: 2027, starts_at: SEASON.starts_at, ends_at: SEASON.ends_at, egg_count: TOTAL, completed: 3,
    prizes: [{ kind: "raffle_all", label: "TLS-Hoodie", value: "Größe nach Wahl", title: "Verlosung unter allen mit vollem Korb" }, { kind: "fastest_1", label: "Gaming-Headset", value: "", title: "Schnellste:r" }],
    fastest: [{ rank: 1, display_name: "Paula", username: "paula", duration_seconds: 3720 }, { rank: 2, display_name: "Kai", username: "kai", duration_seconds: 90061 }],
    terms: ["Die Suche läuft von Karfreitag 0 Uhr bis Ostermontag 23:59 Uhr.", "Mitmachen kann, wer ein Konto hat. Vorstand und Verwaltung suchen mit, gewinnen aber nichts."],
    me: state.user ? { active: true, found: count, total: TOTAL, eggs: mine, hints_open: true, hints_open_at: "2027-03-27T00:00:00+01:00", hints: count >= TOTAL ? [] : [{ egg_no: 7, hint: "Schau bei den Turnieren an einer Karte." }, { egg_no: 9, hint: "Schau bei „Über uns“ an einem Bild." }], missing: TOTAL - count, completed_at: count >= TOTAL ? "2027-03-27T10:59:00+01:00" : null, rank: count >= TOTAL ? 2 : null } : null,
  };
}

/** Die Suche als Attrappe: `state` hält, was der „Server“ weiß, und schreibt mit, was gefragt wurde. */
async function mockHunt(page, state) {
  await mockSeason(page, activePayload({ season: SEASON, now: NOW }));
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/auth/me", (route) => json(route, state.user));
  await page.route("**/api/seasonal/me", (route) => json(route, { scares_allowed: false }));
  await page.route(/\/api\/seasonal\/easter\/eggs(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("route");
    state.eggRequests.push(`${path}|${url.searchParams.get("channel")}`);
    const eggs = (HIDDEN[path] || []).map(([egg_no, kind, index, place, pattern]) => ({ egg_no, token: `${egg_no}.1900000000.${"a".repeat(32)}`, spot: { kind, index, place }, pattern, found: state.before.includes(egg_no) || state.found.includes(egg_no) }));
    return json(route, { active: true, total: TOTAL, guest: !state.user, eggs });
  });
  await page.route("**/api/seasonal/easter/find", (route) => {
    const egg = Number.parseInt(route.request().postDataJSON().token, 10);
    state.finds.push(egg);
    const already = state.found.includes(egg);
    if (!already) state.found.push(egg);
    const count = foundCount(state);
    return json(route, { found: count, total: TOTAL, already, completed_now: !already && count === TOTAL, completed_at: count >= TOTAL ? "2027-03-27T10:59:00+01:00" : null, rank: count >= TOTAL ? 2 : null, egg: { egg_no: egg, pattern: PATTERN_OF[egg] } });
  });
  await page.route("**/api/seasonal/easter/me", (route) => json(route, basket(state)));
  await page.route("**/api/seasonal/easter/page", (route) => json(route, huntPage(state)));
}

async function shot(page, testInfo, name, target = page) {
  const file = testInfo.outputPath(name);
  await target.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

const overflowOf = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);

/** Eier, die gerade unter etwas Klebendem liegen (Kopfzeile, Leiste unten) - die sind verdeckt, nicht „über Text“. */
const coveredEggs = (page) => page.evaluate(() => [...document.querySelectorAll(".tls-egg")].filter((egg) => {
  const r = egg.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return Boolean(hit && !egg.contains(hit));
}).map((egg) => egg.dataset.testid));

/** Die Seite von oben nach unten durchgehen; je Schritt die Sonde „über Text?“ für jedes sichtbare Ei. */
async function walkPage(page, exempt = "") {
  const seen = new Set();
  const bad = [];
  for (let step = 0; step < 14; step += 1) {
    await page.waitForTimeout(500);
    const covered = await coveredEggs(page);
    const pieces = await seasonOverlaps(page, { pieces: ".tls-egg", layers: ".tls-eggs", exempt });
    pieces.filter((piece) => !covered.includes(piece.kind)).forEach((piece) => {
      seen.add(piece.kind);
      if (piece.overText) bad.push(piece);
    });
    const atEnd = await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);
    if (atEnd) break;
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.6)));
  }
  return { seen: [...seen].sort(), bad };
}

test.describe("Ostereiersuche", () => {
  test("Gast auf /news: Eier in Ecken echter Kanten, nie über Text; ein Klick lädt zum Anmelden ein", async ({ page, isMobile }, testInfo) => {
    const state = fresh();
    await mockHunt(page, state);
    await page.goto("/news");
    await expect(page.getByTestId("easter-egg-3")).toBeVisible({ timeout: 20000 });
    expect(state.eggRequests).toContain("/news|web");
    await page.waitForTimeout(2600);
    await shot(page, testInfo, `news-oben-${isMobile ? "handy" : "pc"}.png`);

    const walk = await walkPage(page);
    expect(walk.bad, `Eier über Text: ${JSON.stringify(walk.bad)}`).toEqual([]);
    expect(walk.seen, "jedes Ei der Seite hat beim Scrollen seinen Platz gefunden").toEqual(["easter-egg-1", "easter-egg-2", "easter-egg-3", "easter-egg-4"]);
    expect(await overflowOf(page), "kein horizontales Scrollen").toBeLessThanOrEqual(2);
    await shot(page, testInfo, `news-unten-${isMobile ? "handy" : "pc"}.png`);

    // Die Karten-Eier liegen in einer Ecke ihrer Karte - innen, 6 px vom Rand. Unten rechts steht „Weiterlesen →“,
    // unten links „Beitrag“: Ei 1 weicht in eine freie obere Ecke aus.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    const corner = await page.evaluate(() => {
      const egg = document.querySelector("[data-testid='easter-egg-1']").getBoundingClientRect();
      const card = document.querySelectorAll("[data-season-anchor='card']")[0].getBoundingClientRect();
      const near = (a, b) => Math.abs(a - b) <= 2;
      const x = near(egg.left, card.left + 6) ? "l" : near(egg.right, card.right - 6) ? "r" : "?";
      const y = near(egg.top, card.top + 6) ? "t" : near(egg.bottom, card.bottom - 6) ? "b" : "?";
      return `${y}${x}`;
    });
    expect(["tr", "tl"], "Ei 1 liegt in einer freien Ecke der ersten Karte").toContain(corner);

    // Gäste: der Hinweis lädt zum Anmelden ein, gezählt wird nichts; er bleibt im Fenster.
    await page.getByTestId("easter-egg-1").scrollIntoViewIfNeeded();
    await page.getByTestId("easter-egg-1").click();
    const note = page.getByTestId("easter-egg-note");
    await expect(note).toContainText("Anmelden, um Eier zu sammeln");
    await expect(note.getByRole("link", { name: "Anmelden" })).toHaveAttribute("href", "/login?next=%2Fnews");
    const box = await note.boundingBox();
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x, "Hinweis links im Fenster").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "Hinweis rechts im Fenster").toBeLessThanOrEqual(width);
    expect(await overflowOf(page), "der Hinweis macht kein Querscrollen").toBeLessThanOrEqual(2);
    expect(state.finds).toEqual([]);
    await page.waitForTimeout(400);
    await shot(page, testInfo, `gast-hinweis-${isMobile ? "handy" : "pc"}.png`);
    await page.getByRole("button", { name: "Hinweis schließen" }).click();
    await expect(note).toHaveCount(0);

    // Das Ei an der Kopfzeile: der Hinweis steht darunter, nicht über dem Menü.
    await page.getByTestId("easter-egg-3").click();
    const headerBottom = await page.evaluate(() => document.querySelector("header").getBoundingClientRect().bottom);
    const headerNote = await page.getByTestId("easter-egg-note").boundingBox();
    expect(headerNote.y, "Hinweis unter der Kopfzeile").toBeGreaterThanOrEqual(headerBottom);
  });

  test("Startseite: ein Ei zu Füßen des Löwen, eines an einer Karte - nie über Text", async ({ page, isMobile }, testInfo) => {
    const state = fresh();
    await mockHunt(page, state);
    await page.goto("/");
    await expect(page.getByTestId("easter-egg-5")).toBeAttached({ timeout: 20000 });
    await page.waitForTimeout(2600);
    await shot(page, testInfo, `start-${isMobile ? "handy" : "pc"}.png`);
    const walk = await walkPage(page, "[data-season-anchor='lion']");
    expect(walk.bad, `Eier über Text: ${JSON.stringify(walk.bad)}`).toEqual([]);
    expect(walk.seen).toEqual(["easter-egg-5", "easter-egg-6"]);
    expect(await overflowOf(page)).toBeLessThanOrEqual(2);
  });

  test("Kopfzeile und Menüs liegen über den Eiern", async ({ page, isMobile }, testInfo) => {
    const state = fresh();
    await mockHunt(page, state);
    await page.goto("/news");
    await expect(page.getByTestId("easter-egg-1")).toBeAttached({ timeout: 20000 });
    await page.waitForTimeout(2600);
    // Ein Karten-Ei, das unter die klebende Kopfzeile scrollt, verschwindet darunter.
    const covered = await page.evaluate(async () => {
      const egg = document.querySelector("[data-testid='easter-egg-1']");
      const header = document.querySelector("header").getBoundingClientRect();
      const top = egg.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - header.height + 4));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const r = egg.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, Math.max(1, Math.min(r.top + r.height / 2, header.bottom - 2)));
      return Boolean(hit && hit.closest("header"));
    });
    expect(covered, "die Kopfzeile liegt über dem Ei").toBe(true);
    if (isMobile) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId("nav-mobile-toggle").click();
      const menu = page.locator("#mobile-navigation");
      await expect(menu).toBeVisible();
      const onTop = await page.evaluate(() => {
        const egg = document.querySelector("[data-testid='easter-egg-3']");
        if (!egg) return true;
        const r = egg.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit && hit.closest("#mobile-navigation, header"));
      });
      expect(onTop, "das offene Menü liegt über dem Ei der Kopfzeile").toBe(true);
      await shot(page, testInfo, "menue-offen-handy.png");
    }
  });

  test("angemeldet: der Fund zählt, das Widget folgt, das letzte Ei füllt den Korb", async ({ page, isMobile }, testInfo) => {
    const state = fresh({ user: USER, before: [7, 8, 9, 10, 11, 12, 5, 6, 2, 4] });
    await mockHunt(page, state);
    await page.goto("/news");
    await expect(page.getByTestId("easter-hunt-widget-count")).toHaveText("10/12", { timeout: 20000 });
    // Auch im vollen Kopf (angemeldet) bleibt das Löwenei im Widget zu sehen.
    expect((await page.getByTestId("easter-hunt-widget").locator("svg").boundingBox()).width, "Ei im Widget sichtbar").toBeGreaterThanOrEqual(14);
    await expect(page.getByTestId("easter-egg-1")).toBeAttached();
    await expect(page.getByTestId("easter-egg-2")).toHaveCount(0);
    await page.waitForTimeout(2600);

    await page.getByTestId("easter-egg-1").scrollIntoViewIfNeeded();
    await page.getByTestId("easter-egg-1").click();
    await expect(page.getByTestId("easter-egg-note")).toHaveText("11 von 12");
    await expect(page.getByTestId("easter-eggs-live")).toHaveText("Osterei gefunden: 11 von 12.");
    await expect(page.getByTestId("easter-hunt-widget-count")).toHaveText("11/12");
    await expect(page.getByTestId("easter-egg-1")).toHaveCount(0);
    expect(state.finds).toEqual([1]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("easter-egg-3").click();
    const done = page.getByTestId("easter-egg-note");
    await expect(done).toContainText("Korb voll! Platz 2");
    await expect(page.getByTestId("easter-hunt-widget-count")).toHaveText("12/12");
    // Das letzte Ei der Seite ist weg - der Hinweis mit dem Weg zum Korb bleibt.
    await expect(page.getByTestId("easter-egg-3")).toHaveCount(0);
    await page.waitForTimeout(3200);
    await expect(done).toBeVisible();
    await shot(page, testInfo, `korb-voll-${isMobile ? "handy" : "pc"}.png`);
    await done.getByRole("link", { name: "Zum Korb" }).click();
    await expect(page).toHaveURL(/\/ostern$/);
    await expect(page.getByTestId("easter-basket-done")).toHaveText("Korb voll – Platz 2! Du bist in der Verlosung.");
    await expect(page.getByTestId("easter-basket").locator("[data-testid^='easter-basket-egg-']")).toHaveCount(12);
    await page.waitForTimeout(1200);
    expect(await overflowOf(page)).toBeLessThanOrEqual(2);
    await shot(page, testInfo, `ostern-voll-${isMobile ? "handy" : "pc"}.png`);
  });

  test("/ostern unterwegs: Korb mit Mulden, Hinweise, Preise, die Schnellsten; als Gast die Einladung", async ({ page, isMobile }, testInfo) => {
    const state = fresh({ user: USER, before: [5, 2, 9, 1, 11] });
    await mockHunt(page, state);
    await page.goto("/ostern");
    await expect(page.getByTestId("easter-basket-count")).toHaveText("5 von 12", { timeout: 20000 });
    await expect(page.getByTestId("easter-basket-hole")).toHaveCount(7);
    await expect(page.getByTestId("easter-hints")).toContainText("Schau bei den Turnieren an einer Karte.");
    await expect(page.getByTestId("easter-fastest-2")).toContainText("1 Tag 1 Std. 1 Min.");
    await page.waitForTimeout(1200);
    expect(await overflowOf(page)).toBeLessThanOrEqual(2);
    await shot(page, testInfo, `ostern-korb-${isMobile ? "handy" : "pc"}.png`);
    await shot(page, testInfo, `ostern-ganz-${isMobile ? "handy" : "pc"}.png`, page.getByTestId("easter-hunt-page"));

    state.user = null;
    await page.reload();
    await expect(page.getByTestId("easter-guest")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("easter-basket")).toHaveCount(0);
    await shot(page, testInfo, `ostern-gast-${isMobile ? "handy" : "pc"}.png`);
  });

  test("Bewegung reduzieren: die Eier liegen still", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const quiet = await context.newPage();
    await mockHunt(quiet, fresh());
    await quiet.goto("/news");
    await expect(quiet.getByTestId("easter-egg-3")).toBeVisible({ timeout: 20000 });
    await quiet.waitForTimeout(1500);
    const moving = await quiet.evaluate(() => [...document.querySelectorAll(".tls-egg, .tls-egg svg, .tls-egg__svg")].filter((el) => getComputedStyle(el).animationName !== "none").length);
    expect(moving).toBe(0);
    await context.close();
  });

  test("Verwaltung: Verstecke, Preise, Freigabe - ohne Überlauf", async ({ page, isMobile }, testInfo) => {
    const eggs = Object.entries(HIDDEN).flatMap(([route, rows]) => rows.map(([egg_no, kind, index, place, pattern]) => ({ egg_no, channel: "web", route, spot: { kind, index, place }, pattern, hint: `Schau ${route === "/" ? "auf der Startseite" : "bei den News"}.`, found: egg_no % 2 })));
    const app = [7, 8, 9, 10, 11, 12].map((egg_no, i) => ({ egg_no, channel: "app", route: ["app:Dashboard", "app:Teams", "app:Profile"][i % 3], spot: { kind: "card", index: i % 2, place: "top-right" }, pattern: ["zigzag", "checks", "leaves", "hearts", "spiral", "diamonds"][i], hint: "Schau in der App.", found: 0 }));
    const view = {
      year: 2027, exists: true, phase: "running", status: "live", starts_at: SEASON.starts_at, ends_at: SEASON.ends_at, hints_open_at: "2027-03-27T00:00:00+01:00", hint_unlock_hours: 24,
      prizes: [{ kind: "raffle_all", label: "TLS-Hoodie", value: "Größe nach Wahl", winners: 1 }], eggs: [...eggs, ...app], started: 14, completed: 3,
      routes: { web: { "/": "Startseite", "/news": "News", "/tournaments": "Turniere" }, app: { "app:Dashboard": "Home", "app:Teams": "Teams", "app:Profile": "Profil" } },
      spot_kinds: { web: ["card", "image", "hero", "header", "footer"], app: ["card", "hero", "header"] },
      places: ["top-left", "top-right", "bottom-left", "bottom-right"], patterns: ["stripes", "dots", "zigzag", "waves", "checks", "stars", "flowers", "leaves", "hearts", "spiral", "diamonds", "lion"],
      prize_kinds: { raffle_all: "Verlosung unter allen mit vollem Korb", fastest_1: "Schnellste:r", fastest_2: "Zweitschnellste:r", fastest_3: "Drittschnellste:r" },
      raffle: null, fastest_awarded: [], can_draw: false,
    };
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (request.method() !== "GET") return json({}, 405);
      if (pathname.endsWith("/api/auth/me")) return json(ADMIN);
      if (/\/seasonal\/easter\/admin\/\d+$/.test(pathname)) return json(view);
      if (pathname.includes("/seasonal/active")) return json({ now: NOW, enabled: true, preview: false, weather: null, seasons: [] });
      if (pathname.includes("/settings/public")) return json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" });
      const list = /notifications|games$|achievements\/(groups|tiers)|teams|platform-links|sponsors|partners|site-banners|nav$|media/.test(pathname);
      return json(list ? [] : {});
    });
    await page.goto("/admin/ostern");
    await expect(page.getByTestId("easter-admin-eggs")).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId("easter-admin-locked")).toBeVisible();
    await expect(page.locator("[data-testid^='easter-admin-egg-']")).toHaveCount(12);
    await page.waitForTimeout(800);
    expect(await overflowOf(page), "kein horizontales Scrollen in der Verwaltung").toBeLessThanOrEqual(2);
    await shot(page, testInfo, `verwaltung-${isMobile ? "handy" : "pc"}.png`);
    await shot(page, testInfo, `verwaltung-verstecke-${isMobile ? "handy" : "pc"}.png`, page.getByTestId("easter-admin-eggs"));
  });
});
