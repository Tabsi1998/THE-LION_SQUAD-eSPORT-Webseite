const { test, expect } = require("@playwright/test");

// Finanzübersicht (#2226) bei 390 und 1440 px: „bezahlt mit Abzug“ mit Grund und langer Anmerkung, gelöschter Entwurf mit seinen zwei
// Wegen, ein Angebot, das es nicht mehr gibt. Server und Konto sind Attrappen; nichts geht wirklich hinaus.

const WIDTHS = [["handy", 390, 844], ["pc", 1440, 900]];
const TREASURER = { id: "u-kassa", username: "kai", display_name: "Kai Kassa", role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true };
const SOURCE = { name: "Lion Squad Winter-LAN 2026 – Wochenende mit Übernachtung", slug: "winter-lan", kind: "event" };
const GONE = { name: "Angebot nicht mehr vorhanden", slug: null, kind: "event" };
const LONG_NOTE = "<img src=x onerror=alert(1)> Die Begleitperson kam nicht, der Vorstand hat den Betrag am Abend erlassen und das Essen übernommen. ".repeat(3).slice(0, 300);

const REDUCED = {
  id: "o-abzug", kind: "event", source_id: "e1", user_id: "u1", status: "invoiced", total_cents: 4000, currency: "EUR", total: "40,00 €", invoice_ref: "FA2609-000123",
  invoice_status: "paid", paid: true, payment_state: "paid_reduced", payment_label: "bezahlt mit Abzug", remaining_cents: 2000, waived_cents: 2000, paid_cents: 2000, refunded_cents: 0, credited_cents: 0,
  close_code: "other", close_reason: "Sonstiger Grund", close_note: LONG_NOTE,
  synced_at: "2026-10-14T08:00:00+00:00", source: SOURCE, person: "Maximiliane Sophie Mustermann-Oberhuber",
};
const OVERVIEW = {
  by_status: { held: { count: 1, total_cents: 2000 } },
  labels: { held: "wartet auf Freigabe", invoiced: "Rechnung angelegt" },
  payment_labels: { paid_reduced: "bezahlt mit Abzug", paid: "bezahlt" },
  open: [{ id: "o-weg", kind: "event", source_id: "ev-interne-kennung", user_id: "u2", status: "held", total_cents: 2000, currency: "EUR", total: "20,00 €", created_at: "2026-09-22T10:00:00+00:00", source: GONE, person: "Paula",
    note: "Entwurf (PROV123) wurde in Dolibarr gelöscht. Soll neu abgerechnet werden: „Freigeben“. Sonst: „Keine neue Rechnung“.", removed_invoices: [{ invoice_id: 123, invoice_ref: "(PROV123)", at: "2026-10-14T08:00:00+00:00" }] }],
  open_total: 1,
  invoiced: [REDUCED, { ...REDUCED, id: "o-ohne", invoice_ref: "FA2609-000124", close_code: undefined, close_reason: null, close_note: undefined }],
  invoiced_total: 2, cases: [], cases_open: 0, cases_resolved: 0, pdfs: { unconfirmed: 0 },
  summary: { orders: 2, cancelled_orders: 0, booked_cents: 8000, invoiced_cents: 8000, paid_cents: 4000, open_cents: 0, credited_cents: 0, waived_cents: 4000, refunded_cents: 0, cases_open: 0 },
  attention: { overdue: 0, pdf_missing: 0, draft_old: 0 }, attention_labels: { overdue: "überfällig", pdf_missing: "PDF fehlt", draft_old: "Entwurf alt" },
  dolibarr: { connected: true, mode: "live", write_capable: true, terms_complete: true, invoice_auto_validate: false }, tax_profiles: [], price_bases: {},
};
const DETAIL = {
  order: { ...REDUCED, status_label: "Rechnung angelegt" }, positions: [{ key: "beitrag", label: "Kostenbeitrag", quantity: 2, total_cents: 4000 }],
  registration: { status: "registered", status_label: "angemeldet", seat_count: 2 }, cases: [],
  timeline: [{ at: "2026-10-14T08:00:00+00:00", kind: "invoice", text: "Abschluss in Dolibarr: Sonstiger Grund – System" }],
  sums: { paid_cents: 2000, refunded_cents: 0, credited_cents: 0, waived_cents: 2000, refundable_cents: 2000 }, payment_labels: { paid_reduced: "bezahlt mit Abzug" },
};
const REMOVED_DETAIL = {
  order: { ...OVERVIEW.open[0], status_label: "wartet auf Freigabe" }, positions: [], registration: null, cases: [],
  timeline: [{ at: "2026-10-14T08:00:00+00:00", kind: "invoice", text: "Entwurf (PROV123) in Dolibarr gelöscht" }], sums: {}, payment_labels: {},
};

async function mockApi(page) {
  const sent = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      sent.push(url.pathname);
      return json({ ok: true });
    }
    if (url.pathname === "/api/auth/me") return json(TREASURER);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/finance/overview") return json(OVERVIEW);
    if (url.pathname === "/api/admin/finance/orders/o-abzug") return json(DETAIL);
    if (url.pathname === "/api/admin/finance/orders/o-weg") return json(REMOVED_DETAIL);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
  return sent;
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
    });

    test("bezahlt mit Abzug zeigt erlassen statt offen, Grund und Anmerkung als reinen Text", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);
      await page.goto("/admin/finance");
      const line = page.getByTestId("finance-payment-o-abzug");
      await expect(line).toBeVisible({ timeout: 20000 });
      await expect(line).toContainText("bezahlt mit Abzug");
      await expect(line).toContainText("20,00 € erlassen");
      await expect(line).not.toContainText("offen");

      const close = page.getByTestId("finance-close-o-abzug");
      await expect(close).toContainText("Grund: Sonstiger Grund");
      await expect(close).toContainText("<img src=x onerror=alert(1)>");
      await expect(close.locator("img")).toHaveCount(0);
      await expect(page.getByTestId("finance-close-o-ohne")).toHaveCount(0);
      await expect(page.getByTestId("finance-payment-o-ohne")).toContainText("20,00 € erlassen");

      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow, "die Seite selbst läuft nicht über").toBeLessThanOrEqual(2);

      await page.getByTestId("finance-detail-o-abzug").click();
      const detail = page.getByTestId("finance-detail");
      await expect(detail.getByTestId("finance-detail-sums")).toContainText("erlassen");
      await expect(detail.getByTestId("finance-close-o-abzug")).toContainText("Anmerkung:");
      await expect(detail.getByTestId("finance-detail-timeline")).toContainText("Abschluss in Dolibarr: Sonstiger Grund");
      const after = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(after, "auch das Detail läuft nicht über").toBeLessThanOrEqual(2);
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/finanzen-abzug-${label}.png`, fullPage: true });
    });

    test("gelöschter Entwurf: zwei Wege, keine interne Kennung als Angebotsname", async ({ page }) => {
      await page.setViewportSize({ width, height });
      const sent = await mockApi(page);
      await page.goto("/admin/finance");
      const row = page.getByTestId("finance-order-o-weg");
      await expect(row).toBeVisible({ timeout: 20000 });
      await expect(row).toContainText("Angebot nicht mehr vorhanden");
      await expect(row).toContainText("in Dolibarr gelöscht");
      await expect(page.locator("body")).not.toContainText("ev-interne-kennung");

      await page.getByTestId("finance-detail-o-weg").click();
      await expect(page.getByTestId("finance-detail-timeline")).toContainText("Entwurf (PROV123) in Dolibarr gelöscht");

      const dismiss = page.getByTestId("finance-dismiss-o-weg");
      await dismiss.scrollIntoViewIfNeeded();
      await expect(dismiss).toBeInViewport();
      await expect(page.getByTestId("finance-release-o-weg")).toBeVisible();
      await dismiss.click();
      await expect.poll(() => sent).toContain("/api/admin/finance/orders/o-weg/dismiss");
    });

    test("Summen nennen den erlassenen Betrag", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);
      await page.goto("/admin/finance");
      // Die Summenzeile gehört zur gewählten Veranstaltung; die Attrappe liefert sie immer.
      await expect(page.getByTestId("finance-sum-waived_cents")).toContainText("40,00 €", { timeout: 20000 });
      await expect(page.getByTestId("finance-sum-open_cents")).toContainText("0,00 €");
    });
  });
}
