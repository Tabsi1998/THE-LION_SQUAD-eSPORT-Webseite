const { test, expect } = require("@playwright/test");

// „Mein Bereich“ (#2059): alte Adressen leiten weiter (mit Suche und Anker), jede Funktion ist ab dem Start („Start“ in
// der unteren Leiste = Dashboard für Angemeldete) mit höchstens zwei Klicks erreichbar, jede Gruppe über Benutzermenü
// bzw. untere Leiste mit höchstens zwei, und alles geht mit der Tastatur. Bei 390 px (Handy) und 1440 px (PC). API über
// page.route nachgestellt, erfundene Namen.

const member = { id: "user-1", username: "nachtfalke", display_name: "Nachtfalke", role: "player", is_club_member: true, email: "falke@example.test", created_at: "2025-01-10T10:00:00Z" };

const MEMBERSHIP = {
  membership: { member_status: "active", member_number: "TLS-077", member_since: "2025-02-01", member_since_precision: "month", membership_type: "ordinary" },
  dolibarr: { connected: true, led_by_dolibarr: true, type_label: "Ordentliches Mitglied", fee: { status: "paid", required: true, amount: 36, currency: "EUR" }, as_of: "2026-10-01T08:00:00Z", link: { status: "verified" }, functions: [] },
};
const SELF_SERVICE = { available: true, profile: { address: "Musterweg 1", zip: "1010", town: "Wien", phone: "", version: 1, direct: [] }, changeable: ["address", "zip", "town", "phone"], requests: [] };
const JERSEY = { available: true, number: null, can_choose: true, again: false, free_count: 9, free_numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9], range: { min: 1, max: 9 }, reserved: [], dolibarr: null, open_request: null, requests: [] };

const json = (body) => ({ contentType: "application/json", body: JSON.stringify(body) });

async function mockServer(page, { user = member } = {}) {
  if (process.env.MB_DEBUG) page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE", msg.text().slice(0, 400)); });
  await page.route("**/api/**", (route) => route.fulfill(json([])));
  await page.route("**/api/auth/me", (route) => route.fulfill(json(user)));
  await page.route("**/api/users/me", (route) => route.fulfill(json(user)));
  await page.route("**/api/settings/public", (route) => route.fulfill(json({})));
  await page.route("**/api/membership/me", (route) => route.fulfill(json(MEMBERSHIP)));
  await page.route("**/api/membership/me/self-service", (route) => route.fulfill(json(SELF_SERVICE)));
  await page.route("**/api/membership/me/jersey-number", (route) => route.fulfill(json(JERSEY)));
  await page.route("**/api/membership/me/consents", (route) => route.fulfill(json({ available: true, consents: [] })));
  await page.route("**/api/membership/area-summary", (route) => route.fulfill(json({ meetings_open: 0, ballots_open: 0 })));
  await page.route("**/api/membership/me/helper-shifts", (route) => route.fulfill(json({ available: false })));
  await page.route("**/api/account/invoices", (route) => route.fulfill(json({ connected: true, currency: "EUR", summary: { count: 1, open_count: 1, open_total: 36, overdue_count: 0 }, invoices: [] })));
  await page.route("**/api/account/documents", (route) => route.fulfill(json({ available: true, documents: [] })));
  await page.route("**/api/documents/meta", (route) => route.fulfill(json({ categories: [] })));
  await page.route("**/api/prizes/me/open-count", (route) => route.fulfill(json({ count: 0 })));
  await page.route("**/api/penalties/me", (route) => route.fulfill(json({ count: 0, items: [] })));
  await page.route("**/api/dsgvo/anonymize-me/check", (route) => route.fulfill(json({ can_erase: true, blockers: [] })));
  await page.route("**/api/mobile/dashboard", (route) => route.fulfill(json({ me: { matches: [], actions: [] } })));
  await page.route("**/api/users/me/profile-completeness", (route) => route.fulfill(json({ score: 100, missing: [] })));
  await page.route("**/api/me/platform-links", (route) => route.fulfill(json({ links: [], available: {}, platforms: {} })));
  await page.route("**/api/users/me/notification-preferences", (route) => route.fulfill(json({ topics: [], levels: [], discord: { linked: false } })));
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, analytics: false, saved_at: Date.now(), expires_at: Date.now() + 864e5 }));
    } catch {
      // ohne Speicher bleibt der Hinweis - die Tests klicken ihn dann weg
    }
  });
}

async function dismissCookies(page) {
  const allow = page.getByRole("button", { name: /nur notwendige|ablehnen|alle erlauben/i }).first();
  if (await allow.isVisible().catch(() => false)) await allow.click();
}

for (const [form, viewport] of [["handy", { width: 390, height: 844 }], ["pc", { width: 1440, height: 900 }]]) {
  test.describe(`Mein Bereich (${form})`, () => {
    test.use({ viewport });

    test("alte Adressen leiten in ihre Gruppe weiter - Suche und Anker gehen mit", async ({ page }) => {
      test.setTimeout(180_000);
      await mockServer(page);
      const cases = [
        ["/profile", "/mein-bereich/profil"],
        ["/profile?tab=gaming", "/mein-bereich/profil?tab=gaming"],
        ["/profile?tab=socials&link=steam", "/mein-bereich/profil?tab=socials&link=steam"],
        ["/profile?tab=notifications#dieser-browser", "/mein-bereich/benachrichtigungen#dieser-browser"],
        ["/profile?tab=security&mfa=required", "/mein-bereich/konto?mfa=required"],
        ["/profile?tab=appearance", "/mein-bereich/konto?tab=appearance"],
        ["/profile?tab=privacy", "/mein-bereich/datenschutz"],
        ["/profile?tab=invoices&invoice=d-31", "/mein-bereich/rechnungen?invoice=d-31"],
        ["/privacy-account", "/mein-bereich/datenschutz?tab=daten"],
        ["/members/area", "/mein-bereich/verein"],
        ["/mitgliederbereich", "/mein-bereich/verein"],
        ["/members/membership#mitgliedskarte", "/mein-bereich/mitgliedschaft#mitgliedskarte"],
        ["/members/meetings?meeting=7", "/mein-bereich/verein/versammlungen?meeting=7"],
        ["/members/helfen?event=5", "/mein-bereich/verein/helfen?event=5"],
        ["/members/documents", "/mein-bereich/verein/dokumente"],
        ["/members/news", "/mein-bereich/verein/news"],
        ["/members/benefits", "/mein-bereich/verein/vorteile"],
        ["/account/invoices?invoice=d-31", "/mein-bereich/rechnungen?invoice=d-31"],
        ["/account/documents", "/mein-bereich/rechnungen?tab=unterlagen"],
        ["/my/prizes", "/mein-bereich/rechnungen?tab=gewinne"],
        ["/my/penalties", "/mein-bereich/rechnungen?tab=strafen"],
      ];
      for (const [from, to] of cases) {
        await page.goto(from);
        await expect.poll(() => { const url = new URL(page.url()); return `${url.pathname}${url.search}${url.hash}`; }, { message: from }).toBe(to);
        await expect(page.getByTestId("mein-bereich")).toBeVisible();
      }
      // Das öffentliche Profil bleibt öffentlich - /u/me führt dorthin, nicht nach Mein Bereich.
      await page.goto("/u/me");
      await expect.poll(() => new URL(page.url()).pathname).toBe("/u/nachtfalke");
    });

    // Funktion → Gruppe (Klick 1) und, wo sie hinter einem Reiter liegt, der Reiter (Klick 2).
    const FUNCTIONS = [
      ["Gamertag", "profil", null, "profile-display-name"],
      ["Bild und Banner", "profil", null, "profile-banner-preview"],
      ["So sehen andere mich", "profil", null, "settings-to-profile"],
      ["Spiel-IDs", "profil", "profile-tab-gaming", "profile-fav-games"],
      ["Socials", "profil", "profile-tab-socials", "profile-link-rows"],
      ["Ausweis", "mitgliedschaft", null, "membership-status"],
      ["Beitrag", "mitgliedschaft", null, "membership-fee-card"],
      ["Wunschnummer", "mitgliedschaft", null, "jersey-choose-form"],
      ["Anschrift ändern", "mitgliedschaft", null, "membership-self-form"],
      ["Rechnungen", "rechnungen", null, "my-invoices"],
      ["Unterlagen", "rechnungen", "mein-bereich-tab-unterlagen", "account-documents-empty"],
      ["Strafen", "rechnungen", "mein-bereich-tab-strafen", "my-penalties-list"],
      ["Verein", "verein", null, "member-area"],
      ["Benachrichtigungen", "benachrichtigungen", null, "mein-bereich-benachrichtigungen"],
      ["Passwort", "konto", null, "profile-password-panel"],
      ["Zwei-Faktor", "konto", null, "profile-mfa-panel"],
      ["Geräte", "konto", null, "profile-sessions-panel"],
      ["Darstellung", "konto", "profile-tab-appearance", "settings-appearance"],
      ["Kalender-Abo", "konto", "profile-tab-calendar", "settings-calendar"],
      ["Sichtbarkeit", "datenschutz", null, "profile-privacy"],
      ["Einwilligungen", "datenschutz", "profile-tab-einwilligungen", "consents-site"],
      ["Daten herunterladen", "datenschutz", "profile-tab-daten", "dsgvo-export-btn"],
      ["Konto löschen", "datenschutz", "profile-tab-loeschung", "dsgvo-anonymize-btn"],
    ];

    test("jede Funktion ab dem Start mit höchstens zwei Klicks", async ({ page }) => {
      test.setTimeout(240_000);
      await mockServer(page);
      for (const [name, group, tab, target] of FUNCTIONS) {
        await page.goto("/dashboard");
        await dismissCookies(page);
        let clicks = 0;
        await page.getByTestId(`dashboard-bereich-liste-${group}`).click();
        clicks += 1;
        await expect(page.getByTestId("mein-bereich")).toHaveAttribute("data-gruppe", group);
        if (tab) {
          await page.getByTestId(tab).click();
          clicks += 1;
        }
        await expect(page.getByTestId(target).first(), name).toBeVisible();
        expect(clicks, name).toBeLessThanOrEqual(2);
      }
    });

    test("jede Gruppe über Benutzermenü bzw. untere Leiste mit höchstens zwei Klicks - von jeder Seite", async ({ page }) => {
      test.setTimeout(120_000);
      await mockServer(page);
      for (const group of ["profil", "mitgliedschaft", "rechnungen", "verein", "benachrichtigungen", "konto", "datenschutz"]) {
        await page.goto("/events");
        await dismissCookies(page);
        if (form === "pc") {
          await page.getByTestId("nav-user").click();
          await page.getByTestId(`nav-account-${group}`).click();
        } else {
          await page.getByTestId("bottom-nav-profile").click();
          await expect(page.getByTestId("mein-bereich-liste")).toBeVisible();
          await page.getByTestId(`mein-bereich-liste-${group}`).click();
        }
        await expect(page.getByTestId("mein-bereich")).toHaveAttribute("data-gruppe", group);
      }
    });

    test("Zu tun als große Knöpfe, ohne seitliches Scrollen; am Handy die Liste, am PC die Seitenleiste", async ({ page }) => {
      await mockServer(page);
      await page.goto("/mein-bereich");
      await dismissCookies(page);
      await expect(page.getByTestId("mein-bereich-todo-rechnung")).toHaveAttribute("href", "/mein-bereich/rechnungen");
      await expect(page.getByTestId("mein-bereich-todo-nummer")).toHaveAttribute("href", "/mein-bereich/mitgliedschaft#nummer");
      const box = await page.getByTestId("mein-bereich-todo-rechnung").boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(56);
      if (form === "pc") {
        await expect(page.getByTestId("mein-bereich-nav")).toBeVisible();
        await expect(page.getByTestId("mein-bereich-liste")).toBeHidden();
        await expect(page.getByTestId("mein-bereich-nav-rechnungen")).toHaveAttribute("aria-label", "Rechnungen & Unterlagen, 1 offen");
      } else {
        await expect(page.getByTestId("mein-bereich-nav")).toBeHidden();
        await expect(page.getByTestId("mein-bereich-liste")).toBeVisible();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      // Am Handy führt jede Gruppe zurück zur Liste.
      if (form === "handy") {
        await page.getByTestId("mein-bereich-liste-konto").click();
        await page.getByTestId("mein-bereich-back").click();
        await expect.poll(() => new URL(page.url()).pathname).toBe("/mein-bereich");
      }
    });

    test("Tastatur: Seitenleiste und Reiter gehen ohne Maus, der Fokus landet auf der Überschrift", async ({ page }) => {
      test.skip(form === "handy", "Die Seitenleiste gibt es am PC; am Handy führen Liste und Zurück-Knopf (oben geprüft).");
      await mockServer(page);
      await page.goto("/mein-bereich");
      await dismissCookies(page);
      const konto = page.getByTestId("mein-bereich-nav-konto");
      await konto.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("mein-bereich")).toHaveAttribute("data-gruppe", "konto");
      await expect(page.getByTestId("mein-bereich-nav-konto")).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      // Mit Tab zum Reiter „Darstellung“, Enter öffnet ihn.
      const darstellung = page.getByTestId("profile-tab-appearance");
      for (let i = 0; i < 30 && !(await darstellung.evaluate((node) => node === document.activeElement)); i += 1) await page.keyboard.press("Tab");
      await expect(darstellung).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(darstellung).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("settings-appearance")).toBeVisible();
      await expect.poll(() => new URL(page.url()).search).toBe("?tab=appearance");
    });
  });
}
