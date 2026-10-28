const { test, expect } = require("@playwright/test");

// Testentwurf mit Vereinsnummer (#2150): druckt ein Produkt die Vereinsnummer, sagt Schritt 3 „Test-Gamertag und
// Nummer“, dass die Beispielnummer gedruckt wird (nie die eines Mitglieds), und die Vorschau nennt die eigene Datei je
// Fläche. Bei 390 und 1440 px, ohne seitliches Scrollen. Server und Konto sind Attrappen - kein echter Printful-Aufruf.

const WIDTHS = [["handy-390", 390, 844], ["desktop-1440", 1440, 900]];
const FINANCE = { id: "u-shop", username: "fiona", display_name: "Fiona Finanzen", role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true };
const SHA = "9c1e0a21b7d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7";
const ADDRESS = { name: "Testverein Löwen", street: "Vereinsgasse 1", street2: "", zip: "6020", city: "Innsbruck", country: "AT" };
const VARIANTS = [
  { id: "v-sm", label: "Black / M", size: "M", color: "Black", color_label: "Schwarz", printful_variant_id: 4012, price_cents: 1500, in_stock: true },
  { id: "v-wm", label: "White / M", size: "M", color: "White", color_label: "Weiß", printful_variant_id: 4014, price_cents: 1500, in_stock: true },
];
const OVERVIEW = {
  access: { allowed: true, problems: [], stage: "admins", stage_label: "Nur Admins (Test)", key_state: "ok", orders_to_printful: false },
  products: [{ id: "p1", title: "Trikot Test", status: "reviewed", status_label: "geprüft", printful_name: "Testtrikot", gamertag: false,
    member_number: true, sample_number: "99", variants: VARIANTS }],
  address: { address: ADDRESS, complete: true, hint: null },
  gamertag: { allowed_text: "Buchstaben A–Z, Ziffern 0–9", min_length: 2, max_length: 16 },
  limits: { preview_minutes: 60, max_open: 5 }, drafts: [], mockup: "Mockup folgt (#1710).",
};
const PREVIEW = {
  id: "td-1", kind: "test_draft", state: "preview", external_id: "lswtest-td-1", product_title: "Trikot Test", variant_label: "White / M",
  variant_display: "Weiß / M", printful_variant_id: 4014, recipient: ADDRESS, expires_at: "2026-10-28T15:00:00+00:00", with_number: true,
  files: [
    { placement: "front", placement_label: "Vorderseite", technique: "dtg", kind: "base", version: 1, sha256: SHA, width_px: 1800, height_px: 2400, dpi: 150, url: "https://lsw.example.test/api/shop/print-files/a/vorne-v1.png" },
    { placement: "back", placement_label: "Rückseite", technique: "dtg", kind: "personal", version: null, sha256: SHA, width_px: 1800, height_px: 2400, dpi: 150, url: "https://lsw.example.test/api/shop/print-files/b/druck-1.png" },
  ],
  estimate: { subtotal_cents: 1500, shipping_cents: 495, vat_cents: 399, tax_cents: 0, total_cents: 2394 }, estimate_error: null,
  price_check: { shop_cents: 1500, printful_subtotal_cents: 1500, level: "ok" }, mockup: { state: "pending", detail: "Mockup folgt (#1710)." },
  warnings: [], payload: {},
};

async function mockApi(page, posted) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/admin/shop/test-drafts/preview" && request.method() === "POST") {
      posted.push(request.postDataJSON());
      return json(PREVIEW);
    }
    if (url.pathname === "/api/admin/shop/test-drafts") return json(OVERVIEW);
    if (url.pathname === "/api/auth/me") return json(FINANCE);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
    });

    test("Testentwurf mit Vereinsnummer: Beispielnummer statt Eingabe, eigene Datei je Fläche (#2150)", async ({ page }, testInfo) => {
      const posted = [];
      await page.setViewportSize({ width, height });
      await mockApi(page, posted);
      await page.goto("/admin/shop/test-draft");
      await page.getByTestId("shop-test-draft-product-select").selectOption("p1");
      await page.getByTestId("shop-test-draft-color-White").click();
      await page.getByTestId("shop-test-draft-size-M").click();
      const step = page.getByTestId("shop-test-draft-gamertag");
      await expect(step).toContainText("Test-Gamertag und Nummer");
      await expect(page.getByTestId("shop-test-draft-number")).toContainText("Beispielnummer 99");
      await expect(page.getByTestId("shop-test-draft-number")).toContainText("nie die Nummer eines Mitglieds");
      await expect(step.getByRole("textbox")).toHaveCount(0);
      const overflow = async () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(await overflow(), "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
      const shot = testInfo.outputPath(`testentwurf-nummer-${label}.png`);
      await step.screenshot({ path: shot });
      await testInfo.attach(`testentwurf-nummer-${label}.png`, { path: shot, contentType: "image/png" });
      await page.getByTestId("shop-test-draft-preview-button").click();
      await expect(page.getByTestId("shop-test-draft-files")).toContainText("eigene Datei mit Gamertag bzw. Nummer");
      expect(posted).toEqual([{ product_id: "p1", variant_id: "v-wm", gamertag: "", address: ADDRESS }]);
      expect(await overflow(), "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
    });
  });
}
