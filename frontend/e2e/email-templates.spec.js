const { test, expect } = require("@playwright/test");

// E-Mail-Vorlagen (#2119 ML1): der Editor lädt die Vorlage mit {{variable}}, die Vorschau rendert Beispieldaten; eine
// schon mit Beispielwerten gespeicherte Vorlage wird in Liste und Editor gemeldet. Bei 390 und 1440 px, API nachgestellt.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const ADMIN = { id: "u-sys", username: "sina", display_name: "Sina System", role: "superadmin", areas: ["system"], mfa_enabled: true, auth_mfa_verified: true };
const ROWS = [
  { key: "registration", name: "Willkommen nach der Registrierung", purpose: "Geht raus, sobald jemand ein Konto anlegt.", recipient: "das neue Konto", category: "account",
    category_label: "Konto und Anmeldung", vars: ["display_name"], source: "code", custom: false, editable: true, subject: null, html: null, sample_leaks: [] },
  { key: "registration_approved", name: "Turnier: Anmeldung bestätigt", purpose: "Die Anmeldung ist bestätigt.", recipient: "die Verantwortlichen der Anmeldung (bei Teams Teamleitung und Co-Leitung)",
    category: "tournament", category_label: "Turniere", vars: ["tournament_title", "url", "detail"], source: "code", custom: true, editable: true,
    subject: "Du bist dabei: Mario Kart Winter Cup", html: "<p>Mario Kart Winter Cup</p>", sample_leaks: ["Mario Kart Winter Cup"] },
];
const SOURCES = {
  registration: { key: "registration", subject: "Willkommen in der Community", html: "<p>Willkommen in der Community, {{display_name}}</p>", vars: ["display_name"], source: "code", custom: false, sample_leaks: [] },
  registration_approved: { key: "registration_approved", subject: "Du bist dabei: Mario Kart Winter Cup", html: "<p>Dein Platz im Turnier <strong>Mario Kart Winter Cup</strong> ist bestätigt.</p>",
    vars: ["tournament_title", "url", "detail"], source: "code", custom: true, sample_leaks: ["Mario Kart Winter Cup"] },
};

async function mockApi(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const key = url.pathname.split("/")[4];
    if (url.pathname.endsWith("/preview")) {
      return json({ subject: "Willkommen in der Community", html: "<p style='font-family:sans-serif'>Willkommen in der Community, Paula</p>", source: "code" });
    }
    if (request.method() === "PUT" && url.pathname.startsWith("/api/admin/email-templates/")) {
      state.saved = request.postDataJSON();
      return json({ override: true });
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json(ADMIN);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/email-templates") return json(ROWS);
    if (key && SOURCES[key]) return json(SOURCES[key]);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners|tournaments|challenges|events/.test(url.pathname);
    return json(list ? [] : {});
  });
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Editor lädt Platzhalter, Vorschau zeigt Beispieldaten, Speichern schickt die Platzhalter", async ({ page }, testInfo) => {
      const state = { saved: null };
      await mockApi(page, state);
      await page.goto("/admin/email-templates");
      await expect(page.getByTestId("tpl-leaks-registration_approved")).toBeVisible();
      await page.getByTestId("tpl-edit-registration").click();
      await expect(page.getByTestId("tpl-html")).toHaveValue("<p>Willkommen in der Community, {{display_name}}</p>");
      await expect(page.getByTestId("tpl-subject")).toHaveValue("Willkommen in der Community");
      await expect(page.frameLocator("[data-testid=tpl-preview-frame]").getByText("Willkommen in der Community, Paula")).toBeVisible();
      await noSideScroll(page);
      await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`), fullPage: true });
      await page.getByTestId("tpl-subject").fill("Servus in der Community");
      await page.getByTestId("tpl-save").click();
      await expect.poll(() => state.saved).toEqual({ subject: "Servus in der Community", html: "<p>Willkommen in der Community, {{display_name}}</p>" });
    });

    test("Verdorbene Vorlage: Hinweis in Liste und Editor", async ({ page }, testInfo) => {
      await mockApi(page, { saved: null });
      await page.goto("/admin/email-templates");
      await page.getByTestId("tpl-edit-registration_approved").click();
      await expect(page.getByTestId("tpl-sample-warning")).toContainText("„Mario Kart Winter Cup“");
      await expect(page.getByTestId("tpl-reset")).toBeEnabled();
      await noSideScroll(page);
      await page.screenshot({ path: testInfo.outputPath(`warning-${width}.png`), fullPage: true });
    });
  });
}
