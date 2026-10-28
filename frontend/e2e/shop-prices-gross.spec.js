const { test, expect } = require("@playwright/test");

// Bruttopreise (#2135): Schritt 4 der Produktverwaltung zeigt je Variante Printful brutto, den Mitgliederpreis, das
// Versandbeispiel nach Österreich und den Katalog netto nur als Prüfwert („prüfen“ nur bei starker Abweichung); die
// Einstellungen haben die Toleranz bei Preisänderung. Bei 390 und 1440 px, ohne seitliches Scrollen. Server und Konto
// sind Attrappen - kein echter Printful-Aufruf, erfundene Beträge.

const WIDTHS = [["handy-390", 390, 844], ["desktop-1440", 1440, 900]];
const FINANCE = { id: "u-shop", username: "fiona", display_name: "Fiona Finanzen", role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true };
const LABELS = {
  statuses: { draft: "Entwurf", reviewed: "geprüft", active: "veröffentlicht", archived: "archiviert" },
  visibilities: { public: "öffentlich (mit Konto)", members: "nur Mitglieder", hidden: "nur intern" },
  personalizations: { none: "keine", gamertag: "Gamertag", member_number: "Vereinsnummer", both: "Gamertag und Vereinsnummer" },
  kinds: { motif: "Motiv", gamertag: "Gamertag (Datei je Bestellung)", member_number: "Vereinsnummer (Datei je Bestellung, #1727)" },
  modes: { layout: "Motiv und Position", upload: "Fertige Druckdatei (für Profis)" },
  placements: { front: "Vorderseite", back: "Rückseite" },
};

function variant(color, size, sku, extra = {}) {
  return { id: `v-${sku}`, sku, label: `${color} / ${size}`, display_label: `${color === "Black" ? "Schwarz" : "Weiß"} / ${size}`, color, size,
    color_code: color === "Black" ? "#0c0c0c" : "#ffffff", active: true, blocked_reason: null, printful_variant_id: 4012, in_stock: true,
    base_cost_cents: 975, placement_costs: { back: 525 }, cost_cents: 1500, price_cents: 1170, public_price_cents: 1470,
    suggested_public_cents: 1470, price_warning: null, member_price_cents: 1170, price_source: "estimate", printful_gross_cents: 1170,
    printful_net_cents: 975, shipping_example_cents: 594, estimated_at: "2026-10-28T05:20:00+00:00", estimate_stale: false,
    catalog_check: true, ...extra };
}

const VIEW = {
  product: {
    id: "p1", slug: "vereinsshirt-test", title: "Vereinsshirt Test", status: "draft", visibility: "members", personalization: "gamertag",
    technique: "dtg", offer: { colors: ["Black", "White"], sizes: ["M", "XXL"], color_labels: {} },
    printful: { product_id: 71, name: "Unisex Testshirt", techniques: ["dtg"], default_technique: "dtg", is_discontinued: false, loaded_at: "2026-10-28T08:00:00+00:00",
      sizes: ["M", "XXL"], colors: [{ name: "Black", code: "#0c0c0c" }, { name: "White", code: "#ffffff" }],
      placements: [{ placement: "front", technique: "dtg", width_in: 12, height_in: 16 }], variants: [] },
  },
  labels: LABELS,
  color_labels: { Black: "Schwarz", White: "Weiß" }, color_defaults: { Black: "Schwarz", White: "Weiß" }, size_labels: { M: "M", XXL: "XXL" },
  variants: [
    variant("Black", "M", "PF1"),
    variant("White", "XXL", "PF2", { base_cost_cents: 1175, cost_cents: 1700, price_cents: 1410, member_price_cents: 1410,
      printful_gross_cents: 1410, printful_net_cents: 1175, public_price_cents: 1710, suggested_public_cents: 1710, catalog_check: false }),
  ],
  placements: [], available_placements: [], included_placement: "front", layout_converted: false,
  print_template: { printful_product_id: 71, checked_at: "2026-10-28T05:20:00+00:00", changed_at: null, changes: [], last_error: null, loaded: true },
  presets: [], preset_rules: { safe_margin_cm: { front: 0 }, min_dpi_ratio: 0.66, warn_dpi_ratio: 1, min_width_cm: 1 },
  motif_options: [], gamertag_canvas: { width_in: 3.5, height_in: 0.75, anchor_y_in: 0.375 },
  pricing: { general_markup_cents: 300, product_markup_cents: null, effective_markup_cents: 300, source: "general", member_markup_cents: 0,
    estimate_country: "AT", note: "zzgl. Versand, genauer Betrag an der Kasse" },
  check: { items: [], review_ready: false, publish_ready: false },
  sync: null, transitions: ["archived"], editable: true,
  limits: { max_variants: 80, max_placements: 12, max_layers: 6, min_width_cm: 1, max_offset_cm: 300 },
};

const CONFIG = {
  config: { stage: "admins", stage_label: "Nur Admins (Test)", effective_stage: "admins", orders_to_printful: false, public_markup_cents: 300,
    member_markup_cents: 0, fallback_shipping_cents: 690, min_price_cents: 100, price_tolerance_cents: 50, shipping_countries: ["AT"],
    tax_cleared: null, printful_key: { state: "ok", saved_at: "2026-10-27T09:00:00+00:00", saved_by: "clubadmin", detail: null },
    printful_last_test: null, updated_at: null },
  stages: [{ key: "off", label: "Aus", hint: "", locked: false, lock_reason: null }, { key: "admins", label: "Nur Admins (Test)", hint: "", locked: false, lock_reason: null }],
  rights: { can_set_public: false, can_set_tax: false, can_edit_access: false },
  limits: { public_markup_cents: 10000, fallback_shipping_cents: 10000, min_price_cents: 10000, price_tolerance_cents: 10000 },
};

async function mockApi(page, posted) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/admin/shop/products/p1/prices/estimate" && request.method() === "POST") {
      posted.push(url.pathname);
      return json({ ...VIEW, result: { estimated: 2, offered: 2, detail: "2 von 2 Varianten brutto geschätzt." } });
    }
    if (url.pathname === "/api/admin/shop/config" && request.method() === "PATCH") {
      posted.push(request.postDataJSON());
      return json({ ...CONFIG, config: { ...CONFIG.config, price_tolerance_cents: 30 }, changed: ["price_tolerance_cents"] });
    }
    if (url.pathname === "/api/auth/me") return json(FINANCE);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/shop/products/p1") return json(VIEW);
    if (url.pathname === "/api/admin/shop/config") return json(CONFIG);
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

    test("Schritt 4: Printful brutto, Mitgliederpreis, Versand AT, Katalog netto als Prüfwert (#2135)", async ({ page }, testInfo) => {
      const posted = [];
      await page.setViewportSize({ width, height });
      await mockApi(page, posted);
      await page.goto("/admin/shop/products/p1");
      await page.getByTestId("shop-step-prices").click();
      const step = page.locator("[data-testid='shop-step-prices']").last();
      await expect(page.getByTestId("shop-prices-explain")).toContainText("zzgl. Versand, genauer Betrag an der Kasse");
      await expect(page.getByTestId("shop-price-PF1-gross")).toContainText("11,70 €");
      await expect(page.getByTestId("shop-price-PF1-member")).toContainText("11,70 €");
      await expect(page.getByTestId("shop-price-PF1-shipping")).toContainText("5,94 €");
      await expect(page.getByTestId("shop-price-PF1-catalog")).toContainText("15,00 €");
      await expect(page.getByTestId("shop-price-PF1-check")).toContainText("prüfen");
      await expect(page.getByTestId("shop-price-PF2-check")).toHaveCount(0);
      expect(await overflow(page), "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
      const shot = testInfo.outputPath(`schritt4-brutto-${label}.png`);
      await step.screenshot({ path: shot });
      await testInfo.attach(`schritt4-brutto-${label}.png`, { path: shot, contentType: "image/png" });
      await page.getByTestId("shop-prices-estimate").click();
      await expect(page.getByText("2 von 2 Varianten brutto geschätzt.")).toBeVisible();
      expect(posted).toEqual(["/api/admin/shop/products/p1/prices/estimate"]);
    });

    test("Einstellungen: Toleranz bei Preisänderung speichern (#2135)", async ({ page }) => {
      const posted = [];
      await page.setViewportSize({ width, height });
      await mockApi(page, posted);
      await page.goto("/admin/shop");
      const tolerance = page.getByTestId("shop-price-tolerance");
      await expect(tolerance).toHaveValue("0,50");
      await expect(page.getByTestId("shop-member-price")).toContainText("Printful brutto");
      await tolerance.fill("0,30");
      await page.getByTestId("shop-prices-save-submit").click();
      await expect.poll(() => posted.length).toBe(1);
      expect(posted[0]).toEqual({ public_markup_cents: 300, fallback_shipping_cents: 690, price_tolerance_cents: 30, reason: "" });
      await expect(tolerance).toHaveValue("0,30");
      expect(await overflow(page), "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
    });
  });
}
