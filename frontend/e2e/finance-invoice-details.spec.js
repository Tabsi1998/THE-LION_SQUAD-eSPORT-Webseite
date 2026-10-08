const { test, expect } = require("@playwright/test");

// Rechnungsangaben (#1358): der Kassier (nur Bereich Finanzen) trägt Zahlungsziel, Zahlungsart und Bankkonto ein - danach
// verschwindet der Hinweis „fehlen noch“. Bei 390, 768 und 1440 px.

const WIDTHS = [["handy", 390, 844], ["tablet", 768, 1024], ["pc", 1440, 900]];
const TREASURER = { id: "u-kassa", username: "kai", display_name: "Kai Kassa", role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true };
const OPTIONS = {
  available: true,
  terms: [{ id: 1, code: "RECEP", label: "Sofort bei Erhalt" }, { id: 2, code: "30D", label: "30 Tage" }],
  modes: [{ id: 4, code: "VIR", label: "Banküberweisung" }],
  accounts: [{ id: 1, code: "", label: "Girokonto des Vereins" }],
  suggested: { payment_term_id: 2, payment_mode_id: 4, bank_account_id: 1 },
};

function details(complete) {
  return {
    connected: true, write_enabled: true, write_capable: true, invoice_auto_validate: false, tax_rates: { none: 0 }, tax_confirmed: null,
    terms: { payment_term_id: complete ? 2 : null, payment_mode_id: complete ? 4 : null, bank_account_id: complete ? 1 : null, complete, pdf_lang: "de_AT", pdf_langs: [{ code: "de_AT", label: "Deutsch (Österreich)" }] },
  };
}

async function mockApi(page, state) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "PUT" && url.pathname === "/api/admin/finance/invoice-details") {
      state.saved = request.postDataJSON();
      state.complete = Boolean(state.saved.invoice_payment_term_id && state.saved.invoice_payment_mode_id && state.saved.invoice_bank_account_id);
      return json({ ok: true, changed: Object.keys(state.saved), ...details(state.complete) });
    }
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json(TREASURER);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/finance/overview") {
      return json({ by_status: {}, labels: {}, payment_labels: {}, cases: [], cases_open: 0, open: [], invoiced: [], pdfs: { unconfirmed: 0 },
        dolibarr: { connected: true, write_capable: true, terms_complete: state.complete, credit_note_draft_on_cancel: false } });
    }
    if (url.pathname === "/api/admin/finance/invoice-details") return json(details(state.complete));
    if (url.pathname === "/api/admin/finance/invoice-options") return json(OPTIONS);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
      await page.setViewportSize({ width, height });
    });

    test("Kassier trägt Zahlungsziel, Zahlungsart und Bankkonto ein – der Hinweis verschwindet", async ({ page }) => {
      const state = { complete: false, saved: null };
      await mockApi(page, state);
      await page.goto("/admin/finance");
      await expect(page.getByTestId("finance-terms-hint")).toBeVisible();
      await page.getByTestId("finance-terms-hint-link").click();
      await expect(page.getByTestId("invoice-details")).toBeVisible();
      await page.getByTestId("invoice-terms-payment_term_id").selectOption("2");
      await page.getByTestId("invoice-terms-payment_mode_id").selectOption("4");
      await page.getByTestId("invoice-terms-bank_account_id").selectOption("1");
      await page.getByTestId("invoice-terms-save").click();
      await expect(page.getByTestId("invoice-terms-state")).toHaveText("vollständig");
      expect(state.saved).toEqual({ invoice_payment_term_id: 2, invoice_payment_mode_id: 4, invoice_bank_account_id: 1, invoice_pdf_lang: "de_AT" });
      await page.getByTestId("finance-tab-overview").click();
      await expect(page.getByTestId("finance-dolibarr")).toBeVisible();
      await expect(page.getByTestId("finance-terms-hint")).toHaveCount(0);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  });
}
