const fs = require("node:fs");
const path = require("node:path");
const { test, expect, devices } = require("@playwright/test");

// Prüftor (#1660): Ladezeit der Startseite am Handy - nur gegen das gebaute dist (playwright.prueftor.config.js,
// Projekt „ladezeit“), nie gegen den Entwicklungsserver.
//
// Labor wie in PERFORMANCE_BUDGETS.md: dist hinter einem gzip-Server wie nginx (scripts/serve-dist.mjs), Chromium
// headless, je Lauf ein neuer Kontext (kalter Cache, Service Worker gesperrt), Handy (Pixel 5), Netz und CPU nach
// PROFILE unten gedrosselt, API mit 200 ms Antwortzeit und Inhalten wie in home-motion.spec.js. Gemessen werden
// LCP, FCP, CLS und die übertragenen Bytes; nach einem Aufwärmlauf zählt der Median aus RUNS Läufen. Ziel und Grenze stehen in
// PERFORMANCE_BUDGETS.md („<!-- goal:home-mobile-lcp-ms … -->“, „<!-- budget:… -->“): über dem Ziel nur ein Hinweis,
// über der Grenze rot. Das Ergebnis (JSON) liest scripts/prueftor.mjs für den Kommentar im PR.

const RUNS = 3;
// „Handy 4G“: 9 Mbit/s herunter, 1,5 Mbit/s hinauf, 100 ms Umlaufzeit, CPU vierfach gebremst.
const PROFILE = { label: "Handy 4G (9 Mbit/s, 100 ms RTT, CPU ×4)", latency: 100, down: 9_000_000, up: 1_500_000, cpu: 4 };
const API_DELAY_MS = 200;
const OUT = process.env.PRUEFTOR_LADEZEIT_OUT || path.join(__dirname, "..", "test-results", "prueftor-ladezeit.json");

const NEWS = [
  { id: "n1", slug: "saisonfinale", title: "Saisonfinale im Vereinsheim – die Jahreswertung wird entschieden", excerpt: "Am Samstag fällt die Entscheidung.", category: "events", created_at: "2026-10-01T10:00:00Z", published_at: "2026-10-01T10:00:00Z" },
  { id: "n2", slug: "anmeldung-cup", title: "Anmeldung für den Herbst-Cup ist offen", excerpt: "Sechzehn Plätze, jetzt anmelden.", category: "announcement", created_at: "2026-09-28T10:00:00Z", published_at: "2026-09-28T10:00:00Z" },
  { id: "n3", slug: "neue-trikots", title: "Neue Trikots sind da", excerpt: "Abholung beim nächsten Vereinsabend.", category: "club", created_at: "2026-09-20T10:00:00Z", published_at: "2026-09-20T10:00:00Z" },
];
const PHASE = { state: "announced", label: "Angekündigt", target_at: "2027-03-11T10:00:00+01:00", countdown_kind: "starts" };
const EMPTY = { events: [], tournaments: [], challenges: [] };
const HOME = {
  has_live: false, live: EMPTY, today: EMPTY, soon: EMPTY,
  upcoming: { events: [{ id: "e1", slug: "fruehjahrsmesse", name: "Tiroler Frühjahrsmesse 2027", status: "scheduled", public_phase: PHASE, start_date: "2027-03-11T10:00:00+01:00" }], tournaments: [], challenges: [] },
  news: NEWS, featured_news: [NEWS[0]], stats: {},
  club_numbers: { members: 15, tournaments: 3, events: 0, participations: 0, prizes: 10, years: 3 }, club_numbers_shown: ["prizes", "tournaments", "members", "years"],
};

/** Ziel und Grenze aus PERFORMANCE_BUDGETS.md (wie scripts/check-bundle-budget.mjs). */
function budgets() {
  const text = fs.readFileSync(path.join(__dirname, "..", "PERFORMANCE_BUDGETS.md"), "utf8");
  const values = { goal: {}, budget: {} };
  for (const match of text.matchAll(/<!-- (budget|goal):([a-z0-9-]+) (\d+) -->/g)) values[match[1]][match[2]] = Number(match[3]);
  return values;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measureOnce(browser, baseURL) {
  const context = await browser.newContext({ ...devices["Pixel 5"], baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
      saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
    window.__prueftor = { lcp: 0, cls: 0 };
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__prueftor.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new window.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__prueftor.cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const delayed = (body, status = 200) => async (route) => {
    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  };
  await page.route("**/api/**", delayed([]));
  await page.route("**/api/auth/me", delayed({ detail: "anonym" }, 401));
  await page.route("**/api/settings/public", delayed({ club_name: "THE LION SQUAD", tagline: "eSports", domain: "lionsquad.example" }));
  await page.route("**/api/home/state", delayed(HOME));

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: PROFILE.latency, downloadThroughput: PROFILE.down / 8, uploadThroughput: PROFILE.up / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpu });

  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  // LCP kann nach dem Laden noch wechseln (Bild, Webfont): kurz ruhig warten.
  await page.waitForTimeout(1000);
  const result = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const resources = performance.getEntriesByType("resource");
    const navigation = performance.getEntriesByType("navigation")[0];
    const bytes = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), navigation ? navigation.transferSize || 0 : 0);
    return { lcp: window.__prueftor.lcp, fcp: fcp ? fcp.startTime : 0, cls: window.__prueftor.cls, bytes };
  });
  await context.close();
  return result;
}

test("Startseite am Handy: LCP und CLS im Budget (Median aus drei kalten Läufen)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  // Ein Lauf vorab wärmt den Browser auf und zählt nicht: Der erste lag lokal fast doppelt so hoch wie die übrigen.
  await measureOnce(browser, baseURL);
  const runs = [];
  for (let run = 0; run < RUNS; run += 1) runs.push(await measureOnce(browser, baseURL));
  const { goal, budget } = budgets();
  const result = {
    profile: PROFILE.label,
    runs: runs.map((item) => ({ lcp: Math.round(item.lcp), fcp: Math.round(item.fcp), cls: Number(item.cls.toFixed(3)), bytes: item.bytes })),
    lcpMs: Math.round(median(runs.map((item) => item.lcp))),
    fcpMs: Math.round(median(runs.map((item) => item.fcp))),
    cls: Number(median(runs.map((item) => item.cls)).toFixed(3)),
    bytes: median(runs.map((item) => item.bytes)),
    goalLcpMs: goal["home-mobile-lcp-ms"],
    budgetLcpMs: budget["home-mobile-lcp-ms"],
    budgetClsMilli: budget["home-mobile-cls-milli"],
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  testInfo.annotations.push({ type: "Ladezeit", description: `LCP ${result.lcpMs} ms, FCP ${result.fcpMs} ms, CLS ${result.cls}, ${result.bytes} Bytes` });
  console.log(`Ladezeit Startseite (${PROFILE.label}): LCP ${result.lcpMs} ms, FCP ${result.fcpMs} ms, CLS ${result.cls}, ${result.bytes} Bytes`);

  expect(Number.isFinite(result.budgetLcpMs), "PERFORMANCE_BUDGETS.md: <!-- budget:home-mobile-lcp-ms … --> fehlt").toBe(true);
  expect(Number.isFinite(result.budgetClsMilli), "PERFORMANCE_BUDGETS.md: <!-- budget:home-mobile-cls-milli … --> fehlt").toBe(true);
  expect(result.lcpMs, `LCP Startseite am Handy über der Grenze von ${result.budgetLcpMs} ms`).toBeLessThanOrEqual(result.budgetLcpMs);
  expect(result.cls * 1000, `CLS Startseite am Handy über der Grenze von ${result.budgetClsMilli / 1000}`).toBeLessThanOrEqual(result.budgetClsMilli);
});
