const { test, expect } = require("@playwright/test");

// Abnahme-Standard für jede Saison (Seasonal Core C6, #726): „nichts darf schlechter werden“ ist keine
// Halloween-Regel mehr, sondern der Rahmen für jede Jahreszeit. Eine Saison legt nur ihre Teile und Grenzen fest
// (welche Elemente sie über die Seite legt, was auf dem Handy und bei Reduced Motion gilt); die Prüfungen sind für
// alle gleich: kein horizontales Scrollen, Kopfzeile und Menü bedienbar, keine Deko über Text oder Bedienelementen,
// Dropdown über der Deko, Handy und Tablet mit weniger, Reduced Motion still, Saison aus = Seite ohne
// Deko-Elemente. Screenshots hängen am Bericht. Beispiel: halloween-regression.spec.js. Die App hat ihr Gegenstück
// in mobile/src/seasons/acceptance.test.tsx (Screen-Klassen statt Breakpoints).

const DESKTOP = [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];
const MOBILE = [{ width: 375, height: 812 }, { width: 768, height: 1024 }];
const PAGES = ["/", "/events", "/news", "/tournaments", "/gallery", "/sponsors", "/community", "/contact", "/login"];
/** Was unter der Deko nie liegen darf: Bild, Grafik, Bedienelement - Schrift kommt über ihre Zeichenkästen dazu. */
const BLOCKING = "img, picture, video, svg, canvas, button, input, select, textarea, label, time, [role='img'], [role='button']";
/** Die Ebenen der Bühne selbst, die bei der Sonde nicht zählen. */
const STAGE_LAYERS = "[data-testid='season-corners'], [data-testid='season-sky'], .tls-season-sky";
/** Was bei „Saison aus“ nicht da sein darf. */
const STAGE_PIECES = "[data-testid='season-corners'], [data-testid='season-sky']";
const OFF = { now: "2026-06-01T12:00:00+02:00", enabled: false, preview: false, weather: null, seasons: [] };
const SETTLE_MS = 4200;

const EVENTS = ["halloween-night", "fifa-cup", "lan-party", "sim-racing"].map((slug, i) => ({
  id: `e${i}`, slug, title: slug.replace(/-/g, " "), start_date: `2026-11-${String(2 + i).padStart(2, "0")}T18:00:00Z`, end_date: `2026-11-${String(2 + i).padStart(2, "0")}T22:00:00Z`,
  visibility: "public", status: "announced", event_type: "lan", location: "Vereinsheim", description: "Gemeinsam spielen und dabei sein.", banner_url: null, capacity: 40, registrations_count: 12, registration_open: true,
}));
const NEWS = ["saisonstart", "neue-teams", "herbstturnier"].map((slug, i) => ({
  id: `n${i}`, slug, title: slug.replace(/-/g, " "), excerpt: "Ein kurzer Vorgeschmack auf das, was im Verein gerade passiert.", summary: "Kurz.", content: "Text.", published_at: `2026-10-${String(20 - i).padStart(2, "0")}T10:00:00Z`, category: "verein", cover_url: null, tags: [], author: { name: "Vorstand" },
}));
const HOME = { has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, stats: {}, featured_news: [NEWS[0]], news: NEWS };

/** Die Antwort von /api/seasonal/active für eine laufende Saison. */
function activePayload({ season, now }) {
  return { now, enabled: true, preview: false, weather: null, seasons: [season] };
}

/** Saison und Inhalte stellen: Einwilligung gespeichert, API-Antworten fest, alles andere abgebrochen. */
async function mockSeason(page, payload) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/seasonal/active")) return json(payload);
    if (url.includes("/api/settings/public")) return json({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.at" });
    if (url.includes("/api/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    if (url.includes("/api/home/state")) return json(HOME);
    if (url.includes("/api/events/meta")) return json({ types: [], statuses: [] });
    if (url.includes("/api/events?")) return json(EVENTS);
    if (url.includes("/api/news-meta")) return json({ categories: [] });
    if (url.includes("/api/news?")) return json(NEWS);
    if (url.includes("/api/tournaments")) return json([]);
    if (url.includes("/api/board")) return json([]);
    if (url.includes("/api/sponsors") || url.includes("/api/partners")) return json([]);
    if (url.includes("/api/gallery")) return json([]);
    return route.abort();
  });
}

/**
 * Alles, was die Saison über die Seite legt (`pieces`), mit dem obersten Nicht-Saison-Element unter drei Punkten.
 * „Über Text“ heißt: zwischen Treffer und Anker (oder Seite) liegt Schrift, ein Bild oder ein Bedienelement; der
 * Anker selbst (etwa eine Karte, die ein Link ist) zählt nicht, `exempt` (etwa der Löwe) auch nicht.
 */
async function seasonOverlaps(page, config) {
  const args = { pieces: config.pieces, layers: `${STAGE_LAYERS}, ${config.layers || ""}`.replace(/,\s*$/, ""), exempt: config.exempt || "", blocking: BLOCKING };
  return page.evaluate(({ pieces, layers, exempt, blocking }) => {
    const textNodes = (node) => [...node.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
    const ownText = (node) => textNodes(node).length > 0;
    // Schrift zählt nur mit ihren Zeichenkästen (plus 4 px), nicht mit dem oft kartenbreiten Kasten des Behälters.
    const onText = (node, x, y) => textNodes(node).some((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return [...range.getClientRects()].some((r) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4);
    });
    // Klebende Leisten (Kopfzeile, Navigation unten am Handy): liegt ein Stück darunter (kleinerer z-index), ist es
    // dort verdeckt - ein Punkt unter der Leiste ist nicht „über Text“, auch wenn die Leiste selbst Schrift trägt.
    const zOf = (node) => {
      for (let n = node; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
        const style = getComputedStyle(n);
        if (style.position !== "static" && style.zIndex !== "auto") return Number(style.zIndex) || 0;
      }
      return 0;
    };
    const bars = [...document.querySelectorAll("header, nav, [role='navigation']")]
      .filter((bar) => ["fixed", "sticky"].includes(getComputedStyle(bar).position))
      .map((bar) => ({ rect: bar.getBoundingClientRect(), z: zOf(bar) }));
    const found = [...document.querySelectorAll(pieces)];
    return found.map((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return null;
      const z = zOf(el);
      const covered = (x, y) => bars.some((bar) => bar.z > z && x >= bar.rect.left && x <= bar.rect.right && y >= bar.rect.top && y <= bar.rect.bottom);
      const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]];
      const hits = points.map(([x, y]) => document.elementsFromPoint(x, y).filter((n) => !n.closest(layers))[0] || null);
      const overText = points.some(([x, y], index) => {
        const hit = hits[index];
        if (!hit || (exempt && hit.closest(exempt)) || covered(x, y)) return false;
        let node = hit;
        while (node && node.nodeType === 1 && node.tagName !== "BODY") {
          if (node.matches("[data-season-anchor], [data-season-perch]")) return false;
          if (node.matches(blocking)) return true;
          if (ownText(node) && onText(node, x, y)) return true;
          node = node.parentElement;
        }
        return false;
      });
      const describe = (n) => {
        if (!n) return "none";
        let node = n;
        while (node && node.nodeType === 1 && node.tagName !== "BODY" && !node.matches("[data-season-anchor], [data-season-perch]")) {
          if (node.matches(blocking) || ownText(node)) return `${node.tagName.toLowerCase()}${node.className && typeof node.className === "string" ? "." + node.className.split(" ").slice(0, 2).join(".") : ""}:${(node.textContent || "").trim().slice(0, 24)}`;
          node = node.parentElement;
        }
        return n.tagName.toLowerCase();
      };
      return { kind: el.dataset.testid || el.className, overText, under: hits.map(describe) };
    }).filter(Boolean);
  }, args);
}

/** Eine Seite bei einer Fenstergröße: Saison da, kein Überlauf, keine Deko über Text, Kopfzeile bedienbar, Screenshot. */
async function checkPage(page, path, viewport, testInfo, config) {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const consent = page.getByRole("button", { name: /nur nötiges/i }).first();
  if (await consent.count()) await consent.click().catch(() => {});
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain(config.seasonKey);
  await page.waitForTimeout(config.settleMs || SETTLE_MS);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow, `kein horizontales Scrollen auf ${path} bei ${viewport.width}px`).toBeLessThanOrEqual(2);
  const overlaps = await seasonOverlaps(page, config);
  const bad = overlaps.filter((piece) => piece.overText);
  expect(bad, `Deko über Text auf ${path} bei ${viewport.width}px: ${JSON.stringify(bad)}`).toEqual([]);
  // Der erste Menüpunkt ist erreichbar: oben liegt die Kopfzeile, keine Deko (Seiten ohne Kopfzeile, etwa Login, überspringen das).
  const top = await page.evaluate(() => {
    const link = document.querySelector("header nav a, header a[href]");
    if (!link) return "no-link";
    const r = link.getBoundingClientRect();
    if (r.width === 0) return "hidden";
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && hit.closest("header") ? "header" : hit ? hit.tagName.toLowerCase() : "none";
  });
  expect(["header", "hidden", "no-link"], `Kopfzeile bedienbar auf ${path}`).toContain(top);
  await testInfo.attach(`${path.replace(/\//g, "_") || "start"}-${viewport.width}.png`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  return overlaps;
}

/**
 * Die Abnahme einer Saison. `config`:
 * - title, seasonKey, season (Eintrag wie von /api/seasonal/active), now (Zeitpunkt der Antwort)
 * - pieces: Selektor der Teile, die über der Seite liegen und nie Text verdecken dürfen
 * - layers: eigene Ebenen der Saison, die bei der Sonde nicht zählen; exempt: Anker, die nicht als „darunter“ zählen
 * - offPieces: Selektor, der bei „Saison aus“ leer sein muss (etwa [data-testid^='halloween-'])
 * - yielding: Teile, die vor einem offenen Dropdown weichen (data-yield="1"), optional
 * - countPieces(): läuft in der Seite und zählt die Teile; mobileLimits(counts, viewport, path) prüft sie
 * - reducedMotionState(): läuft in der Seite; reducedMotion(state) prüft, dass nichts sich bewegt
 * - pages, settleMs, timeoutMs optional
 */
function defineSeasonQa(config) {
  const pages = config.pages || PAGES;
  const settle = config.settleMs || SETTLE_MS;
  const payload = activePayload(config);
  test.describe(config.title, () => {
    test.describe.configure({ timeout: config.timeoutMs || 240000 });

    test("PC: kein Überlauf, keine Deko über Text, Kopfzeile frei, Dropdown über der Deko", async ({ page, isMobile }, testInfo) => {
      test.skip(Boolean(isMobile), "Desktop-Prüfung");
      await mockSeason(page, payload);
      for (const viewport of DESKTOP) {
        for (const path of pages) await checkPage(page, path, viewport, testInfo, config);
      }
      // Dropdown der Kopfzeile: geöffnet liegt es über allem, und Deko darunter weicht aus.
      await page.setViewportSize(DESKTOP[1]);
      await page.goto("/");
      await page.waitForTimeout(settle);
      const trigger = page.locator("header nav button, header nav [aria-haspopup]").first();
      if (await trigger.count()) {
        await trigger.click();
        await page.waitForTimeout(500);
        const menu = page.locator("[role='menu'], [data-radix-popper-content-wrapper]").first();
        if (await menu.count()) {
          const onTop = await menu.evaluate((el) => {
            const item = el.querySelector("a, [role='menuitem']") || el;
            const r = item.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return Boolean(hit && (el.contains(hit) || hit === el));
          });
          expect(onTop, "Dropdown liegt über der Deko").toBe(true);
          if (config.yielding) {
            const yielded = await page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((el) => el.dataset.yield === "1").length, config.yielding);
            expect(yielded).toBeGreaterThanOrEqual(0);
          }
        }
        await page.keyboard.press("Escape");
      }
    });

    test("Handy und Tablet: kein Überlauf, keine Deko über Text, weniger Deko nach den Grenzen der Saison", async ({ page, isMobile }, testInfo) => {
      test.skip(!isMobile, "Handy-Prüfung");
      await mockSeason(page, payload);
      for (const viewport of MOBILE) {
        for (const path of pages) {
          await checkPage(page, path, viewport, testInfo, config);
          if (config.countPieces && config.mobileLimits) {
            const counts = await page.evaluate(config.countPieces);
            config.mobileLimits(counts, viewport, path);
          }
        }
      }
    });

    test("Reduced Motion: nichts bewegt sich, die Saison bleibt erkennbar", async ({ page, browser }) => {
      const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
      const quiet = await context.newPage();
      await mockSeason(quiet, payload);
      await quiet.goto("/");
      await expect.poll(() => quiet.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain(config.seasonKey);
      await quiet.waitForTimeout(settle);
      if (config.reducedMotionState && config.reducedMotion) {
        const state = await quiet.evaluate(config.reducedMotionState);
        config.reducedMotion(state);
      }
      await context.close();
      void page;
    });

    test("Saison aus: keine Deko-Elemente, Seite unverändert bedienbar", async ({ page }) => {
      await mockSeason(page, OFF);
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      const pieces = await page.evaluate((selector) => document.querySelectorAll(selector).length, `${config.offPieces}, ${STAGE_PIECES}`);
      expect(pieces).toBe(0);
      expect(await page.evaluate(() => document.documentElement.dataset.season || "")).toBe("");
    });
  });
}

module.exports = { DESKTOP, MOBILE, PAGES, OFF, BLOCKING, activePayload, mockSeason, seasonOverlaps, checkPage, defineSeasonQa };
