const { test, expect } = require("@playwright/test");

// Produktoptionen von Printful (#2158): ein Zuschnitt-und-Naht-Produkt verlangt die Nahtfarbe. Schritt 2 zeigt sie als
// Auswahl („Nahtfarbe: Weiß / Schwarz“) und schickt den Katalogwert mit; der Testentwurf nennt sie in der Vorschau.
// Bei 390 und 1440 px, ohne seitliches Scrollen. Server und Konto sind Attrappen - kein echter Printful-Aufruf.

const WIDTHS = [["handy-390", 390, 844], ["desktop-1440", 1440, 900]];
const FINANCE = { id: "u-shop", username: "fiona", display_name: "Fiona Finanzen", role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true };
const LABELS = {
  statuses: { draft: "Entwurf", reviewed: "geprüft", active: "veröffentlicht", archived: "archiviert" },
  visibilities: { public: "öffentlich (mit Konto)", members: "nur Mitglieder", hidden: "nur intern" },
  personalizations: { none: "keine", gamertag: "Gamertag", member_number: "Vereinsnummer", both: "Gamertag und Vereinsnummer" },
  kinds: { motif: "Motiv", gamertag: "Gamertag (Datei je Bestellung)", member_number: "Vereinsnummer (Datei je Bestellung, #1727)" },
  modes: { layout: "Motiv und Position", upload: "Fertige Druckdatei (für Profis)" },
  placements: { front: "Vorderseite" },
};
const OPTIONS = {
  loaded: true, missing: [], skipped: [],
  options: [
    { name: "stitch_color", label: "Nahtfarbe", type: "string", techniques: ["cut-sew"], required: true, selected: "White",
      values: [{ value: "White", label: "Weiß" }, { value: "Black", label: "Schwarz" }] },
    { name: "inside_pocket", label: "Innentasche", type: "boolean", techniques: ["cut-sew"], required: false, selected: null,
      values: [{ value: true, label: "ja" }, { value: false, label: "nein" }] },
  ],
};

function variant(size, sku) {
  return { id: `v-${sku}`, sku, label: `White / ${size}`, display_label: `Weiß / ${size}`, color: "White", size, color_code: "#ffffff", active: true,
    blocked_reason: null, printful_variant_id: 16261, in_stock: true, base_cost_cents: 2995, placement_costs: {}, cost_cents: 2995,
    price_cents: 2995, public_price_cents: 3295, suggested_public_cents: 3295, price_warning: null };
}

const VIEW = {
  product: {
    id: "p1", slug: "trikot-test", title: "Trikot Test", status: "draft", visibility: "members", personalization: "none",
    technique: "cut-sew", offer: { colors: ["White"], sizes: ["M"], color_labels: {}, options: { stitch_color: "White" } },
    printful: { product_id: 412, name: "All-Over Print Jersey", techniques: ["cut-sew"], default_technique: "cut-sew", is_discontinued: false,
      loaded_at: "2026-10-28T08:00:00+00:00", sizes: ["M", "L"], colors: [{ name: "White", code: "#ffffff" }],
      placements: [{ placement: "front", technique: "cut-sew", width_in: 33, height_in: 45 }],
      variants: [{ id: 16261, color: "White", size: "M" }, { id: 16262, color: "White", size: "L" }] },
  },
  labels: LABELS,
  color_labels: { White: "Weiß" }, color_defaults: { White: "Weiß" }, size_labels: { M: "M", L: "L" },
  product_options: OPTIONS,
  variants: [variant("M", "PF1")],
  placements: [], available_placements: [], included_placement: "front", layout_converted: false,
  print_template: { printful_product_id: 412, checked_at: "2026-10-28T05:20:00+00:00", changed_at: null, changes: [], last_error: null, loaded: true },
  presets: [], preset_rules: { safe_margin_cm: { front: 0 }, min_dpi_ratio: 0.66, warn_dpi_ratio: 1, min_width_cm: 1 },
  motif_options: [], gamertag_canvas: { width_in: 3.5, height_in: 0.75, anchor_y_in: 0.375 },
  pricing: { general_markup_cents: 300, product_markup_cents: null, effective_markup_cents: 300, source: "general", member_markup_cents: 0 },
  check: { items: [{ key: "options", label: "Produktoptionen von Printful", ok: true, state: "ok", detail: "Nahtfarbe: Weiß", for_review: true }],
    review_ready: false, publish_ready: false },
  sync: null, transitions: ["archived"], editable: true,
  limits: { max_variants: 80, max_placements: 12, max_layers: 6, min_width_cm: 1, max_offset_cm: 300 },
};

const ADDRESS = { name: "Testverein Löwen", street: "Vereinsgasse 1", street2: "", zip: "6020", city: "Innsbruck", country: "AT" };
const OVERVIEW = {
  access: { allowed: true, problems: [], stage: "admins", stage_label: "Nur Admins (Test)", key_state: "ok", orders_to_printful: false },
  products: [{ id: "p1", title: "Trikot Test", status: "draft", status_label: "Entwurf", printful_name: "All-Over Print Jersey", gamertag: false,
    variants: [{ id: "v-PF1", label: "White / M", size: "M", color: "White", color_label: "Weiß", printful_variant_id: 16261, price_cents: 2995, in_stock: true }] }],
  address: { address: ADDRESS, complete: true, hint: null },
  gamertag: { allowed_text: "Buchstaben A–Z, Ziffern 0–9", min_length: 2, max_length: 16 },
  limits: { preview_minutes: 60, max_open: 5 }, drafts: [], mockup: "Mockup folgt (#1710).",
};
const PREVIEW = {
  id: "td-1", kind: "test_draft", state: "preview", external_id: "lswtest-td-1", product_title: "Trikot Test", variant_label: "White / M",
  variant_display: "Weiß / M", printful_variant_id: 16261, recipient: ADDRESS, expires_at: "2026-10-28T15:00:00+00:00",
  files: [], estimate: { subtotal_cents: 2995, shipping_cents: 495, vat_cents: 698, tax_cents: 0, total_cents: 4188 }, estimate_error: null,
  price_check: { shop_cents: 2995, printful_subtotal_cents: 2995, level: "ok" }, mockup: { state: "pending", detail: "Mockup folgt (#1710)." },
  product_options: [{ name: "stitch_color", value: "White", label: "Nahtfarbe", value_label: "Weiß" }], warnings: [], payload: {},
};

async function mockApi(page, posted) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/admin/shop/products/p1/offer" && request.method() === "PUT") {
      posted.push(request.postDataJSON());
      return json(VIEW);
    }
    if (url.pathname === "/api/admin/shop/test-drafts/preview" && request.method() === "POST") return json(PREVIEW);
    if (url.pathname === "/api/admin/shop/test-drafts") return json(OVERVIEW);
    if (url.pathname === "/api/auth/me") return json(FINANCE);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/shop/products/p1") return json(VIEW);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
}

const overflow = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
    });

    test("Schritt 2: Nahtfarbe wählen und mit dem Angebot speichern (#2158)", async ({ page }, testInfo) => {
      const posted = [];
      await page.setViewportSize({ width, height });
      await mockApi(page, posted);
      await page.goto("/admin/shop/products/p1");
      await page.getByTestId("shop-step-offer").click();
      const box = page.getByTestId("shop-offer-options");
      await expect(box).toContainText("Nahtfarbe");
      await expect(page.getByTestId("shop-offer-options-other")).toContainText("Innentasche");
      await page.getByTestId("shop-offer-option-stitch_color").selectOption({ label: "Schwarz" });
      expect(await overflow(page), "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
      const shot = testInfo.outputPath(`optionen-${label}.png`);
      await box.screenshot({ path: shot });
      await testInfo.attach(`optionen-${label}.png`, { path: shot, contentType: "image/png" });
      await page.getByTestId("shop-offer-submit").click();
      await expect.poll(() => posted.length).toBe(1);
      expect(posted[0].product_options).toEqual({ stitch_color: "Black" });
    });

    test("Testentwurf nennt die Produktoptionen in der Vorschau (#2158)", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page, []);
      await page.goto("/admin/shop/test-draft");
      await page.getByTestId("shop-test-draft-product-select").selectOption("p1");
      await page.getByTestId("shop-test-draft-color-White").click();
      await page.getByTestId("shop-test-draft-size-M").click();
      await page.getByTestId("shop-test-draft-preview-button").click();
      await expect(page.getByTestId("shop-test-draft-options")).toContainText("Nahtfarbe: Weiß");
      expect(await overflow(page), "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
    });
  });
}
