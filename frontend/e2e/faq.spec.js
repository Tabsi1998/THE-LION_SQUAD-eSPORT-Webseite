const { test, expect } = require("@playwright/test");

// FAQ (#2448): „FAQ“ rechts in der Hauptleiste und am Handy im Menü, die Seite /faq bei 390 und 1440 px (Suche,
// Häufige Fragen zum Aufklappen, Bereiche mit Rollen-Filter), alte /hilfe-Links und axe ohne schwere Funde. Der Server
// ist nachgestellt, wie DEFAULT_NAV in backend/routes/phase_fg_routes.py. FAQ_SHOTS=<ordner> legt die Bilder für die
// Abnahme ab.

const SHOTS = process.env.FAQ_SHOTS || "";
const kids = (rows) => rows.map(([to, label, auth_only]) => ({ to, label, auth_only }));
const NAV = [
  { key: "home", to: "/", label: "Start", order: 0 },
  { key: "news", to: "/news", label: "News", order: 1 },
  { key: "events", to: "/events", label: "Events", order: 2 },
  { key: "club", to: "/about", label: "Verein", order: 3, children: kids([["/about", "Über uns"], ["/board", "Vorstand"], ["/members", "Vereinsmitglieder"], ["/membership/join", "Mitglied werden"]]) },
  { key: "esports", to: "/esports", label: "eSports", order: 4, children: kids([["/esports", "Übersicht"], ["/tournaments", "Turniere"], ["/fastlap", "Fast Lap"]]) },
  { key: "community", label: "Community", order: 5, children: kids([["/community", "Übersicht"], ["/messages", "Chats", true], ["/players", "Community-Spieler"], ["/teams", "Teams"], ["/seasons/current", "Jahreswertung"], ["/achievements", "Erfolge"]]) },
  { key: "contact", to: "/contact", label: "Kontakt", order: 6 },
  { key: "faq", to: "/faq", label: "FAQ", order: 7 },
];
const GAST = { darf: { angemeldet: false, mitglied: false, turnierleitung: false }, fragen: [], anleitungen: [] };
const MITGLIED = { id: "u-m", username: "kiwikomet", display_name: "KiwiKomet", role: "player", is_club_member: true, areas: [] };
const MITGLIED_FAQ = {
  darf: { angemeldet: true, mitglied: true, turnierleitung: false },
  fragen: [{
    id: "helferdienst-eintragen", frage: "Wie trage ich mich für einen Helferdienst ein?", antwort: "Öffne Helferdienste und tippe bei einer Schicht auf Ich helfe. Das ist eine Anfrage. Der Vorstand bestätigt sie.",
    bereich: "helferdienste", rollen: ["mitglied"], sichtbar_fuer: "mitglied", haeufig: true, link: { to: "/members/helfen", label: "Zu den Helferdiensten" },
  }],
  anleitungen: [],
};

async function mockServer(page, { user = null, faq = GAST } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/nav") return json({ items: NAV });
    if (path === "/faq") return json(faq);
    if (path === "/auth/me") return user ? json(user) : json({ detail: "Nicht angemeldet" }, 401);
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD", tagline: "eSports" });
    if (path === "/notifications/unread-count") return json({ count: 0 });
    if (path === "/chats/unread") return json({ unread_total: 0 });
    if (path === "/seasonal/active") return json({ now: new Date().toISOString(), enabled: false, preview: false, weather: null, seasons: [] });
    return json([]);
  });
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

/** Tippflächen in der FAQ unter 44 × 44 px (wie a11y-pages.spec.js: die Mitte ± 21 px trifft noch dasselbe Element). */
async function smallTargets(page) {
  return page.evaluate(() => {
    const small = [];
    for (const node of document.querySelectorAll("[data-testid=faq-page] button, [data-testid=faq-page] a[href]")) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || node.closest("p") || getComputedStyle(node).display === "inline") continue;
      node.scrollIntoView({ block: "center" });
      const box = node.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hits = (px, py) => { const hit = document.elementFromPoint(px, py); return Boolean(hit && (hit === node || node.contains(hit))); };
      if (!(hits(x, y - 21) && hits(x, y + 21) && hits(x - 21, y) && hits(x + 21, y))) small.push(`${node.dataset.testid || node.textContent.trim().slice(0, 30)} ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return small;
  });
}

async function shot(page, name, options = {}) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, ...options });
}

test.describe("FAQ (#2448)", () => {
  test.skip(({ isMobile }) => isMobile, "Breiten werden einzeln gestellt.");

  test("PC (1440 px): FAQ als letzter Eintrag rechts, ohne Untermenü, führt zu /faq", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    const faq = page.getByTestId("nav-faq");
    await expect(faq).toBeVisible();
    expect(await faq.evaluate((node) => node.parentElement.lastElementChild === node)).toBe(true);
    await page.getByTestId("nav-community").hover();
    await expect(page.getByTestId("nav-community-dropdown")).toBeVisible();
    await expect(page.getByTestId("nav-sub-hilfe")).toHaveCount(0);
    await shot(page, "hauptleiste-pc", { clip: { x: 0, y: 0, width: 1440, height: 260 } });
    await page.mouse.move(10, 600);
    await faq.click();
    await expect(page).toHaveURL(/\/faq$/);
    await expect(page.getByTestId("faq-page")).toBeVisible();
    await expect(faq).toHaveAttribute("aria-current", "page");
  });

  test("Handy (390 px): FAQ steht im Menü und führt zu /faq", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockServer(page);
    await page.goto("/");
    await page.getByTestId("nav-mobile-toggle").click();
    const menu = page.locator("#mobile-navigation");
    await expect(menu.getByTestId("mobile-nav-faq")).toBeVisible();
    await menu.getByTestId("mobile-nav-community").click();
    await expect(menu.getByTestId("mobile-nav-sub-hilfe")).toHaveCount(0);
    await shot(page, "handy-menue");
    await menu.getByTestId("mobile-nav-faq").click();
    await expect(page).toHaveURL(/\/faq$/);
    await expect(page.getByTestId("faq-page")).toBeVisible();
  });

  for (const width of [390, 1440]) {
    test(`Seite bei ${width} px: Aufbau, Aufklappen per Tastatur, Rollen-Filter, kein Querlauf, axe, Tippflächen`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await mockServer(page);
      await page.goto("/faq");
      await expect(page.getByTestId("faq-haeufig")).toBeVisible();
      await expect(page.getByLabel("FAQ durchsuchen")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

      // Tastatur: Tab auf die Frage, Enter klappt auf, Leertaste wieder zu.
      const knopf = page.getByTestId("faq-frage-knopf-team-beitreten");
      await knopf.focus();
      await page.keyboard.press("Enter");
      await expect(knopf).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("faq-antwort-team-beitreten")).toBeVisible();
      await shot(page, `faq-${width}`, { fullPage: true });
      // Für das Handbuch (docs/handbuch/bilder/faq-pc.png, faq-handy.png): nur der obere Teil.
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `handbuch-${width}`);
      await page.keyboard.press(" ");
      await expect(knopf).toHaveAttribute("aria-expanded", "false");

      // Rollen-Filter: Auswahl in der Adresse, ein Bereich aufgeklappt.
      await page.getByTestId("faq-rolle-captain").click();
      await expect(page).toHaveURL(/\/faq\?rolle=captain$/);
      await expect(page.getByTestId("faq-bereich-verein-mitgliedschaft")).toHaveCount(0);
      await page.getByTestId("faq-bereich-knopf-liga").click();
      await expect(page.getByTestId("faq-anleitung-liga-liga-captains")).toBeVisible();
      if (width === 1440) await shot(page, "rollen-filter", { fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

      expect(await seriousViolations(page), `axe bei ${width} px`).toEqual([]);
      if (width === 390) expect(await smallTargets(page)).toEqual([]);
    });
  }

  test("Suche: Treffer aus Fragen und Schritten mit Bereich, ein Fragen-Treffer klappt die Frage auf", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockServer(page);
    await page.goto("/faq");
    await page.getByTestId("faq-search").fill("einchecken");
    await expect(page).toHaveURL(/\/faq\?q=einchecken$/);
    const results = page.getByTestId("faq-results");
    await expect(results.getByTestId("faq-treffer-schritt-liga-captains-check-in")).toBeVisible();
    await expect(results.getByTestId("faq-treffer-schritt-turniere-einchecken").getByTestId("faq-treffer-bereich")).toHaveText(/Turniertag vor Ort/i);
    await shot(page, "suche-treffer", { fullPage: true });
    await page.getByTestId("faq-search").fill("beitrittscode");
    await page.getByTestId("faq-treffer-frage-team-beitreten").click();
    await expect(page).toHaveURL(/\/faq#frage-team-beitreten$/);
    await expect(page.getByTestId("faq-frage-knopf-team-beitreten")).toHaveAttribute("aria-expanded", "true");
  });

  test("Mitglied: Fragen vom Server, Bereich Helferdienste; „Bewegung reduzieren“ lässt die Antwort ohne Weg erscheinen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page, { user: MITGLIED, faq: MITGLIED_FAQ });
    await page.goto("/faq");
    await expect(page.getByTestId("faq-haeufig").getByTestId("faq-frage-helferdienst-eintragen")).toBeVisible();
    await expect(page.getByTestId("faq-bereich-helferdienste")).toBeVisible();
    await expect(page.getByTestId("faq-bereich-turnierleitung")).toHaveCount(0);
    await page.getByTestId("faq-frage-knopf-helferdienst-eintragen").click();
    const antwort = page.getByTestId("faq-antwort-helferdienst-eintragen");
    await expect(antwort).toBeVisible();
    // Bewegung nur über transform und opacity; mit „Bewegung reduzieren“ ohne Verschieben.
    const transform = await antwort.evaluate((node) => getComputedStyle(node).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  });

  test("Alte Links: /hilfe, /hilfe/<thema>#<schritt> und die Suche landen in der FAQ", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/hilfe/liga-captains#check-in");
    await expect(page).toHaveURL(/\/faq\/liga-captains#check-in$/);
    await expect(page.getByTestId("help-step-check-in")).toHaveAttribute("data-active", "true");
    await page.goto("/hilfe?q=check-in");
    await expect(page).toHaveURL(/\/faq\?q=check-in$/);
    await expect(page.getByTestId("faq-results")).toBeVisible();
  });
});
