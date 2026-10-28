const { test, expect } = require("@playwright/test");

// Schritt 3 „Druckflächen“ der Produktverwaltung (#2105): die Vorschau zeigt das Shirt in der gewählten Farbe (je
// Farbe die Vorlage bzw. die vom Server eingefärbte), Flächen und Farben auf Deutsch, den Gamertag als Beispielnamen
// in echter Größe mit Texthöhe und Höchstbreite je Ebene, und kein Grauschleier über dem Shirt. Bei 390 und 1440 px.
// Server und Konto sind Attrappen, die Bilder synthetisch - kein echtes Printful-Bild, keine echte Shop-Aktion.

const WIDTHS = [["handy-390", 390, 844], ["desktop-1440", 1440, 900]];
const FINANCE = { id: "u-shop", username: "fiona", display_name: "Fiona Finanzen", role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true };
// Synthetische Bilder: helles Shirtfoto, dasselbe eingefärbt (dunkel), ein Beispielname als Balken.
const LIGHT = "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAq0lEQVR42u3dsQkAIAwAQRVHyP4Tpk3vCoKICPd9Co+ktldV014DASxYsGDBgoUAFqzXzZPhzPzxzRFhs5whLFiwBAsWLFiwYAkWLFiwYMESLFiwYMGCJViwYMGCBUuwYMGCBQuWYMGCBQsWLMGCBQsWLFiCBQsWLFiwBAsWLFiwYAkWLFiwYMESLFiwYMGCJViwYMGCBUuwYMGCBQuWYMG6Xve/oc2CBeujFvaCCYdkxmgXAAAAAElFTkSuQmCC";
const DARK = "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAArElEQVR42u3dsQkAIAwAQRWXyP7DZYL0riCIiHDfp/BIantVNe01EMCCBQsWLFgIYMF63TwZjogf35yZNssZwoIFS7BgwYIFC5ZgwYIFCxYswYIFCxYsWIIFCxYsWLAECxYsWLBgCRYsWLBgwRIsWLBgwYIlWLBgwYIFS7BgwYIFC5ZgwYIFCxYswYIFCxYsWIIFCxYsWLAECxYsWLBgCRas63X/G9osWLA+agEx9AmH4ph8SwAAAABJRU5ErkJggg==";
const NAME = "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAYCAYAAAAxkDmIAAAASUlEQVR42u3RQRUAEABEQaRQQRWBVVFBCyLg5nkz5z3tDwEAALgTT4eljemut/Sat/2Sm/4msMAIjMAIjMAIjMACIzACAwDAnxYL3wQa+Sew0QAAAABJRU5ErkJggg==";

const AREA_FILE = { group: "all", variant_ids: null, width_px: 1800, height_px: 2400, dpi: 150, width_in: 12, height_in: 16, width_cm: 30.48, height_cm: 40.64, aspect_ok: true };
const PREVIEW = { image_path: "/api/admin/shop/print-templates/71/images/0", background_path: null, background_color: null, positioning: "background",
  template_width: 1000, template_height: 1000, area: { left: 275, top: 200, width: 450, height: 600 }, orientation: "any", tinted: false };
const LABELS = {
  statuses: { draft: "Entwurf", reviewed: "geprüft", active: "veröffentlicht", archived: "archiviert" },
  visibilities: { public: "öffentlich (mit Konto)", members: "nur Mitglieder", hidden: "nur intern" },
  personalizations: { none: "keine", gamertag: "Gamertag", member_number: "Vereinsnummer", both: "Gamertag und Vereinsnummer" },
  kinds: { motif: "Motiv", gamertag: "Gamertag (Datei je Bestellung)", member_number: "Vereinsnummer (Datei je Bestellung, #1727)" },
  modes: { layout: "Motiv und Position", upload: "Fertige Druckdatei (für Profis)" },
  placements: { front: "Vorderseite", sleeve_left_short_dtf: "Ärmel links (kurz)" },
};

function variant(color, size, sku) {
  return { id: `v-${sku}`, sku, label: `${color} / ${size}`, display_label: `${color === "Black" ? "Schwarz" : "Weiß"} / ${size}`, color, size,
    color_code: color === "Black" ? "#0c0c0c" : "#ffffff", active: true, blocked_reason: null, printful_variant_id: 4000, in_stock: true,
    base_cost_cents: 975, placement_costs: {}, cost_cents: 1500, price_cents: 1500, public_price_cents: 1800, suggested_public_cents: 1800, price_warning: null };
}

const VIEW = {
  product: {
    id: "p1", slug: "vereinsshirt-test", title: "Vereinsshirt Test", status: "draft", visibility: "members", personalization: "gamertag",
    technique: "dtfilm", offer: { colors: ["Black", "White"], sizes: ["M"], color_labels: {} },
    printful: { product_id: 71, name: "Unisex Testshirt", techniques: ["dtfilm"], default_technique: "dtfilm", is_discontinued: false, loaded_at: "2026-10-28T08:00:00+00:00",
      sizes: ["M"], colors: [{ name: "Black", code: "#0c0c0c" }, { name: "White", code: "#ffffff" }],
      placements: [{ placement: "front", technique: "dtfilm", width_in: 12, height_in: 16 }], variants: [] },
  },
  labels: LABELS,
  color_labels: { Black: "Schwarz", White: "Weiß" }, color_defaults: { Black: "Schwarz", White: "Weiß" }, size_labels: { M: "M" },
  variants: [variant("Black", "M", "PF1"), variant("White", "M", "PF2")],
  placements: [{ key: "front", label: "Vorderseite", mode: "layout", printful_placement: "front", included: true, surcharge_cents: null,
    layers: [
      { kind: "motif", preset: "chest_right", width_cm: 8.9, offset_x_cm: 0, offset_y_cm: 0, motif: { key: "loewe", by_color: {} } },
      { kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0 },
    ],
    files: [{ placement: "front", color: "Black", color_label: "Schwarz", group: "all", state: "ok", detail: "", file: { id: "f1", version: 1, warnings: [] }, plan: { layers: [] } },
      { placement: "front", color: "White", color_label: "Weiß", group: "all", state: "ok", detail: "", file: { id: "f2", version: 1, warnings: [] }, plan: { layers: [] } }] }],
  available_placements: [
    { key: "front", label: "Vorderseite", label_translated: true, family: "front", family_label: "Vorderseite", technique: "dtfilm", safe_margin_cm: 0,
      file: AREA_FILE, groups: [AREA_FILE], preview: PREVIEW,
      preview_by_color: { Black: { ...PREVIEW, image_path: `${PREVIEW.image_path}?tint=0c0c0c`, tinted: true }, White: { ...PREVIEW, image_path: `${PREVIEW.image_path}?tint=ffffff`, tinted: true } },
      presets: { motif: ["chest_right"], text: ["text_opposite"] } },
  ],
  included_placement: "front", layout_converted: false,
  print_template: { printful_product_id: 71, checked_at: "2026-10-28T05:20:00+00:00", changed_at: null, changes: [], last_error: null, loaded: true },
  presets: [
    { key: "chest_right", label: "Brust rechts (vom Träger aus)", hint: "", kind: "motif", families: ["front"], center_x: 0.27, anchor: "top", top_cm: 5, width_cm: 8.9 },
    { key: "text_opposite", label: "Brust gegenüber dem Motiv", hint: "", kind: "text", families: ["front"], follow: "opposite", center_x: 0.5, anchor: "top", top_cm: 0 },
  ],
  preset_rules: { safe_margin_cm: { front: 0 }, min_dpi_ratio: 0.66, warn_dpi_ratio: 1, min_width_cm: 1 },
  motif_options: [{ key: "loewe", title: "Löwe", width_px: 1000, height_px: 1000, image_path: "/api/shop/print-files/k1/loewe-v1.png" }],
  gamertag_canvas: { width_in: 3.5, height_in: 0.75, anchor_y_in: 0.375, text_height_cm: 1.27, max_width_cm: 8.89, height_per_text: 1.5,
    limits: { min_text_height_cm: 0.25, max_text_height_cm: 5.08, min_width_cm: 1.27, max_width_cm: 30.48 } },
  pricing: { general_markup_cents: 300, product_markup_cents: null, effective_markup_cents: 300, source: "general", member_markup_cents: 0 },
  check: { items: [], review_ready: false, publish_ready: false },
  sync: null, transitions: ["archived"], editable: true,
  limits: { max_variants: 80, max_placements: 12, max_layers: 6, min_width_cm: 1, max_offset_cm: 300 },
};

async function mockApi(page, seen) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({ essential: true, external_media: false, analytics: false, meta: false, tiktok: false, saved_at: Date.now(), expires_at: 4102444800000 }));
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const png = (data) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(data, "base64") });
    if (url.pathname.includes("/print-templates/")) {
      seen.push(url.pathname + url.search);
      return png(url.searchParams.get("tint") === "0c0c0c" ? DARK : LIGHT);
    }
    if (url.pathname.endsWith("/name-sample")) {
      seen.push(url.pathname + url.search);
      return png(NAME);
    }
    if (url.pathname.startsWith("/api/shop/print-files/")) return png(NAME);
    if (url.pathname.endsWith("/layout/preview")) return json({ placements: VIEW.placements.map((row) => ({ key: row.key, files: row.files })) });
    if (request.method() !== "GET") return json(VIEW);
    if (url.pathname === "/api/auth/me") return json(FINANCE);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/shop/products/p1") return json(VIEW);
    const list = /notifications|games$|nav$|site-banners|sponsors|partners/.test(url.pathname);
    return json(list ? [] : {});
  });
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`${label} (${width} px)`, () => {
    test.beforeEach(async ({ isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
    });

    test("Schritt 3: Shirt in der gewählten Farbe, deutsch, Gamertag in echter Größe, kein Grauschleier", async ({ page }, testInfo) => {
      const seen = [];
      await page.setViewportSize({ width, height });
      await mockApi(page, seen);
      await page.goto("/admin/shop/products/p1");
      await page.getByTestId("shop-step-designs").click();
      const preview = page.getByTestId("shop-preview-front");
      await expect(preview).toBeVisible({ timeout: 20000 });
      await expect(preview).toHaveAttribute("data-tinted", "true");
      await expect(preview.locator("img[src*='tint=0c0c0c']")).toHaveCount(1);
      await expect(page.getByTestId("shop-preview-color-Black")).toHaveText(/Schwarz/);
      await expect(page.getByTestId("shop-area-front")).toContainText("Vorderseite");
      // Der Gamertag: Beispielname vom Server, Rahmen so breit wie die Höchstbreite (3,5 Zoll von 12 Zoll).
      const name = page.getByTestId("shop-preview-front-layer-1");
      await expect(page.getByTestId("shop-preview-front-layer-1-sample")).toBeVisible();
      const area = await page.getByTestId("shop-preview-front-area").boundingBox();
      const nameBox = await name.boundingBox();
      expect(nameBox.width / area.width).toBeCloseTo(3.5 / 12, 1);
      // Kleinere Höchstbreite je Ebene: der Rahmen wird schmaler, der Beispielname kommt mit derselben Größe.
      await page.getByTestId("shop-layer-front-1-max-width").fill("5");
      await expect(page.getByTestId("shop-preview-front-layer-1-sample")).toHaveAttribute("src", /max_width_cm=5/);
      const smaller = await name.boundingBox();
      expect(smaller.width / area.width).toBeCloseTo((5 / 2.54) / 12, 1);
      // Ungespeichert: das Shirt bleibt voll deckend - nur Ebenen dürfen gedimmt sein.
      expect(await preview.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
      // Weiß gewählt: die eingefärbte Vorlage in Weiß.
      await page.getByTestId("shop-preview-color-White").click();
      await expect(preview.locator("img[src*='tint=ffffff']")).toHaveCount(1);
      expect(seen.some((path) => path.includes("tint=ffffff"))).toBe(true);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow, "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
      await page.getByTestId("shop-preview-color-Black").click();
      const shot = testInfo.outputPath(`schritt3-${label}.png`);
      await page.getByTestId("shop-area-front").screenshot({ path: shot });
      await testInfo.attach(`schritt3-${label}.png`, { path: shot, contentType: "image/png" });
    });
  });
}
