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

// Allover (#2141): die Rückseite als fertige Datei mit Hintergrund (synthetisch dunkel), Rückenmotiv und Gamertag als
// Ebenen darüber, die Fassung aus dem Hintergrund.
const SURFACE = { variant: "dark", source: "background", luminance: 0.01, text: "Fassung: dunkel (aus Hintergrund)" };
const ALLOVER = {
  ...VIEW,
  name_inks: [{ key: "vereinsblau", label: "Vereinsblau", hex: "#29B6E8" }, { key: "reinweiss", label: "Weiß", hex: "#FFFFFF" }],
  labels: { ...LABELS, modes: { layout: "Motiv und Position", upload: "Fertige Druckdatei als Hintergrund" },
    mode_hints: { layout: "Die Website erzeugt die Druckdatei.", upload: "Für Allover (etwa ein Trikot): je Farbe eine fertige Datei der ganzen Fläche als Hintergrund." },
    surfaces: { garment: "wie Printful-Farbe", light: "hell", dark: "dunkel" }, layer_variants: { auto: "automatisch", light: "hell", dark: "dunkel" } },
  placements: [{ key: "front", label: "Vorderseite", mode: "upload", printful_placement: "front", included: true, surcharge_cents: null, motifs_hidden: false,
    layers: [
      { kind: "motif", preset: "chest_right", width_cm: 8.9, offset_x_cm: 0, offset_y_cm: 0, motif: { key: "loewe", by_color: {} } },
      { kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0 },
    ],
    files: ["Black", "White"].map((color) => ({ placement: "front", color, color_label: color === "Black" ? "Schwarz" : "Weiß", group: "all", state: "ok", detail: "",
      file: { id: `c-${color}`, version: 3, warnings: [] }, background: { id: `bg-${color}`, version: 2 },
      plan: { layers: [
        { index: 0, kind: "motif", source: { design_key: "loewe", variant: "dark", version: 1 }, image_path: "/api/shop/print-files/k1/loewe-v1.png", aspect: 1, surface: SURFACE },
        { index: 1, kind: "gamertag", surface: SURFACE, ink: { key: "vereinsblau", label: "Vereinsblau", hex: "#29B6E8" } },
      ] } })) }],
};

// Trikot (#2142): die Rückseite eines Allover-Trikots (synthetischer dunkler Hintergrund) - die Vorlage „Trikot Rücken“
// setzt Name, große Nummer und Vereinsname untereinander, mittig, in der Sportschrift.
const SPORT = "saira-condensed-900";
const BACK_FILE = { ...AREA_FILE, width_px: 4950, height_px: 6750, width_in: 33, height_in: 45, width_cm: 83.82, height_cm: 114.3 };
const JERSEY = {
  ...ALLOVER,
  product: { ...VIEW.product, personalization: "both" },
  labels: { ...ALLOVER.labels, kinds: { ...LABELS.kinds, text: "Fester Text (in der Grunddatei, etwa der Vereinsname)" } },
  placements: [],
  available_placements: [
    { key: "back", label: "Rückseite", label_translated: true, family: "back", family_label: "Rückseite", technique: "dtfilm", safe_margin_cm: 0,
      file: BACK_FILE, groups: [BACK_FILE], preview: null, preview_by_color: {},
      presets: { motif: [], text: ["jersey_back_name", "jersey_back_number", "jersey_back_club"] } },
  ],
  included_placement: "back",
  presets: [
    { key: "jersey_back_name", label: "Trikot Rücken: Name oben", hint: "", kind: "text", families: ["back"], follow: null, center_x: 0.5, anchor: "top", top_cm: 8 },
    { key: "jersey_back_number", label: "Trikot Rücken: Nummer darunter", hint: "", kind: "text", families: ["back"], follow: "stack", gap_cm: 2, center_x: 0.5, anchor: "top", top_cm: 0 },
    { key: "jersey_back_club", label: "Trikot Rücken: Vereinsname unten", hint: "", kind: "text", families: ["back"], follow: null, center_x: 0.5, anchor: "bottom", top_cm: 8 },
  ],
  preset_rules: { safe_margin_cm: { back: 0 }, min_dpi_ratio: 0.66, warn_dpi_ratio: 1, min_width_cm: 1 },
  gamertag_canvas: { ...VIEW.gamertag_canvas, font: "rajdhani-700",
    font_metrics: { "rajdhani-700": { name: 1.5, number: 1.02, band_name: 1, band_number: 1 }, [SPORT]: { name: 2.3, number: 1.05, band_name: 1, band_number: 1.01 } },
    limits: { min_text_height_cm: 0.25, min_width_cm: 1.27, min_outline_cm: 0.05, max_outline_cm: 2 } },
  fonts: [{ key: "rajdhani-700", label: "Rajdhani Bold" }, { key: SPORT, label: "Saira Condensed Black – Sport- und Blockschrift für Trikots" }],
  print_sets: [{ key: "jersey_back", label: "Trikot Rücken", hint: "Name oben, Nummer darunter, Vereinsname unten.", families: ["back"], skipped: [],
    layers: [
      { kind: "gamertag", preset: "jersey_back_name", text_height_cm: 7, min_text_height_cm: 2.4, max_width_cm: 45, font: SPORT },
      { kind: "member_number", preset: "jersey_back_number", text_height_cm: 20, min_text_height_cm: 10, max_width_cm: 40, font: SPORT },
      { kind: "text", preset: "jersey_back_club", text: "TESTVEREIN", text_height_cm: 3.5, min_text_height_cm: 1.75, max_width_cm: 45, font: SPORT },
    ] }],
};
async function mockApi(page, seen, data = VIEW) {
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
    if (url.pathname.startsWith("/api/admin/shop/products/p1/print-files/") && url.searchParams.get("thumb")) {
      seen.push(url.pathname + url.search);
      return png(DARK);
    }
    if (url.pathname.startsWith("/api/shop/print-files/")) return png(NAME);
    if (url.pathname.endsWith("/layout/preview")) return json({ placements: data.placements.map((row) => ({ key: row.key, files: row.files })) });
    if (request.method() !== "GET") return json(data);
    if (url.pathname === "/api/auth/me") return json(FINANCE);
    if (url.pathname === "/api/settings/public") return json({ club_name: "THE LION SQUAD", domain: "lionsquad.at" });
    if (url.pathname === "/api/admin/shop/products/p1") return json(data);
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

    test("Allover: Hintergrund unter den Ebenen, Fassung aus dem Hintergrund, Blockiermeldung springt zur Fläche (#2141)", async ({ page }, testInfo) => {
      const seen = [];
      await page.setViewportSize({ width, height });
      await mockApi(page, seen, ALLOVER);
      await page.goto("/admin/shop/products/p1");
      await page.getByTestId("shop-step-designs").click();
      const area = page.getByTestId("shop-preview-front-area");
      await expect(area).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("shop-area-mode-front-upload")).toHaveText("Fertige Druckdatei als Hintergrund");
      await expect(page.getByTestId("shop-area-mode-hint-front")).toContainText("Für Allover");
      // Der Hintergrund der Vorschau-Farbe füllt genau die Druckfläche - darüber Motiv und Gamertag.
      const backdrop = page.getByTestId("shop-preview-front-backdrop");
      await expect(backdrop).toHaveAttribute("src", /print-files\/bg-Black\?thumb=1/);
      await expect.poll(() => backdrop.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);
      const [areaBox, backBox] = [await area.boundingBox(), await backdrop.boundingBox()];
      expect(Math.abs(areaBox.x - backBox.x) + Math.abs(areaBox.width - backBox.width)).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("shop-preview-front-layer-0").locator("img")).toBeVisible();
      await expect(page.getByTestId("shop-layer-front-0-surface")).toHaveText("Fassung: dunkel (aus Hintergrund)");
      // Textebenen zeigen nur die Farbe samt Herkunft - die Fassung gehört zu den Motiven (#2142).
      await expect(page.getByTestId("shop-layer-front-1-surface")).toHaveText("Farbe: Vereinsblau (aus Hintergrund)");
      await expect(page.getByTestId("shop-layer-front-1-variant")).toHaveCount(0);
      await expect(page.getByTestId("shop-preview-front-layer-1-sample")).toHaveAttribute("src", /ink=vereinsblau/);
      await page.getByTestId("shop-preview-color-White").click();
      await expect(backdrop).toHaveAttribute("src", /print-files\/bg-White\?thumb=1/);
      expect(seen.some((path) => path.includes("bg-White"))).toBe(true);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow, "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
      // Auch innen nichts abgeschnitten: Hochladen, Ebenen-Knöpfe und die Fassung bleiben in der Karte.
      const card = await page.getByTestId("shop-area-front").boundingBox();
      for (const id of ["shop-upload-front-Black-submit", "shop-layer-front-0-remove", "shop-layer-front-0-variant", "shop-layer-front-1-ink"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box.x + box.width, id).toBeLessThanOrEqual(card.x + card.width + 1);
      }
      await expect(page.getByTestId("shop-file-front-Black-background")).toHaveText(/Hintergrund v2/);
      // Farbe des Namens fest gewählt: der Beispielname kommt in dieser Farbe.
      await page.getByTestId("shop-layer-front-1-ink").selectOption("reinweiss");
      await expect(page.getByTestId("shop-preview-front-layer-1-sample")).toHaveAttribute("src", /ink=reinweiss/);
      const shot = testInfo.outputPath(`allover-${label}.png`);
      await page.getByTestId("shop-area-front").screenshot({ path: shot });
      await testInfo.attach(`allover-${label}.png`, { path: shot, contentType: "image/png" });
      // Auf „Motiv und Position“ ohne Ebene: die Meldung nennt die Fläche, der Knopf springt hin.
      for (let index = 1; index >= 0; index -= 1) await page.getByTestId(`shop-layer-front-${index}-remove`).click();
      await page.getByTestId("shop-area-mode-front-layout").click();
      await expect(page.getByTestId("shop-layout-blocked-areas")).toContainText("„Vorderseite“");
      await page.getByTestId("shop-step-designs").scrollIntoViewIfNeeded();
      await page.getByTestId("shop-layout-jump-front").click();
      await expect(page.getByTestId("shop-area-use-front")).toBeFocused();
      await expect(page.getByTestId("shop-area-front")).toBeInViewport();
    });

    test("Trikot Rücken mit einem Klick: Name, große Nummer, Vereinsname untereinander und mittig (#2142)", async ({ page }, testInfo) => {
      const seen = [];
      await page.setViewportSize({ width, height });
      await mockApi(page, seen, JERSEY);
      await page.goto("/admin/shop/products/p1");
      await page.getByTestId("shop-step-designs").click();
      await page.getByTestId("shop-area-use-back").click();
      await page.getByTestId("shop-area-set-back-jersey_back").click();
      await expect(page.getByTestId("shop-area-set-notice-back")).toContainText("Vorlage „Trikot Rücken“ gesetzt: 3 Ebenen");
      const boxes = [];
      for (const index of [0, 1, 2]) {
        await expect(page.getByTestId(`shop-preview-back-layer-${index}-sample`)).toBeVisible();
        boxes.push(await page.getByTestId(`shop-preview-back-layer-${index}`).boundingBox());
      }
      const area = await page.getByTestId("shop-preview-back-area").boundingBox();
      // Untereinander, mittig und ganz in der Fläche.
      expect(boxes[0].y).toBeLessThan(boxes[1].y);
      expect(boxes[1].y + boxes[1].height).toBeLessThan(boxes[2].y + boxes[2].height);
      for (const box of boxes) {
        expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(2);
        expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height + 1);
      }
      await expect(page.getByTestId("shop-layer-back-1-gap-now")).toContainText("jetzt 2 cm");
      await expect(page.getByTestId("shop-layer-back-1-size-hint")).toContainText("Höchstbreite bis 83,8 cm");
      await expect(page.getByTestId("shop-preview-back-layer-1-sample")).toHaveAttribute("src", /kind=member_number.*placement=back.*text_height_cm=20.*min_text_height_cm=10.*font=saira-condensed-900/);
      await expect(page.getByTestId("shop-layer-back-0-min-height")).toHaveValue("2,4");
      await expect(page.getByTestId("shop-preview-back-layer-1-sample")).toHaveCSS("object-fit", "contain");
      await expect(page.getByTestId("shop-preview-back-layer-2-sample")).toHaveAttribute("src", /kind=text.*text=TESTVEREIN/);
      // Kontur an der Nummer, fester Text geändert - die Beispiele kommen so vom Server.
      await page.getByTestId("shop-layer-back-1-outline").fill("0,4");
      await expect(page.getByTestId("shop-preview-back-layer-1-sample")).toHaveAttribute("src", /outline_cm=0.4/);
      await page.getByTestId("shop-layer-back-2-text").fill("TESTVEREIN LÖWEN");
      await expect(page.getByTestId("shop-preview-back-layer-2-sample")).toHaveAttribute("src", /text=TESTVEREIN\+L%C3%96WEN/);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow, "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
      const card = await page.getByTestId("shop-area-back").boundingBox();
      for (const id of ["shop-layer-back-1-font", "shop-layer-back-1-outline-ink", "shop-layer-back-1-gap-set", "shop-layer-back-2-center", "shop-area-add-text-back"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box.x + box.width, id).toBeLessThanOrEqual(card.x + card.width + 1);
      }
      expect(seen.some((path) => path.includes("kind=text"))).toBe(true);
      const shot = testInfo.outputPath(`trikot-${label}.png`);
      await page.getByTestId("shop-area-back").screenshot({ path: shot });
      await testInfo.attach(`trikot-${label}.png`, { path: shot, contentType: "image/png" });
    });
  });
}

// ---------------------------------------------------------------- Präzise setzen (#2117)
// Ziehen mit Einrasten und Hilfslinien (Alt oder Strg = frei), Zahleneingabe mit Komma und „Groß bearbeiten“ mit Zoom - bei 390
// und 1440 px im Desktop-Projekt (Maus) und im Handy-Projekt per Touch. Nur synthetische Bilder.

const cmValue = (text) => Number(String(text).replace(",", "."));

async function openDesigns(page, seen = []) {
  await page.addInitScript(() => window.localStorage.removeItem("tls_shop_place_v1"));
  await mockApi(page, seen);
  await page.goto("/admin/shop/products/p1");
  await page.getByTestId("shop-step-designs").click();
  const area = page.getByTestId("shop-preview-front-area");
  await expect(area).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("shop-layer-front-0-top")).toHaveValue("5");
  await page.getByTestId("shop-preview-front").scrollIntoViewIfNeeded();
  return area;
}

// Der Löwe wird oben im Rahmen gegriffen - in der Mitte läge später der Name darüber (er folgt dem Löwen).
async function grip(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.2 };
}

async function noSideScroll(page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  expect(overflow, "kein seitliches Scrollen der Seite").toBeLessThanOrEqual(1);
}

for (const [label, width, height] of WIDTHS) {
  test.describe(`Präzise setzen ${label} (${width} px)`, () => {
    test.beforeEach(async ({ isMobile }) => {
      test.skip(isMobile, "nur im Desktop-Projekt - die Breite wird hier selbst gesetzt");
    });

    test("Ziehen rastet an der Mitte ein, Alt zieht frei, Zahlen mit Komma, Groß bearbeiten mit Zoom (#2117)", async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      const area = await openDesigns(page);
      const lion = page.getByTestId("shop-preview-front-layer-0");
      await expect(page.getByTestId("shop-preview-front-help")).toContainText("Ziehen rastet ein (Alt oder Strg = frei)");
      // 1. Ziehen bis knapp neben die Mitte: rastet ein, die Hilfslinie und die Live-Anzeige in cm sind da.
      const areaBox = await area.boundingBox();
      const lionBox = await lion.boundingBox();
      const from = await grip(lion);
      const toX = from.x + (areaBox.x + areaBox.width / 2 - (lionBox.x + lionBox.width / 2)) + 2;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + toX) / 2, from.y + 6, { steps: 4 });
      await page.mouse.move(toX, from.y + 6, { steps: 4 });
      await expect(page.getByTestId("shop-preview-front-guide-x")).toBeVisible();
      await expect(page.getByTestId("shop-preview-front-guide-x")).toHaveAttribute("data-kind", "center");
      await expect(page.getByTestId("shop-preview-front-live")).toContainText("Mitte 0 cm");
      await expect(lion).toHaveAttribute("data-dragging", "true");
      const shot = testInfo.outputPath(`einrasten-${label}.png`);
      await page.getByTestId("shop-preview-front").screenshot({ path: shot });
      await testInfo.attach(`einrasten-${label}.png`, { path: shot, contentType: "image/png" });
      await page.mouse.up();
      await expect(page.getByTestId("shop-preview-front-guide-x")).toHaveCount(0);
      await expect(page.getByTestId("shop-preview-front-live")).toHaveCount(0);
      await expect(page.getByTestId("shop-layer-front-0-x")).toHaveValue("0");
      // Senkrecht aufs 0,5-cm-Raster.
      const top = cmValue(await page.getByTestId("shop-layer-front-0-top").inputValue());
      expect(Math.abs(top * 2 - Math.round(top * 2))).toBeLessThan(0.011);
      const centered = await lion.boundingBox();
      expect(Math.abs(centered.x + centered.width / 2 - (areaBox.x + areaBox.width / 2))).toBeLessThanOrEqual(1);
      // 2. Mit Alt: frei, ohne Hilfslinie.
      // Das Loslassen von Alt nach dem Ziehen wird abgefangen (Firefox öffnete sonst die Menüleiste).
      await page.evaluate(() => {
        window.__altUps = [];
        window.addEventListener("keyup", (event) => { if (event.key === "Alt") window.__altUps.push(event.defaultPrevented); });
      });
      const again = await grip(lion);
      await page.mouse.move(again.x, again.y);
      await page.mouse.down();
      await page.keyboard.down("Alt");
      await page.mouse.move(again.x + 4, again.y, { steps: 2 });
      await page.mouse.move(again.x + 7, again.y, { steps: 2 });
      await expect(page.getByTestId("shop-preview-front-live")).toBeVisible();
      await expect(page.getByTestId("shop-preview-front-guide-x")).toHaveCount(0);
      await page.mouse.up();
      await page.keyboard.up("Alt");
      expect(await page.evaluate(() => window.__altUps)).toEqual([true]);
      const free = cmValue(await page.getByTestId("shop-layer-front-0-x").inputValue());
      expect(free).toBeGreaterThan(0.5);
      expect(free).toBeLessThan(3);
      // Strg zieht ebenso frei - ohne Hilfslinie, nicht aufs Raster.
      const ctrl = await grip(lion);
      await page.mouse.move(ctrl.x, ctrl.y);
      await page.mouse.down();
      await page.keyboard.down("Control");
      await page.mouse.move(ctrl.x + 3, ctrl.y, { steps: 2 });
      await page.mouse.move(ctrl.x + 5, ctrl.y, { steps: 2 });
      await expect(page.getByTestId("shop-preview-front-guide-x")).toHaveCount(0);
      await page.mouse.up();
      await page.keyboard.up("Control");
      expect(cmValue(await page.getByTestId("shop-layer-front-0-x").inputValue())).toBeGreaterThan(free + 0.5);
      // Bei normalem Ziehen bleibt Alt frei für das System.
      await page.evaluate(() => { window.__altUps = []; });
      await page.keyboard.press("Alt");
      expect(await page.evaluate(() => window.__altUps)).toEqual([false]);
      // 3. Zahl mit Komma: die Oberkante liegt genau dort.
      await page.getByTestId("shop-layer-front-0-top").fill("12,5");
      await expect(page.getByTestId("shop-layer-front-0-top")).toHaveValue("12,5");
      await page.getByTestId("shop-layer-front-0-x").fill("-6");
      await expect(page.getByTestId("shop-layer-front-0-offset")).toContainText("Feinjustiert");
      await page.getByTestId("shop-preview-front").scrollIntoViewIfNeeded();
      const [placed, nowArea] = [await lion.boundingBox(), await area.boundingBox()];
      expect(placed.y - nowArea.y).toBeCloseTo((12.5 / 40.64) * areaBox.height, 0);
      expect(placed.x + placed.width / 2 - (nowArea.x + nowArea.width / 2)).toBeCloseTo((-6 / 30.48) * areaBox.width, 0);
      await noSideScroll(page);
      // 4. Groß bearbeiten: nur die Fläche, fast bildschirmfüllend; Mausrad zoomt, Ziehen wird feiner.
      await page.getByTestId("shop-preview-front-big").click();
      const big = page.getByTestId("shop-big-front");
      await expect(big).toBeVisible();
      const canvas = page.getByTestId("shop-big-front-canvas");
      const before = await canvas.boundingBox();
      expect(before.width).toBeGreaterThan(areaBox.width * 1.5);
      await expect(big.locator("img[src*='print-templates']")).toHaveCount(0);
      const bigLion = page.getByTestId("shop-big-front-layer-0");
      const lionCenter = await bigLion.boundingBox();
      await page.mouse.move(lionCenter.x + lionCenter.width / 2, lionCenter.y + lionCenter.height / 2);
      await page.mouse.wheel(0, -200);
      await expect(page.getByTestId("shop-big-front-zoom")).not.toHaveText("100 %");
      const zoomed = await canvas.boundingBox();
      expect(zoomed.width).toBeGreaterThan(before.width * 1.2);
      // Gleich viele Pixel, weniger cm: 10 px frei gezogen sind im großen Fenster feiner als in der kleinen Vorschau.
      const startX = cmValue(await page.getByTestId("shop-layer-front-0-x").inputValue());
      const hold = await grip(bigLion);
      await page.mouse.move(hold.x, hold.y);
      await page.mouse.down();
      await page.keyboard.down("Alt");
      await page.mouse.move(hold.x + 5, hold.y, { steps: 2 });
      await page.mouse.move(hold.x + 10, hold.y, { steps: 2 });
      await expect(page.getByTestId("shop-big-front-live")).toBeVisible();
      await page.mouse.up();
      await page.keyboard.up("Alt");
      const moved = cmValue(await page.getByTestId("shop-layer-front-0-x").inputValue()) - startX;
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan((10 / areaBox.width) * 30.48 * 0.85);
      await expect(page.getByTestId("shop-big-front-field-top")).toHaveValue("12,5");
      await page.getByTestId("shop-big-front-zoom-in").click();
      await page.getByTestId("shop-big-front-fit").click();
      await expect(page.getByTestId("shop-big-front-zoom")).toHaveText("100 %");
      const bigShot = testInfo.outputPath(`gross-${label}.png`);
      await page.screenshot({ path: bigShot });
      await testInfo.attach(`gross-${label}.png`, { path: bigShot, contentType: "image/png" });
      await noSideScroll(page);
      await page.keyboard.press("Escape");
      await expect(big).toHaveCount(0);
      await noSideScroll(page);
    });
  });
}

test.describe("Präzise setzen am Handy (Touch)", () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(!isMobile, "nur im Handy-Projekt");
  });

  test("Ziehen per Finger rastet ein, die Zahlen sind der Hauptweg, kein seitliches Scrollen (#2117)", async ({ page }, testInfo) => {
    const area = await openDesigns(page);
    const lion = page.getByTestId("shop-preview-front-layer-0");
    const areaBox = await area.boundingBox();
    const lionBox = await lion.boundingBox();
    const from = await grip(lion);
    const toX = from.x + (areaBox.x + areaBox.width / 2 - (lionBox.x + lionBox.width / 2)) + 2;
    const client = await page.context().newCDPSession(page);
    const touch = (type, x, y) => client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", from.x, from.y);
    for (let step = 1; step <= 6; step += 1) await touch("touchMove", from.x + ((toX - from.x) * step) / 6, from.y + step);
    await expect(page.getByTestId("shop-preview-front-guide-x")).toBeVisible();
    await touch("touchEnd");
    await expect(page.getByTestId("shop-layer-front-0-x")).toHaveValue("0");
    // Zahlen: mit − und + und Komma.
    await page.getByTestId("shop-layer-front-0-top-plus").tap();
    const top = page.getByTestId("shop-layer-front-0-top");
    const now = cmValue(await top.inputValue());
    await top.fill("8,5");
    await expect(top).toHaveValue("8,5");
    expect(now).toBeGreaterThan(0);
    const card = await page.getByTestId("shop-area-front").boundingBox();
    for (const id of ["shop-layer-front-0-top-plus", "shop-layer-front-0-x-plus", "shop-layer-front-0-mirror", "shop-layer-front-1-align-opposite", "shop-preview-front-settings-snap"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box.x + box.width, id).toBeLessThanOrEqual(card.x + card.width + 1);
    }
    await noSideScroll(page);
    await page.getByTestId("shop-preview-front-big").tap();
    const canvas = page.getByTestId("shop-big-front-canvas");
    await expect(canvas).toBeVisible();
    expect((await canvas.boundingBox()).width).toBeGreaterThan(areaBox.width);
    await noSideScroll(page);
    const shot = testInfo.outputPath("gross-handy-touch.png");
    await page.screenshot({ path: shot });
    await testInfo.attach("gross-handy-touch.png", { path: shot, contentType: "image/png" });
  });
});
