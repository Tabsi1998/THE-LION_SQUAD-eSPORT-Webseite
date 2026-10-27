const { test, expect } = require("@playwright/test");

// Das Adminmenü führt 41 Einträge in 7 Gruppen (seit #408). Offen ergab das eine 1689 px
// hohe Liste, von der bei 1440x900 zwölf Einträge gleichzeitig sichtbar waren -
// und wer auf einer Seite weit unten stand, sah im Menü nicht, wo er ist: die
// Liste blieb oben stehen.

async function mockAdminSession(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      essential: true,
      external_media: false,
      analytics: false,
      meta: false,
      tiktok: false,
      saved_at: Date.now(),
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "admin-1",
      email: "admin@example.test",
      display_name: "Admin",
      username: "admin",
      role: "superadmin",
      is_tournament_staff: true,
      mfa_enabled: true,
      auth_mfa_verified: true,
    }),
  }));
  await page.route("**/api/settings/public", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ club_name: "THE LION SQUAD", domain: "lionsquad.at" }),
  }));
  await page.route("**/api/setup/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ completed: true, health_score: 100, missing: [] }),
  }));
  await page.route("**/api/admin/dashboard", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ recent_audit_logs: [] }),
  }));
  await page.route("**/api/admin/growth-stats**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ days: [] }),
  }));
  await page.route("**/api/admin/system-status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ database: { ok: true }, smtp: { ok: true }, discord: { ok: false }, scheduler: { running: true, jobs: [] }, mail_queue: { pending: 0, failed: 0 } }),
  }));
  await page.route("**/api/mobile/push/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
}

function navMetrics(page) {
  return page.evaluate(() => {
    const nav = document.querySelector("nav.admin-scroll");
    const navBox = nav.getBoundingClientRect();
    // „Zuletzt“ (#1291) ist kein fester Eintrag und zählt nicht mit.
    const links = [...nav.querySelectorAll("a:not([data-recent])")];
    const active = nav.querySelector("[aria-current='page']");
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.top >= navBox.top - 1 && r.bottom <= navBox.bottom + 1;
    };
    return {
      entries: links.length,
      contentHeight: Math.round(nav.scrollHeight),
      visibleHeight: Math.round(nav.clientHeight),
      activeLabel: active ? active.textContent.trim() : null,
      activeInView: active ? inView(active) : null,
    };
  });
}

// Die Leiste ist eingeklappt nur verschoben (translate), nicht versteckt - sichtbar heißt: sie ragt in den Bildschirm.
async function menuOnScreen(page) {
  const box = await page.locator("aside").boundingBox();
  return box.x + box.width > 1;
}

test.describe("Adminmenü", () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("beim ersten Besuch ist alles offen, nichts ist weggeräumt", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();

    // Wer das Zuklappen noch nicht kennt, soll nichts vermissen.
    for (const group of ["Übersicht", "Mitglieder", "eSports", "Content", "Verein", "System"]) {
      await expect(page.getByTestId(`admin-nav-group-${group}`)).toHaveAttribute("aria-expanded", "true");
    }
    await expect(page.getByTestId("admin-nav-tournaments")).toBeVisible();
    // 36 seit "Betrieb" unter System (#233), 37 seit "App-Versionen" (#250), 38 seit "Dolibarr" (#295),
    // 39 seit "Finanzen" (#322), 40 seit "Turnier-Leitfaden" (#228), 41 seit "Vereinsdaten" (#408),
    // 58 seit der Gruppe "Verbindungen" (je Dienst ein Eintrag, 15 Dienste),
    // 64 seit die Einstellungen im Menü liegen (#546: Alle Verbindungen, Google, Resend, SMTP,
    // E-Mail und Auftritt als Gruppen, Status und Zugang unter System - „Einstellungen“ selbst weg).
    // 58 seit der Gruppe "Verbindungen" (je Dienst ein Eintrag, 15 Dienste),
    // 64 seit die Einstellungen im Menü liegen (#546), 60 seit „Betrieb & Logs“ (#517 Teil 2),
    // 69 mit den neun Plattformen aus Konten verknüpfen III, Welle 1 (#547).
    // 79 mit den acht Plattformen aus Welle 2 und Mastodon/Bluesky aus Welle 3 (#547).
    // 80 mit „Jahreszeiten“ unter Auftritt (#633), 81 mit „Adventkalender“ unter Content (#641),
    // 82 mit „Ostereiersuche“ unter Content (#646), 83 mit „Einlass (Versammlung)“ unter Mitglieder (#845),
    // 84 mit „TV & Beamer“ unter eSports (#1110), 85 mit „Serien“ unter Verein (#1741),
    // 84 ohne „Mitgliederprofile“ - jetzt der Reiter „Öffentliche Profile“ unter Mitglieder (#1365),
    // 85 mit „Shop“ unter Finanzen (#1706), 86 mit „Spamschutz“ unter den Einstellungen (#2067).
    expect((await navMetrics(page)).entries).toBe(86);
  });

  test("eine Gruppe lässt sich zuklappen und bleibt es nach dem Neuladen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();

    const content = page.getByTestId("admin-nav-group-Content");
    await expect(page.getByTestId("admin-nav-news")).toBeVisible();
    await content.click();
    await expect(page.getByTestId("admin-nav-news")).toBeHidden();

    await page.reload();
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await expect(page.getByTestId("admin-nav-news")).toBeHidden();
    await expect(page.getByTestId("admin-nav-group-Content")).toHaveAttribute("aria-expanded", "false");
  });

  test("zuklappen verkürzt die Liste spürbar", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    const before = await navMetrics(page);

    // Verbindungen ist seit #547 die längste Gruppe (je Plattform ein Eintrag) - zugeklappt zählt sie mit.
    for (const group of ["Mitglieder", "Content", "Verein", "System", "eSports", "Verbindungen"]) {
      await page.getByTestId(`admin-nav-group-${group}`).click();
    }

    const after = await navMetrics(page);
    expect(after.contentHeight).toBeLessThan(before.contentHeight / 2);
  });

  test("wer tief unten landet, sieht seinen Eintrag im Menü", async ({ page }) => {
    await page.goto("/admin/mobile-push");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();

    await expect(page.getByTestId("admin-nav-group-System")).toHaveAttribute("aria-expanded", "true");
    const metrics = await navMetrics(page);
    expect(metrics.activeLabel).toBe("Push-Tests");
    expect(metrics.activeInView).toBe(true);
  });

  test("die Suche zeigt Treffer aus zugeklappten Gruppen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await page.getByTestId("admin-nav-group-Verein").click();
    await expect(page.getByTestId("admin-nav-sponsors")).toBeHidden();

    await page.getByTestId("admin-nav-search").fill("sponsor");

    await expect(page.getByTestId("admin-nav-sponsors")).toBeVisible();
    await expect(page.getByTestId("admin-nav-group-Verein")).toHaveAttribute("aria-expanded", "true");
  });

  test("„Zuletzt“ steht ganz oben, zählt nicht als fester Eintrag und führt zurück", async ({ page }) => {
    await page.goto("/admin/mobile-push");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await page.getByTestId("admin-nav-admin").click();
    await expect(page.getByTestId("admin-nav-recent")).toBeVisible();
    const first = await page.evaluate(() => document.querySelector("nav.admin-scroll [data-testid^='admin-nav-group-']").dataset.testid);
    expect(first).toBe("admin-nav-group-Zuletzt");
    expect((await navMetrics(page)).entries).toBe(86);
    await page.getByTestId("admin-nav-recent-mobile-push").click();
    await expect(page).toHaveURL(/\/admin\/mobile-push$/);
  });

  // Tablet hochkant (#1289): bis 1023 px Menü-Knopf und volle Breite für den Inhalt, ab 1024 px fest links.
  for (const width of [768, 820]) {
    test(`bei ${width} px steht kein festes Menü links, der Inhalt hat die volle Breite`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1180 });
      await page.goto("/admin");
      await expect(page.getByTestId("admin-menu-open")).toBeVisible();
      expect(await menuOnScreen(page)).toBe(false);
      const main = await page.locator("#main-content").boundingBox();
      expect(main.x).toBeLessThanOrEqual(1);
      await page.getByTestId("admin-menu-open").click();
      await expect.poll(() => menuOnScreen(page)).toBe(true);
      await page.getByTestId("admin-menu-overlay").click({ position: { x: width - 20, y: 400 } });
      await expect.poll(() => menuOnScreen(page)).toBe(false);
    });
  }

  // Barrierefreiheit (Codex-Prüfung): eingeklappt erreicht die Tastatur das Menü nicht; offen springt der Fokus hinein,
  // Escape schließt und gibt den Fokus an den Menü-Knopf zurück.
  test("bei 820 px: eingeklapptes Menü ist nicht per Tab erreichbar, Öffnen und Escape führen den Fokus", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/admin");
    const button = page.getByTestId("admin-menu-open");
    await expect(button).toBeVisible();
    await button.focus();
    const inMenu = () => page.evaluate(() => Boolean(document.activeElement?.closest("aside")));
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await inMenu()).toBe(false);
    }

    await button.focus();
    await page.keyboard.press("Enter");
    await expect.poll(inMenu).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("nav.admin-scroll")))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await expect.poll(() => menuOnScreen(page)).toBe(false);
    await page.keyboard.press("Shift+Tab");
    expect(await inMenu()).toBe(false);
  });

  test("ab 1024 px steht das Menü fest links wie bisher", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await expect(page.getByTestId("admin-menu-open")).toBeHidden();
    const main = await page.locator("#main-content").boundingBox();
    expect(main.x).toBeGreaterThanOrEqual(255);
    expect((await navMetrics(page)).entries).toBe(86);
  });

  test("am Telefon wird „Zuletzt“ beim Nachführen zum aktiven Eintrag nie angeschnitten", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("tls_admin_recent_v1:admin-1", JSON.stringify(["/admin/documents", "/admin"]));
    });
    await page.route("**/api/users**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
    await page.route("**/api/membership/**", (route) => route.fulfill({ contentType: "application/json", body: route.request().url().includes("/meta") ? "{\"statuses\":[],\"types\":[]}" : "[]" }));
    await page.setViewportSize({ width: 390, height: 844 });
    // Mitglieder steht so tief, dass das Nachführen „Zuletzt“ ohne Vorkehrung halb aus dem Bild schob.
    await page.goto("/admin/members");
    await page.getByTestId("admin-menu-open").click();
    await expect(page.getByTestId("admin-nav-recent")).toBeAttached();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const nav = document.querySelector("nav.admin-scroll").getBoundingClientRect();
      const heading = document.querySelector("[data-testid='admin-nav-group-Zuletzt']").getBoundingClientRect();
      const recent = document.querySelector("[data-testid='admin-nav-recent']").getBoundingClientRect();
      const active = document.querySelector("nav.admin-scroll [aria-current='page']").getBoundingClientRect();
      return {
        recentCut: recent.top < nav.top - 1 && recent.bottom > nav.top + 1,
        headingCut: heading.top < nav.top - 1 && heading.bottom > nav.top - 1,
        activeInView: active.top >= nav.top - 1 && active.bottom <= nav.bottom + 1,
      };
    });
    expect(state).toEqual({ recentCut: false, headingCut: false, activeInView: true });
  });

  test("am Telefon bleibt das Menü im Schubfach bedienbar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.getByTestId("admin-nav-search")).toBeHidden();

    await page.getByTestId("admin-menu-open").click();
    await expect(page.getByTestId("admin-nav-search")).toBeVisible();
    await expect(page.getByTestId("admin-nav-group-eSports")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
