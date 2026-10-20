const { test, expect } = require("@playwright/test");

// Web-Navigation II: Untermenüs per Antippen und Tastatur (#1233), die Kopfzeile zwischen 1024 und 1279 px (#1234). Der Server ist nachgestellt - das Menü wie
// DEFAULT_NAV in backend/routes/phase_fg_routes.py („Verein“ und „eSports“ mit eigener Seite, „Community“ ohne).

const kids = (rows) => rows.map(([to, label, auth_only]) => ({ to, label, auth_only }));
const NAV = [
  { to: "/", label: "Home", order: 0 },
  { to: "/news", label: "News", order: 1 },
  { to: "/events", label: "Events", order: 2 },
  { to: "/about", label: "Verein", order: 3, children: kids([["/about", "Über uns"], ["/board", "Vorstand"], ["/partners", "Partner"], ["/sponsors", "Sponsoren"], ["/members", "Vereinsmitglieder"], ["/membership/join", "Mitglied werden"], ["/galerie", "Galerie"], ["/references", "Referenzen"]]) },
  { to: "/esports", label: "eSports", order: 4, children: kids([["/esports", "Übersicht"], ["/tournaments", "Turniere"], ["/fastlap", "Fast Lap"]]) },
  { label: "Community", order: 5, children: kids([["/community", "Übersicht"], ["/messages", "Chats", true], ["/servers", "Server"], ["/players", "Community-Spieler"], ["/teams", "Teams"], ["/seasons/current", "Jahreswertung"], ["/achievements", "Erfolge"]]) },
  { to: "/contact", label: "Kontakt", order: 6 },
];

async function mockServer(page, { user = null } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/nav") return json({ items: NAV });
    if (path === "/auth/me") return user ? json(user) : json({ detail: "Nicht angemeldet" }, 401);
    if (path === "/chats/unread") return json({ unread_total: 3 });
    if (path === "/notifications/unread-count") return json({ count: 0 });
    if (path === "/settings/public") return json({ club_name: "THE LION SQUAD", tagline: "eSports" });
    if (path === "/seasonal/active") return json({ now: new Date().toISOString(), enabled: false, preview: false, weather: null, seasons: [] });
    if (path === "/home/state") return json({ has_live: false, live: {}, today: {}, soon: {}, upcoming: {}, stats: {}, featured_news: [], news: [] });
    return json([]);
  });
}

async function seriousViolations(page, selector) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async (scope) => {
    const result = await window.axe.run(document.querySelector(scope), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    return result.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact))
      .map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  }, selector);
}

test.describe("Untermenüs (#1233)", () => {
  test.skip(({ isMobile }) => isMobile, "Das Menü oben gilt ab 1024 px; am Handy bleibt das Akkordeon.");

  test("Tablet quer (1024 px, Touch): Antippen öffnet das Untermenü, ein Eintrag öffnet die Seite", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await context.newPage();
    await mockServer(page);
    await page.goto("/");
    const verein = page.getByTestId("nav-verein");
    await expect(verein).toBeVisible();
    await verein.tap();
    await expect(page.getByTestId("nav-verein-dropdown")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    for (const key of ["vorstand", "galerie", "sponsoren"]) await expect(page.getByTestId(`nav-sub-${key}`)).toBeVisible();
    await page.getByTestId("nav-sub-vorstand").tap();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByTestId("nav-verein-dropdown")).toBeHidden();

    await page.getByTestId("nav-esports").tap();
    await expect(page.getByTestId("nav-sub-fast-lap")).toBeVisible();
    await page.getByTestId("nav-community").tap();
    await expect(page.getByTestId("nav-esports-dropdown")).toBeHidden();
    await expect(page.getByTestId("nav-sub-jahreswertung")).toBeVisible();
    await page.touchscreen.tap(900, 600);
    await expect(page.getByTestId("nav-community-dropdown")).toBeHidden();
    await context.close();
  });

  test("PC (1440 px): Tastatur öffnet, wandert, Escape schließt und gibt den Fokus zurück - axe ohne schwere Funde", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    const community = page.getByTestId("nav-community");
    await expect(community).toBeVisible();
    await community.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("nav-community-dropdown")).toBeVisible();
    await expect(community).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("nav-community-dropdown").getByTestId("nav-sub-bersicht")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("nav-sub-server")).toBeFocused();
    expect(await seriousViolations(page, "[data-testid='site-header']")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-community-dropdown")).toBeHidden();
    await expect(community).toBeFocused();

    const verein = page.getByTestId("nav-verein");
    await verein.focus();
    await page.keyboard.press(" ");
    await expect(page.getByTestId("nav-sub-ber-uns")).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await page.keyboard.press("End");
    await expect(page.getByTestId("nav-sub-referenzen")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/references$/);
  });

  test("PC mit Maus: Drüberfahren öffnet, ein Klick auf „Verein“ öffnet wie bisher die Seite", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockServer(page);
    await page.goto("/");
    await page.getByTestId("nav-verein").hover();
    await expect(page.getByTestId("nav-sub-vorstand")).toBeVisible();
    await page.getByTestId("nav-verein").click();
    await expect(page).toHaveURL(/\/about$/);
  });
});

const ME = { id: "u-neon", username: "neonfalke", display_name: "Schattenläufer der Nordkurve", role: "player", is_club_member: true, seasonal_decorations: "on" };

async function headerFacts(page) {
  return page.evaluate(() => {
    const row = document.querySelector("[data-testid=site-header-row]");
    const logo = [...row.querySelectorAll("[data-testid=tls-logo]")].find((img) => img.getBoundingClientRect().width > 0);
    const box = logo?.getBoundingClientRect();
    const buttons = [...row.querySelectorAll("a, button")].filter((el) => el.getBoundingClientRect().width > 0 && !el.querySelector("img"));
    // Einzeilig: kein Knopf höher als 44 px (ein umbrechender Knopf ist 48 px hoch).
    const tall = buttons.filter((el) => el.getBoundingClientRect().height > 44).map((el) => el.dataset.testid || el.textContent.trim());
    return {
      overflow: row.scrollWidth - row.clientWidth,
      logoWidth: box ? Math.round(box.width) : 0,
      // Vollständig: das Bild wird nicht gestaucht - Breite zu Höhe wie im Original.
      logoSquashed: box ? Math.abs(box.width / box.height - logo.naturalWidth / logo.naturalHeight) > 0.05 : true,
      logoVariant: logo?.closest("[data-header-logo]")?.dataset.headerLogo || null,
      tall,
    };
  });
}

test.describe("Kopfzeile 1024-1279 px (#1234)", () => {
  test.skip(({ isMobile }) => isMobile, "Breiten werden einzeln gestellt.");

  for (const who of ["Gast", "angemeldet"]) {
    for (const width of [1024, 1180, 1279, 1280, 1440]) {
      test(`${who} bei ${width} px: Logo ganz zu sehen, Knöpfe einzeilig, kein Überlauf`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await mockServer(page, { user: who === "Gast" ? null : ME });
        await page.goto("/");
        await expect(page.getByTestId(who === "Gast" ? "nav-register" : "nav-user")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("[data-testid=site-header-row] [data-testid=tls-logo]")].some((img) => img.complete && img.naturalWidth > 0))).toBe(true);
        const facts = await headerFacts(page);
        expect(facts.overflow).toBeLessThanOrEqual(1);
        expect(facts.logoWidth).toBeGreaterThanOrEqual(32);
        if (width < 1280) {
          expect(facts.logoVariant).toBe("mascot");
          expect(facts.logoSquashed).toBe(false);
          expect(facts.tall).toEqual([]);
          if (who === "Gast") {
            expect(await page.getByTestId("nav-register").innerText()).toBe("BEITRETEN");
            await expect(page.getByTestId("nav-login")).toHaveAccessibleName("Login");
          }
        } else {
          expect(facts.logoVariant).toBe("wordmark");
          if (who === "Gast") expect(await page.getByTestId("nav-register").innerText()).toBe("MITGLIED WERDEN");
        }
      });
    }
  }
});
