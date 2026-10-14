const { test, expect } = require("@playwright/test");

// Finanzübersicht am Handy (#990): die beiden Tabellen werden nicht rechts abgeschnitten. Sie liegen in einer Fläche,
// die seitlich scrollt (Wischen oder Tastatur), darüber steht der Hinweis; jede Spalte und jeder Knopf ist erreichbar.
// Gefüllte Tabellen mit langen Namen und Beträgen, bei 320, 390, 414 und 768 px. Server und Konto sind Attrappen -
// keine echte Finanzaktion.

const WIDTHS = [["handy-320", 320, 700], ["handy-390", 390, 844], ["handy-414", 414, 896], ["tablet-768", 768, 1024]];
const TREASURER = { id: "u-kassa", username: "kai", display_name: "Kai Kassa", role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true };
const SOURCE = { name: "Lion Squad Winter-LAN 2026 – Wochenende mit Übernachtung", slug: "winter-lan", kind: "event" };
const OVERVIEW = {
  by_status: { held: { count: 1, total_cents: 1234567 }, failed: { count: 1, total_cents: 4000 } },
  labels: { held: "angehalten", failed: "fehlgeschlagen", waiting_review: "Prüfung nötig", invoiced: "Rechnung angelegt" },
  payment_labels: { partial: "teilweise bezahlt", paid: "bezahlt", open: "offen", overdue: "überfällig" },
  open: [
    { id: "o1", kind: "event", source_id: "e1", user_id: "u1", status: "held", total_cents: 1234567, currency: "EUR", total: "12.345,67 €", created_at: "2026-09-22T10:00:00+00:00", source: SOURCE, person: "Maximiliane Sophie Mustermann-Oberhuber" },
    { id: "o3", kind: "event", source_id: "e1", user_id: "u3", status: "failed", total_cents: 4000, currency: "EUR", total: "40,00 €", created_at: "2026-09-22T11:00:00+00:00", source: SOURCE, person: "Paula", note: "Dolibarr nicht erreichbar" },
    { id: "o4", kind: "event", source_id: "e1", user_id: "u4", status: "waiting_review", total_cents: 4000, currency: "EUR", total: "40,00 €", created_at: "2026-09-22T12:00:00+00:00", source: SOURCE, person: "Ein sehr langer Vereinsname e.V. Abteilung eSport" },
  ],
  invoiced: [
    {
      id: "o2", kind: "event", source_id: "e1", user_id: "u2", status: "invoiced", total_cents: 1234567, currency: "EUR", total: "12.345,67 €", invoice_ref: "FA2609-000123",
      invoice_status: "validated", payment_state: "overdue", payment_label: "überfällig", due_on: "2026-10-01", remaining_cents: 1234567, paid_cents: 0, refunded_cents: 0, credited_cents: 0,
      synced_at: "2026-10-14T08:00:00+00:00", source: SOURCE, person: "Maximiliane Sophie Mustermann-Oberhuber", dolibarr_url: "https://dolibarr.example.test/compta/facture/card.php?id=123",
    },
  ],
  cases: [], cases_open: 0, summary: null, pdfs: { unconfirmed: 0 },
  dolibarr: { connected: true, mode: "live", write_capable: true, terms_complete: true, invoice_auto_validate: false },
  tax_profiles: [], price_bases: {},
};

async function mockApi(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json(TREASURER);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/finance/overview") return json(OVERVIEW);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
}

/** Der Knopf liegt nach dem Scrollen sichtbar in der Fläche und wird nicht verdeckt. */
async function reachable(region, button) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  const regionBox = await region.boundingBox();
  const box = await button.boundingBox();
  expect(box.x, "der Knopf beginnt in der Fläche").toBeGreaterThanOrEqual(regionBox.x - 1);
  expect(box.x + box.width, "der Knopf endet in der Fläche").toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);
  const hit = await button.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return node === top || node.contains(top);
  });
  expect(hit, "nichts liegt über dem Knopf").toBe(true);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
    });

    test("alle Spalten und Aktionen der Finanztabellen sind erreichbar, nichts wird abgeschnitten", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);
      await page.goto("/admin/finance");
      const open = page.getByTestId("finance-open-scroll");
      const invoiced = page.getByTestId("finance-invoiced-scroll");
      await expect(open).toBeVisible({ timeout: 20000 });
      await expect(invoiced).toBeVisible();

      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow, "die Seite selbst läuft nicht über").toBeLessThanOrEqual(2);
      // Lange Veranstaltungsnamen machen den Filter nicht breiter als den Bildschirm.
      const filter = await page.getByTestId("finance-filter-source").boundingBox();
      expect(filter.x + filter.width, "der Filter passt in die Breite").toBeLessThanOrEqual(width + 1);

      for (const [region, testId] of [[open, "finance-open-scroll"], [invoiced, "finance-invoiced-scroll"]]) {
        const sizes = await region.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth, overflowX: getComputedStyle(node).overflowX }));
        expect(sizes.overflowX).toBe("auto");
        if (width < 768) expect(sizes.scroll, "am Handy ist die Tabelle breiter als die Fläche").toBeGreaterThan(sizes.client);
        if (sizes.scroll > sizes.client + 1) {
          await expect(page.getByTestId(`${testId}-hint`)).toBeVisible();
          // Tastatur: Fläche ansteuern, Pfeil nach rechts scrollt.
          await region.focus();
          for (let step = 0; step < 6; step += 1) await page.keyboard.press("ArrowRight");
          await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
          await region.evaluate((node) => { node.scrollLeft = 0; });
        } else {
          await expect(page.getByTestId(`${testId}-hint`)).toHaveCount(0);
        }
      }

      await reachable(open, page.getByTestId("finance-release-o1"));
      await reachable(open, page.getByTestId("finance-retry-o3"));
      await reachable(open, page.getByTestId("finance-assign-o4").getByRole("button", { name: "Zuordnen" }));
      await reachable(invoiced, page.getByTestId("finance-detail-o2"));
      await reachable(invoiced, page.getByTestId("finance-dolibarr-o2"));
      await expect(page.getByTestId("finance-payment-o2")).toContainText("überfällig");

      if (process.env.SHOT_DIR) {
        await open.evaluate((node) => { node.scrollLeft = 0; });
        await invoiced.evaluate((node) => { node.scrollLeft = 0; });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${process.env.SHOT_DIR}/finanzen-${label}.png`, fullPage: true });
        await open.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
        await open.screenshot({ path: `${process.env.SHOT_DIR}/finanzen-${label}-offen-rechts.png` });
      }
    });
  });
}
