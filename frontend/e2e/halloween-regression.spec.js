const { test, expect } = require("@playwright/test");

// Halloween IV (H20, #708): Abnahme „nichts darf schlechter werden“ - die Saison auf den Hauptseiten und
// Breakpoints: kein horizontales Scrollen, Kopfzeile und Menü bedienbar, keine Fledermaus und kein Netz über
// Text oder Bedienelementen, Handy ohne Netze und höchstens eine Fledermaus, Dropdown über der Deko, Saison aus =
// Seite ohne Deko-Elemente. Screenshots hängen am Bericht.

const SEASON = { now: "2026-10-28T20:00:00+01:00", enabled: true, preview: false, weather: null, seasons: [
  { key: "halloween", phase: "deko", intensity: "full", channels: ["web", "app"], texts: { greeting: "Happy Halloween" }, data: { night: true }, starts_at: "", ends_at: "" },
] };
const OFF = { now: "2026-06-01T12:00:00+02:00", enabled: false, preview: false, weather: null, seasons: [] };
const EVENTS = ["halloween-night", "fifa-cup", "lan-party", "sim-racing"].map((slug, i) => ({
  id: `e${i}`, slug, title: slug.replace(/-/g, " "), start_date: `2026-11-${String(2 + i).padStart(2, "0")}T18:00:00Z`, end_date: `2026-11-${String(2 + i).padStart(2, "0")}T22:00:00Z`,
  visibility: "public", status: "announced", event_type: "lan", location: "Vereinsheim", description: "Gemeinsam spielen und dabei sein.", banner_url: null, capacity: 40, registrations_count: 12, registration_open: true,
}));
const NEWS = ["saisonstart", "neue-teams", "herbstturnier"].map((slug, i) => ({
  id: `n${i}`, slug, title: slug.replace(/-/g, " "), excerpt: "Ein kurzer Vorgeschmack auf das, was im Verein gerade passiert.", summary: "Kurz.", content: "Text.", published_at: `2026-10-${String(20 - i).padStart(2, "0")}T10:00:00Z`, category: "verein", cover_url: null, tags: [], author: { name: "Vorstand" },
}));
const HOME = { has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, stats: {}, featured_news: [NEWS[0]], news: NEWS };
const PAGES = ["/", "/events", "/news", "/tournaments", "/gallery", "/sponsors", "/community", "/contact", "/login"];
const DESKTOP = [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];
const MOBILE = [{ width: 375, height: 812 }, { width: 768, height: 1024 }];
const TEXT_LIKE = "img, picture, video, svg, canvas, button, input, select, textarea, label, time, [role='img'], [role='button']";

async function mockSeason(page, season = SEASON) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/seasonal/active")) return json(season);
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
 * Alles, was die Saison über die Seite legt - mit dem obersten Nicht-Saison-Element unter drei Punkten. „Über Text“
 * heißt: zwischen Treffer und Karte (oder Seite) liegt Schrift, ein Bild oder ein Bedienelement; die Karte selbst
 * (ein Link) zählt nicht, der Löwe (Anker für hängende Fledermäuse) auch nicht.
 */
async function seasonOverlaps(page) {
  return page.evaluate((blocking) => {
    const textNodes = (node) => [...node.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
    const ownText = (node) => textNodes(node).length > 0;
    // Schrift zählt nur mit ihren Zeichenkästen (plus 4 px), nicht mit dem oft kartenbreiten Kasten des Behälters.
    const onText = (node, x, y) => textNodes(node).some((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return [...range.getClientRects()].some((r) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4);
    });
    const pieces = [...document.querySelectorAll("[data-testid='halloween-bat-hanging'], [data-testid='halloween-corner-web'], [data-testid='halloween-eyes']")];
    return pieces.map((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return null;
      const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]];
      const hits = points.map(([x, y]) => document.elementsFromPoint(x, y).filter((n) => !n.closest("[data-testid='season-corners'], .tls-hbats, .tls-cwebs, .tls-eyes, .tls-fog, .tls-edge, .tls-season-sky"))[0] || null);
      const overText = points.some(([x, y], index) => {
        const hit = hits[index];
        if (!hit || hit.closest("[data-season-anchor='lion']")) return false;
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
      return { kind: el.dataset.testid, overText, under: hits.map(describe) };
    }).filter(Boolean);
  }, TEXT_LIKE);
}

async function checkPage(page, path, viewport, testInfo) {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const consent = page.getByRole("button", { name: /alle ablehnen/i }).first();
  if (await consent.count()) await consent.click().catch(() => {});
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain("halloween");
  await page.waitForTimeout(4200);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow, `kein horizontales Scrollen auf ${path} bei ${viewport.width}px`).toBeLessThanOrEqual(2);
  const overlaps = await seasonOverlaps(page);
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

test.describe("Halloween: Abnahme auf Hauptseiten und Breakpoints", () => {
  test.describe.configure({ timeout: 240000 });

  test("PC: kein Überlauf, keine Deko über Text, Kopfzeile frei, Dropdown über der Deko", async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "Desktop-Prüfung");
    await mockSeason(page);
    for (const viewport of DESKTOP) {
      for (const path of PAGES) await checkPage(page, path, viewport, testInfo);
    }
    // Dropdown der Kopfzeile: geöffnet liegt es über allem, und eine Fledermaus darunter weicht aus.
    await page.setViewportSize(DESKTOP[1]);
    await page.goto("/");
    await page.waitForTimeout(4200);
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
        const yielded = await page.evaluate(() => [...document.querySelectorAll("[data-testid='halloween-bat-hanging'], [data-testid='halloween-corner-web']")].filter((el) => el.dataset.yield === "1").length);
        expect(yielded).toBeGreaterThanOrEqual(0);
      }
      await page.keyboard.press("Escape");
    }
  });

  test("Handy und Tablet: kein Überlauf, keine Netze, höchstens eine Fledermaus, kleine Fußzeilen-Szene, keine Augen", async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, "Handy-Prüfung");
    await mockSeason(page);
    for (const viewport of MOBILE) {
      for (const path of PAGES) {
        await checkPage(page, path, viewport, testInfo);
        const counts = await page.evaluate(() => ({
          webs: document.querySelectorAll("[data-testid='halloween-corner-web']").length,
          bats: document.querySelectorAll("[data-testid='halloween-bat-hanging']").length,
          eyes: document.querySelectorAll("[data-testid='halloween-eyes']").length,
          scene: document.querySelector("[data-testid='halloween-footer-scene']")?.dataset.size || null,
        }));
        if (viewport.width < 640) {
          expect(counts.webs, `keine Netze auf ${path}`).toBe(0);
          expect(counts.bats, `höchstens eine Fledermaus auf ${path}`).toBeLessThanOrEqual(1);
          expect(counts.eyes).toBe(0);
          expect([null, "small", "none"]).toContain(counts.scene);
        } else {
          expect(counts.webs).toBeLessThanOrEqual(1);
          expect(counts.bats).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test("Reduced Motion: Nebel still, keine Fledermäuse, keine Augen, Netz statisch", async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const quiet = await context.newPage();
    await mockSeason(quiet);
    await quiet.goto("/");
    await expect.poll(() => quiet.evaluate(() => document.documentElement.dataset.season || ""), { timeout: 15000 }).toContain("halloween");
    await quiet.waitForTimeout(4200);
    const state = await quiet.evaluate(() => ({
      fog: document.querySelector("[data-testid='halloween-fog']")?.className || null,
      bats: [...document.querySelectorAll("[data-testid='halloween-bat-hanging']")].filter((el) => getComputedStyle(el.closest(".tls-hbats")).display !== "none").length,
      eyes: document.querySelectorAll("[data-testid='halloween-eyes']").length,
      staticWeb: document.querySelectorAll("[data-testid='halloween-web-static']").length,
      canvas: document.querySelectorAll("[data-testid='season-sky']").length,
    }));
    expect(state.bats).toBe(0);
    expect(state.eyes).toBe(0);
    if (state.fog) expect(state.fog).toContain("tls-fog--static");
    expect(state.staticWeb + state.canvas).toBeGreaterThanOrEqual(1);
    await context.close();
    void page;
  });

  test("Saison aus: keine Deko-Elemente, Seite unverändert bedienbar", async ({ page }) => {
    await mockSeason(page, OFF);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    const pieces = await page.evaluate(() => document.querySelectorAll("[data-testid^='halloween-'], [data-testid='season-corners'], [data-testid='season-sky']").length);
    expect(pieces).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset.season || "")).toBe("");
  });
});
