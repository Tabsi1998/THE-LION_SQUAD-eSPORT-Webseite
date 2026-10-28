import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Produktverwaltung (#1707) mit Katalogabgleich (#1709): Liste und Anlegen, geführte Schritte, Farben und Größen,
// Druckflächen mit Motiv, Vorgabe und Größe (#2069), Preise mit Warnung, Prüfen und Veröffentlichen - jede Änderung nur mit Grund.
// Erfundene Daten: Produkt- und Variantennummern, Designs und Personen gibt es so nicht.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() };
const uploadApiMock = { post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  uploadApi: uploadApiMock,
  resolveMediaUrl: (url) => url,
  formatRequestError: (failure, fallback) => failure?.response?.data?.detail || fallback,
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminShopProductsPage, inches } = await import("./AdminShopProductsPage");

const LABELS = {
  statuses: { draft: "Entwurf", reviewed: "geprüft", active: "veröffentlicht", archived: "archiviert" },
  visibilities: { public: "öffentlich (mit Konto)", members: "nur Mitglieder", hidden: "nur intern" },
  personalizations: { none: "keine", gamertag: "Gamertag", member_number: "Vereinsnummer", both: "Gamertag und Vereinsnummer" },
  kinds: { motif: "Motiv", gamertag: "Gamertag (Datei je Bestellung)", member_number: "Vereinsnummer (Datei je Bestellung, #1727)" },
  modes: { layout: "Motiv und Position", upload: "Fertige Druckdatei (für Profis)" },
};

const AREA_FILE = { group: "all", variant_ids: null, width_px: 1800, height_px: 2400, dpi: 150, width_in: 12, height_in: 16, width_cm: 30.48, height_cm: 40.64, aspect_ok: true };
const PRESETS = [
  { key: "chest_right", label: "Brust rechts (vom Träger aus)", hint: "Von vorne gesehen links.", kind: "motif", families: ["front"], center_x: 0.27, anchor: "top", top_cm: 5, width_cm: 8.9 },
  { key: "front_large", label: "Vorne groß", hint: "", kind: "motif", families: ["front"], center_x: 0.5, anchor: "top", top_cm: 2.5, width_cm: 28 },
  { key: "back_large", label: "Rücken groß", hint: "", kind: "motif", families: ["back"], center_x: 0.5, anchor: "top", top_cm: 5, width_cm: 28 },
  { key: "text_opposite", label: "Brust gegenüber dem Motiv", hint: "Gespiegelt zum ersten Motiv.", kind: "text", families: ["front"], follow: "opposite", center_x: 0.5, anchor: "top", top_cm: 0 },
  { key: "text_center", label: "Mittig (Name)", hint: "", kind: "text", families: ["front", "back"], follow: null, center_x: 0.5, anchor: "middle", top_cm: 0 },
];

function variant(label, sku, overrides = {}) {
  const [color, size] = label.split(" / ");
  return {
    id: `v-${sku}`, sku, label, color, size, color_code: color === "Black" ? "#0c0c0c" : "#ffffff", active: true,
    blocked_reason: null, printful_variant_id: 4000 + sku.length, availability: "in stock", in_stock: true,
    base_cost_cents: 975, placement_costs: { front: 525, back: 525 }, cost_cents: 1500, price_cents: 1500,
    public_price_cents: 1800, suggested_public_cents: 1800, price_warning: null, synced_at: "2026-10-27T05:20:00+00:00", ...overrides,
  };
}

function checkItems(overrides = {}) {
  const base = [
    ["printful", "Printful-Produkt"], ["offer", "Farben und Größen"], ["personalization", "Sichtbarkeit und Personalisierung"],
    ["placements", "Platzierungen"], ["files", "Druckdateien je Farbe"], ["stock", "Lieferbar"], ["prices", "Preis berechnet und übernommen"],
  ].map(([key, label]) => ({ key, label, ok: true, state: "ok", detail: `${label} passt.`, for_review: true, ...(overrides[key] || {}) }));
  return [...base, { key: "mockup", label: "Mockup-Prüfung", ok: false, state: "open", detail: "Offen: die Mockup-Prüfung kommt mit #1710.", for_review: false }];
}

function view(overrides = {}) {
  const items = overrides.items || checkItems();
  return {
    product: {
      id: "p1", slug: "vereinsshirt-test", title: "Vereinsshirt Test", description: null, status: "draft", visibility: "members",
      personalization: "gamertag", markup_cents: null, technique: "dtg", offer: { colors: ["Black", "White"], sizes: ["M", "L"] },
      printful: {
        product_id: 71, name: "Unisex Testshirt | Gildan 5000", techniques: ["dtg"], default_technique: "dtg", is_discontinued: false,
        loaded_at: "2026-10-27T08:00:00+00:00", sizes: ["M", "L", "XL"],
        colors: [{ name: "Black", code: "#0c0c0c" }, { name: "White", code: "#ffffff" }, { name: "Navy", code: "#1d2335" }],
        placements: [{ placement: "front", technique: "dtg", width_in: 12, height_in: 16 }, { placement: "back", technique: "dtg", width_in: 12, height_in: 16 }],
        variants: ["Black", "White", "Navy"].flatMap((color) => ["M", "L", "XL"].map((size, index) => ({ id: index, color, size }))),
      },
      ...overrides.product,
    },
    labels: LABELS,
    variants: overrides.variants || [variant("Black / M", "PF1"), variant("Black / L", "PF2"), variant("White / M", "PF3"), variant("White / L", "PF4")],
    placements: overrides.placements || [
      { key: "front", label: "Vorderseite", mode: "layout", printful_placement: "front", included: true, surcharge_cents: 525,
        layers: [
          { kind: "motif", preset: "chest_right", width_cm: 8.9, offset_x_cm: 0, offset_y_cm: 0, motif: { key: "loewe-weiss", by_color: {} } },
          { kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0 },
        ],
        files: [
          { placement: "front", color: "Black", group: "all", state: "ok", detail: "", file: { id: "f1", version: 1, warnings: [] },
            plan: { layers: [{ index: 0, kind: "motif", source: { design_key: "loewe-weiss", variant: "dark", version: 1 }, image_path: "/api/shop/print-files/k1/loewe-weiss-v1.png", aspect: 1 }] } },
          { placement: "front", color: "White", group: "all", state: "outdated", detail: "Aufbau, Motiv oder Vorlage geändert - neu erzeugen.", file: { id: "f2", version: 1, warnings: [] },
            plan: { layers: [{ index: 0, kind: "motif", source: { design_key: "loewe-weiss", variant: "light", version: 2 }, image_path: "/api/shop/print-files/k3/loewe-weiss-v2.png", aspect: 1 }] } },
        ] },
    ],
    available_placements: [
      { key: "front", label: "Vorderseite", family: "front", family_label: "Vorderseite", technique: "dtg", safe_margin_cm: 0,
        file: AREA_FILE, groups: [AREA_FILE],
        preview: { image_path: "/api/admin/shop/print-templates/71/images/0", background_path: null, background_color: null, positioning: "overlay",
          template_width: 1000, template_height: 1000, area: { left: 275, top: 200, width: 450, height: 600 }, orientation: "any" },
        presets: { motif: ["chest_right", "front_large"], text: ["text_opposite", "text_center"] } },
      { key: "back", label: "Rückseite", family: "back", family_label: "Rückseite", technique: "dtg", safe_margin_cm: 0,
        file: AREA_FILE, groups: [AREA_FILE], preview: null,
        presets: { motif: ["back_large"], text: ["text_center"] } },
    ],
    included_placement: "front",
    layout_converted: false,
    print_template: { printful_product_id: 71, checked_at: "2026-10-27T05:20:00+00:00", changed_at: null, changes: [], last_error: null, loaded: true },
    presets: PRESETS,
    preset_rules: { safe_margin_cm: { front: 0, back: 0, sleeve: 0, label: 0, other: 0 }, min_dpi_ratio: 0.66, warn_dpi_ratio: 1, min_width_cm: 1 },
    motif_options: [
      { key: "loewe-weiss", title: "Löwe weiß", width_px: 1200, height_px: 1200, image_path: "/api/shop/print-files/k1/loewe-weiss-v1.png" },
      { key: "loewe-schwarz", title: "Löwe schwarz", width_px: 1200, height_px: 1300, image_path: "/api/shop/print-files/k2/loewe-schwarz-v1.png" },
      { key: "ruecken-weiss", title: "Rücken weiß", width_px: 3000, height_px: 3000, image_path: null },
    ],
    gamertag_canvas: { width_in: 3.5, height_in: 0.75, anchor_y_in: 0.375 },
    pricing: { general_markup_cents: 300, product_markup_cents: null, effective_markup_cents: 300, source: "general", member_markup_cents: 0 },
    check: { items, review_ready: items.filter((item) => item.for_review).every((item) => item.ok), publish_ready: items.every((item) => item.ok) },
    sync: { at: "2026-10-27T05:20:00+00:00", ok: true, detail: "4 Varianten abgeglichen.", last_ok_at: "2026-10-27T05:20:00+00:00" },
    transitions: ["reviewed", "archived"],
    editable: true,
    limits: { max_variants: 80, max_placements: 12, max_layers: 6, min_width_cm: 1, max_offset_cm: 300 },
    ...overrides.extra,
  };
}

const LIST = {
  overview: [{ id: "p1", slug: "vereinsshirt-test", title: "Vereinsshirt Test", status: "reviewed", visibility: "members", personalization: "gamertag",
    printful_name: "Unisex Testshirt | Gildan 5000", variants: 4, blocked: 0, price_warnings: 1 }],
  labels: LABELS,
};

function show(path = "/admin/shop/products") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/shop/products" element={<AdminShopProductsPage />} />
        <Route path="/admin/shop/products/:productId" element={<AdminShopProductsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/admin/shop/products" ? LIST : view() }));
});

test("Maße stehen in Zoll und cm", () => {
  expect(inches(3.5)).toBe("3,5 Zoll (8,9 cm)");
  expect(inches(null)).toBe("–");
});

test("die Liste zeigt Stand, Printful und Warnungen; der Reiter Produkte ist aktiv", async () => {
  show();
  const row = await screen.findByTestId("shop-product-vereinsshirt-test");
  expect(row).toHaveTextContent("geprüft");
  expect(row).toHaveTextContent("Gildan 5000");
  expect(row).toHaveTextContent("4 Varianten");
  expect(within(row).getByTestId("shop-product-vereinsshirt-test-warnings")).toHaveTextContent("1 Preiswarnung");
  expect(screen.getByTestId("shop-tab-produkte")).toHaveAttribute("aria-current", "page");
});

test("ein neues Produkt braucht einen Titel, der Grund ist optional; öffentlich sperrt die Personalisierung", async () => {
  apiMock.post.mockResolvedValue({ data: { product: { id: "p2" } } });
  const user = userEvent.setup();
  show();
  await screen.findByTestId("shop-new");
  await user.click(screen.getByTestId("shop-new-personalization-gamertag"));
  await user.click(screen.getByTestId("shop-new-visibility-public"));
  expect(screen.getByTestId("shop-new-personalization-gamertag")).toBeDisabled();
  expect(screen.getByTestId("shop-new-personalization-none")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("shop-new-public-hint")).toBeInTheDocument();
  await user.click(screen.getByTestId("shop-new-visibility-members"));
  await user.click(screen.getByTestId("shop-new-personalization-gamertag"));
  const submit = screen.getByTestId("shop-new-submit");
  expect(screen.getByTestId("shop-new-reason")).toHaveAttribute("placeholder", "Grund (optional, kommt ins Protokoll)");
  // Der Knopf bleibt klickbar und sagt, was fehlt.
  expect(submit).toHaveAttribute("aria-disabled", "true");
  await user.click(submit);
  expect(screen.getByTestId("shop-new-hint")).toHaveTextContent("Titel");
  expect(apiMock.post).not.toHaveBeenCalled();
  await user.type(screen.getByTestId("shop-new-reason"), "Testshirt");
  await user.type(screen.getByTestId("shop-new-title"), "Vereinsshirt schwarz");
  await user.click(submit);
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products", {
    title: "Vereinsshirt schwarz", visibility: "members", personalization: "gamertag", reason: "Testshirt",
  });
  expect(await screen.findByTestId("shop-product-title")).toHaveTextContent("Vereinsshirt Test");
});

test("der Editor führt durch fünf Schritte und zeigt den Abgleich mit Datum", async () => {
  show("/admin/shop/products/p1");
  const steps = await screen.findByTestId("shop-steps");
  expect(within(steps).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "1.Produkt wählen", "2.Farben und Größen", "3.Druckflächen", "4.Preise", "5.Prüfen und veröffentlichen"]);
  expect(screen.getByTestId("shop-step-product")).toHaveAttribute("data-state", "ok");
  expect(screen.getByTestId("shop-step-publish")).toHaveAttribute("data-state", "open");
  expect(screen.getByTestId("shop-sync")).toHaveTextContent("4 Varianten abgeglichen.");
  expect(screen.getByTestId("shop-printful-loaded")).toHaveTextContent("Nr. 71");
  expect(screen.getByTestId("shop-printful-loaded")).toHaveTextContent("12 Zoll (30,5 cm) × 16 Zoll (40,6 cm)");
});

test("Printful-Nummer laden schickt die Zahl mit Grund", async () => {
  apiMock.post.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  const input = await screen.findByTestId("shop-printful-number");
  await user.clear(input);
  await user.type(input, "4a38");
  expect(input).toHaveValue("438");
  expect(screen.getByTestId("shop-printful-form")).toHaveTextContent("setzt Farben und Größen zurück");
  await user.type(screen.getByTestId("shop-printful-reason"), "Anderes Shirt");
  await user.click(screen.getByTestId("shop-printful-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/printful", { printful_product_id: 438, reason: "Anderes Shirt" });
});

test("Farben und Größen wählen zählt die Varianten und schickt Technik, Farben und Größen", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-offer"));
  expect(screen.getByTestId("shop-offer-count")).toHaveTextContent("4 Varianten");
  await user.click(screen.getByTestId("shop-offer-color-Navy"));
  await user.click(screen.getByTestId("shop-offer-size-L"));
  expect(screen.getByTestId("shop-offer-color-Navy")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-count")).toHaveTextContent("3 Varianten");
  await user.type(screen.getByTestId("shop-offer-reason"), "Navy dazu, L weg");
  await user.click(screen.getByTestId("shop-offer-submit"));
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/products/p1/offer", {
    technique: "dtg", colors: ["Black", "White", "Navy"], sizes: ["M"], reason: "Navy dazu, L weg",
    color_labels: { Black: "", White: "", Navy: "" },
  });
  expect(screen.getByTestId("shop-variant-PF1")).toHaveTextContent("lieferbar");
});

const STITCH_OPTIONS = {
  loaded: true, missing: [], skipped: [],
  options: [
    { name: "stitch_color", label: "Nahtfarbe", type: "string", techniques: ["cut-sew"], required: true, selected: "White",
      values: [{ value: "White", label: "Weiß" }, { value: "Black", label: "Schwarz" }] },
    { name: "inside_pocket", label: "Innentasche", type: "boolean", techniques: ["cut-sew"], required: false, selected: null,
      values: [{ value: true, label: "ja" }, { value: false, label: "nein" }] },
  ],
};

test("Produktoptionen (#2158): Nahtfarbe in Schritt 2 wählen - gesendet wird der Katalogwert", async () => {
  const withOptions = view({ extra: { product_options: STITCH_OPTIONS } });
  apiMock.get.mockResolvedValue({ data: withOptions });
  apiMock.put.mockResolvedValue({ data: withOptions });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-offer"));
  const select = screen.getByTestId("shop-offer-option-stitch_color");
  expect(screen.getByTestId("shop-offer-options")).toHaveTextContent("Nahtfarbe");
  expect(select).toHaveDisplayValue("Weiß");
  expect(screen.getByTestId("shop-offer-options-other")).toHaveTextContent("Innentasche");
  expect(screen.queryByTestId("shop-offer-option-inside_pocket")).toBeNull();
  await user.selectOptions(select, "Schwarz");
  await user.click(screen.getByTestId("shop-offer-submit"));
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/products/p1/offer", {
    technique: "dtg", colors: ["Black", "White"], sizes: ["M", "L"], color_labels: { Black: "", White: "" },
    product_options: { stitch_color: "Black" }, reason: "",
  });
});

test("Produktoptionen noch nicht geladen: Hinweis auf Schritt 1, ohne Auswahl", async () => {
  apiMock.get.mockResolvedValue({ data: view({ extra: { product_options: { loaded: false, options: [], missing: [], skipped: [] } } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-offer"));
  expect(screen.getByTestId("shop-offer-options-unknown")).toHaveTextContent("Schritt 1");
  expect(screen.queryByTestId("shop-offer-options")).toBeNull();
});

test("Farben heißen deutsch und lassen sich je Produkt anders benennen - der Printful-Name bleibt Schlüssel (#2105)", async () => {
  const german = view({
    product: { offer: { colors: ["Black", "White"], sizes: ["M", "L"], color_labels: { Black: "Tiefschwarz" } } },
    variants: [variant("Black / M", "PF1", { display_label: "Tiefschwarz / M" }), variant("White / M", "PF3", { display_label: "Weiß / M" })],
    extra: { color_labels: { Black: "Tiefschwarz", White: "Weiß", Navy: "Marineblau" }, color_defaults: { Black: "Schwarz", White: "Weiß", Navy: "Marineblau" } },
  });
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/admin/shop/products" ? LIST : german }));
  apiMock.put.mockResolvedValue({ data: german });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-offer"));
  expect(screen.getByTestId("shop-offer-color-Black")).toHaveTextContent("Tiefschwarz");
  expect(screen.getByTestId("shop-offer-color-Navy")).toHaveTextContent("Marineblau");
  expect(screen.getByTestId("shop-variant-PF1")).toHaveTextContent("Tiefschwarz / M");
  expect(screen.getByTestId("shop-offer-color-label-Black")).toHaveValue("Tiefschwarz");
  expect(screen.getByTestId("shop-offer-color-label-White")).toHaveAttribute("placeholder", "Weiß");
  await user.type(screen.getByTestId("shop-offer-color-label-White"), "Schneeweiß");
  await user.clear(screen.getByTestId("shop-offer-color-label-Black"));
  await user.click(screen.getByTestId("shop-offer-submit"));
  expect(apiMock.put.mock.calls[0][1].color_labels).toEqual({ Black: "", White: "Schneeweiß" });
  expect(apiMock.put.mock.calls[0][1].colors).toEqual(["Black", "White"]);
  // Schritt 3: Vorschau-Farben und Dateien je Farbe mit deutscher Bezeichnung.
  await user.click(screen.getByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-preview-color-Black")).toHaveTextContent("Tiefschwarz");
  expect(screen.getByTestId("shop-preview-color-White")).toHaveTextContent("Weiß");
});

test("Drucktechniken mit deutschem Namen und Erklärung, Vorgabe Direktdruck (#2091)", async () => {
  const many = view({ product: {
    technique: null, offer: null,
    printful: { ...view().product.printful, techniques: ["embroidery", "dtfilm", "dtg"], default_technique: null,
      placements: [{ placement: "front", technique: "dtg", width_in: 12, height_in: 16 }] },
  }, variants: [] });
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/admin/shop/products" ? LIST : many }));
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  expect(await screen.findByTestId("shop-printful-techniques")).toHaveTextContent("Stickerei, DTF-Transfer (DTFlex), DTG-Direktdruck");
  expect(screen.getByTestId("shop-printful-loaded")).toHaveTextContent("front (DTG-Direktdruck)");
  await user.click(screen.getByTestId("shop-step-offer"));
  expect(screen.getByTestId("shop-offer-technique-dtg")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("shop-offer-technique-dtfilm")).toHaveTextContent("DTF-Transfer (DTFlex)");
  expect(screen.getByTestId("shop-offer-technique-hint")).toHaveTextContent("ideal für helle Shirts");
  await user.click(screen.getByTestId("shop-offer-technique-embroidery"));
  expect(screen.getByTestId("shop-offer-technique-hint")).toHaveTextContent("nur kleine Flächen");
  expect(screen.getAllByText(/nur kleine Flächen/)).toHaveLength(1);
});

test("Abgleichen während einer ungespeicherten Auswahl lässt die Auswahl stehen - Schritt 2 (#2091)", async () => {
  apiMock.post.mockResolvedValue({ data: { ...view(), result: { ok: true } } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-offer"));
  await user.click(screen.getByTestId("shop-offer-color-Navy"));
  await user.click(screen.getByTestId("shop-sync-run"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/sync", {}));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  expect(screen.getByTestId("shop-offer-color-Navy")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-count")).toHaveTextContent("6 Varianten");
});

test("Abgleichen während einer ungespeicherten Auswahl lässt die Auswahl stehen - Schritt 3 (#2091)", async () => {
  apiMock.post.mockResolvedValue({ data: { ...view(), result: { ok: true } } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-area-use-back"));
  expect(screen.getByTestId("shop-area-use-back")).toBeChecked();
  await user.click(screen.getByTestId("shop-sync-run"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  expect(screen.getByTestId("shop-area-use-back")).toBeChecked();
  expect(screen.getByTestId("shop-area-add-motif-back")).toBeInTheDocument();
});

test("ohne gespeichertes Angebot lassen sich Farben und Größen wählen (#2091)", async () => {
  const fresh = view({ product: { offer: null, technique: null }, variants: [] });
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/admin/shop/products" ? LIST : fresh }));
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-offer"));
  expect(screen.getByTestId("shop-offer-count")).toHaveTextContent("0 Varianten");
  expect(screen.getByTestId("shop-offer-submit")).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByTestId("shop-offer-color-Black"));
  await user.click(screen.getByTestId("shop-offer-size-M"));
  expect(screen.getByTestId("shop-offer-color-Black")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-size-M")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-count")).toHaveTextContent("1 Varianten");
  expect(screen.getByTestId("shop-offer-submit")).toHaveAttribute("aria-disabled", "false");
});

test("ein gespeichertes Angebot bleibt vorbelegt und übernimmt den neuen Stand nach dem Speichern (#2091)", async () => {
  const saved = view({ product: { offer: { colors: ["Navy"], sizes: ["XL"] } } });
  apiMock.put.mockResolvedValue({ data: saved });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-offer"));
  expect(screen.getByTestId("shop-offer-color-Black")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-size-M")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-color-Navy")).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByTestId("shop-offer-color-Navy"));
  expect(screen.getByTestId("shop-offer-color-Navy")).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByTestId("shop-offer-submit"));
  await waitFor(() => expect(screen.getByTestId("shop-offer-color-Black")).toHaveAttribute("aria-pressed", "false"));
  expect(screen.getByTestId("shop-offer-color-Navy")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-size-XL")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("shop-offer-count")).toHaveTextContent("1 Varianten");
});

test("Druckflächen: exakte Größe von Printful, Vorlagenbild, Motiv mit Vorgabe und Größe in cm und Zoll", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-template-status")).toHaveTextContent("Druckvorlage von Printful, abgeglichen");
  expect(screen.getByTestId("shop-area-size-front")).toHaveTextContent("1800 × 2400 px · 30,5 cm (12 Zoll) × 40,6 cm (16 Zoll) · 150 DPI");
  expect(screen.getByTestId("shop-preview-front").querySelector("img[src='/api/admin/shop/print-templates/71/images/0']")).not.toBeNull();
  // Löwe: Brust rechts vom Träger aus, 8,9 cm - in der Vorschau bei 223/1800 der Fläche (wie der Server).
  const lion = screen.getByTestId("shop-preview-front-layer-0");
  expect(parseFloat(lion.style.left)).toBeCloseTo((223.18 / 1800) * 100, 1);
  expect(screen.getByTestId("shop-layer-front-0-width-text")).toHaveTextContent("8,9 cm (3,5 Zoll)");
  // Der Gamertag ist ein Platzhalter gegenüber dem Löwen.
  const name = screen.getByTestId("shop-preview-front-layer-1");
  expect(parseFloat(name.style.left) + parseFloat(name.style.width) / 2).toBeCloseTo(100 - (parseFloat(lion.style.left) + parseFloat(lion.style.width) / 2), 1);
  // Rücken dazu: eine Fläche wählen, Motiv hinzufügen, Größe per Regler.
  await user.click(screen.getByTestId("shop-area-use-back"));
  await user.click(screen.getByTestId("shop-area-add-motif-back"));
  await user.selectOptions(screen.getByTestId("shop-layer-back-0-motif"), "ruecken-weiss");
  const width = screen.getByTestId("shop-layer-back-0-width-cm");
  await user.clear(width);
  await user.type(width, "25");
  expect(screen.getByTestId("shop-layer-back-0-width-text")).toHaveTextContent("25 cm (9,84 Zoll)");
  expect(screen.getByTestId("shop-layout-included-front")).toHaveAttribute("aria-checked", "true");
  await user.click(screen.getByTestId("shop-layout-submit"));
  const [url, body] = apiMock.put.mock.calls[0];
  expect(url).toBe("/admin/shop/products/p1/layout");
  expect(body.included_placement).toBe("front");
  expect(body.reason).toBe("");
  expect(body.placements).toEqual([
    { key: "front", mode: "layout", layers: [
      { kind: "motif", preset: "chest_right", offset_x_cm: 0, offset_y_cm: 0, width_cm: 8.9, motif: { key: "loewe-weiss", by_color: {} } },
      { kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0 }] },
    { key: "back", mode: "layout", layers: [
      { kind: "motif", preset: "back_large", offset_x_cm: 0, offset_y_cm: 0, width_cm: 25, motif: { key: "ruecken-weiss", by_color: {} } }] },
  ]);
});

test("der Gamertag zeigt einen Beispielnamen in echter Größe; Texthöhe und Höchstbreite je Ebene (#2105)", async () => {
  const canvas = { width_in: 3.5, height_in: 0.75, anchor_y_in: 0.375, text_height_cm: 1.27, max_width_cm: 8.89, height_per_text: 1.5,
    limits: { min_text_height_cm: 0.25, max_text_height_cm: 5.08, min_width_cm: 1.27, max_width_cm: 30.48 } };
  apiMock.get.mockResolvedValue({ data: view({ extra: { gamertag_canvas: canvas } }) });
  apiMock.put.mockResolvedValue({ data: view({ extra: { gamertag_canvas: canvas } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  const sample = screen.getByTestId("shop-preview-front-layer-1-sample");
  expect(sample.getAttribute("src")).toBe("/api/admin/shop/products/p1/name-sample?kind=gamertag&color=Black&placement=front");
  const before = parseFloat(screen.getByTestId("shop-preview-front-layer-1").style.width);
  expect(before).toBeCloseTo((3.5 * 150 / 1800) * 100, 1);
  expect(screen.getByTestId("shop-layer-front-1-text-height")).toHaveAttribute("placeholder", "Vorgabe 1,3");
  await user.type(screen.getByTestId("shop-layer-front-1-text-height"), "1,5");
  await user.type(screen.getByTestId("shop-layer-front-1-max-width"), "6");
  // Gedrosselt: das Bild kommt erst, wenn die Eingabe kurz ruht.
  await waitFor(() => expect(screen.getByTestId("shop-preview-front-layer-1-sample").getAttribute("src")).toBe(
    "/api/admin/shop/products/p1/name-sample?kind=gamertag&color=Black&placement=front&text_height_cm=1.5&max_width_cm=6"));
  expect(parseFloat(screen.getByTestId("shop-preview-front-layer-1").style.width)).toBeCloseTo(((6 / 2.54) * 150 / 1800) * 100, 1);
  await user.click(screen.getByTestId("shop-layout-submit"));
  expect(apiMock.put.mock.calls[0][1].placements[0].layers[1]).toEqual({
    kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0, text_height_cm: 1.5, max_width_cm: 6 });
  // Leer heißt wieder Vorgabe.
  await user.clear(screen.getByTestId("shop-layer-front-1-max-width"));
  await waitFor(() => expect(screen.getByTestId("shop-preview-front-layer-1-sample").getAttribute("src")).not.toContain("max_width_cm"));
});

test("passt der Beispielname nicht, sagt die Ebene warum - und eine gültige Größe zeigt ihn wieder (Review #2105)", async () => {
  const canvas = { width_in: 3.5, height_in: 0.75, anchor_y_in: 0.375, text_height_cm: 1.27, max_width_cm: 8.89, height_per_text: 1.5,
    limits: { min_text_height_cm: 0.25, max_text_height_cm: 5.08, min_width_cm: 1.27, max_width_cm: 30.48 } };
  const data = view({ extra: { gamertag_canvas: canvas } });
  const tooWide = "Der Name ist zu breit: auch bei 0,4 Zoll Texthöhe wird er 1,9 Zoll breit, erlaubt sind 0,39 Zoll.";
  apiMock.get.mockImplementation((url) => (url.endsWith("/name-sample")
    ? Promise.reject({ response: { status: 400, data: { detail: tooWide } } })
    : Promise.resolve({ data })));
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.type(screen.getByTestId("shop-layer-front-1-max-width"), "1");
  await waitFor(() => expect(screen.getByTestId("shop-preview-front-layer-1-sample").getAttribute("src")).toContain("max_width_cm=1"));
  fireEvent.error(screen.getByTestId("shop-preview-front-layer-1-sample"));
  expect(await screen.findByText(tooWide)).toBeInTheDocument();
  expect(screen.queryByTestId("shop-preview-front-layer-1-sample")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/admin/shop/products/p1/name-sample", { params: { kind: "gamertag", color: "Black", placement: "front", max_width_cm: "1" } });
  // Weiter tippen (1 → 12): das neue Bild ist wieder da, der Hinweis weg.
  await user.type(screen.getByTestId("shop-layer-front-1-max-width"), "2");
  await waitFor(() => expect(screen.getByTestId("shop-preview-front-layer-1-sample").getAttribute("src")).toContain("max_width_cm=12"));
  expect(screen.getByTestId("shop-preview-front-layer-1-sample")).toBeVisible();
  await waitFor(() => expect(screen.queryByText(tooWide)).toBeNull());
});

test("Flächen heißen deutsch - eine englische Bezeichnung von Printful ist als Rückfall markiert (#2105)", async () => {
  const base = view();
  const english = { ...base.available_placements[1], key: "zz_odd", label: "Odd panel", label_translated: false };
  apiMock.get.mockResolvedValue({ data: view({ extra: {
    labels: { ...LABELS, placements: { front: "Vorderseite", back: "Rückseite" } },
    available_placements: [{ ...base.available_placements[0], label_translated: true }, english],
  } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  expect(await screen.findByTestId("shop-printful-placement-front")).toHaveTextContent("Vorderseite (DTG-Direktdruck)");
  expect(screen.getByTestId("shop-printful-placement-back")).toHaveTextContent("Rückseite");
  await user.click(screen.getByTestId("shop-step-designs"));
  expect(screen.queryByTestId("shop-area-label-english-front")).toBeNull();
  expect(screen.getByTestId("shop-area-label-english-zz_odd")).toHaveTextContent("Bezeichnung von Printful (englisch)");
});

test("die Vorschau nimmt je Farbe die passende Vorlage - sonst die vom Server eingefärbte (#2105)", async () => {
  const base = view();
  const front = base.available_placements[0];
  const own = { ...front.preview, image_path: "/api/admin/shop/print-templates/71/images/3", tinted: false };
  const tinted = { ...front.preview, image_path: "/api/admin/shop/print-templates/71/images/0?tint=ffffff", tinted: true };
  apiMock.get.mockResolvedValue({ data: view({ extra: { available_placements: [
    { ...front, preview_by_color: { Black: own, White: tinted } }, base.available_placements[1]] } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  const area = screen.getByTestId("shop-preview-front");
  expect(area.querySelector("img[src='/api/admin/shop/print-templates/71/images/3']")).not.toBeNull();
  expect(area).not.toHaveAttribute("data-tinted");
  await user.click(screen.getByTestId("shop-preview-color-White"));
  expect(area.querySelector("img[src='/api/admin/shop/print-templates/71/images/0?tint=ffffff']")).not.toBeNull();
  expect(area).toHaveAttribute("data-tinted", "true");
});

test("Feinjustieren mit Pfeiltasten; was aus der Fläche ragt, sagt die Vorschau", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  const lion = screen.getByTestId("shop-preview-front-layer-0");
  lion.focus();
  await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}{ArrowDown}");
  expect(screen.getByTestId("shop-layer-front-0-offset")).toHaveTextContent("-2 / 0,1 cm");
  await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}");
  expect(screen.getByTestId("shop-preview-front-layer-0")).toHaveAttribute("data-outside", "links");
  expect(screen.getByTestId("shop-layer-front-0-outside")).toHaveTextContent("Ragt links aus der Fläche");
  await user.click(screen.getByTestId("shop-layer-front-0-reset"));
  expect(screen.queryByTestId("shop-layer-front-0-outside")).not.toBeInTheDocument();
  // Die Vorschau zeigt je Farbe die Fassung, die gedruckt wird (#2069 Teil A): auf Weiß die Fassung für helle Shirts.
  await user.click(screen.getByTestId("shop-preview-color-White"));
  expect(screen.getByTestId("shop-preview-front").style.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(screen.getByTestId("shop-preview-front-layer-0").querySelector("img").getAttribute("src")).toContain("loewe-weiss-v2");
  // Eine Ausnahme je Farbe zeigt sofort das gewählte Motiv.
  await user.click(screen.getByTestId("shop-layer-front-0-exceptions-toggle"));
  await user.selectOptions(screen.getByTestId("shop-layer-front-0-exception-White"), "loewe-schwarz");
  expect(screen.getByTestId("shop-preview-front-layer-0").querySelector("img").getAttribute("src")).toContain("loewe-schwarz");
});

// ---------------------------------------------------------------- Präzise setzen (#2117)

const layerCenter = (testId) => {
  const box = screen.getByTestId(testId).style;
  return { x: parseFloat(box.left) + parseFloat(box.width) / 2, y: parseFloat(box.top) + parseFloat(box.height) / 2 };
};

test("Position als Zahl mit Komma, − und + und Pfeiltasten; „Auf die Vorgabe“; gespeichert wird nur der Versatz (#2117)", async () => {
  window.localStorage.removeItem("tls_shop_place_v1");
  apiMock.put.mockResolvedValue({ data: view() });
  apiMock.post.mockResolvedValue({ data: { placements: [] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  // Die Bedienung steht sichtbar unter der Vorschau.
  expect(screen.getByTestId("shop-preview-front-help")).toHaveTextContent("Ziehen rastet ein (Alt = frei), Pfeiltasten 0,1 cm, Umschalt 1 cm");
  const top = screen.getByTestId("shop-layer-front-0-top");
  const x = screen.getByTestId("shop-layer-front-0-x");
  // Brust rechts: Oberkante 5 cm, Mitte bei 27 % - also 7,01 cm links der Mitte.
  expect(top).toHaveValue("5");
  expect(x).toHaveValue("-7,01");
  expect(screen.getByTestId("shop-layer-front-0-offset")).toHaveTextContent("wie die Vorgabe");
  expect(screen.getByTestId("shop-layer-front-0-reset")).toBeDisabled();
  await user.clear(top);
  await user.type(top, "7,25");
  expect(screen.getByTestId("shop-layer-front-0-offset")).toHaveTextContent("Feinjustiert: 0 / 2,25 cm");
  await user.click(screen.getByTestId("shop-layer-front-0-top-plus"));
  expect(top).toHaveValue("7,35");
  top.focus();
  await user.keyboard("{ArrowDown}{Shift>}{ArrowUp}{/Shift}");
  expect(top).toHaveValue("8,25");
  await user.clear(x);
  await user.type(x, "-6");
  expect(screen.getByTestId("shop-layer-front-0-offset")).toHaveTextContent("Feinjustiert: 1,01 / 3,25 cm");
  await user.click(screen.getByTestId("shop-layout-submit"));
  const layer = apiMock.put.mock.calls[0][1].placements[0].layers[0];
  expect([layer.preset, layer.offset_x_cm, layer.offset_y_cm]).toEqual(["chest_right", 1.01, 3.25]);
  await user.click(screen.getByTestId("shop-layer-front-0-reset"));
  expect(top).toHaveValue("5");
  expect(screen.getByTestId("shop-layer-front-0-offset")).toHaveTextContent("wie die Vorgabe");
});

test("Ausrichten mit einem Klick: Gamertag auf Höhe des Löwen, gegenüber, Motiv zur Gegenseite gespiegelt (#2117)", async () => {
  apiMock.post.mockResolvedValue({ data: { placements: [] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  // Der Name folgt dem Löwen - der Löwe kann sich darum nicht am Namen ausrichten, der Name aber am Löwen.
  expect(screen.queryByTestId("shop-layer-front-0-align-to")).toBeNull();
  expect(screen.getByTestId("shop-layer-front-1-align-target")).toHaveDisplayValue("Motiv Löwe weiß");
  const name = screen.getByTestId("shop-layer-front-1-top");
  await user.clear(name);
  await user.type(name, "20");
  expect(layerCenter("shop-preview-front-layer-1").y).not.toBeCloseTo(layerCenter("shop-preview-front-layer-0").y, 1);
  await user.click(screen.getByTestId("shop-layer-front-1-align-middle"));
  expect(layerCenter("shop-preview-front-layer-1").y).toBeCloseTo(layerCenter("shop-preview-front-layer-0").y, 1);
  await user.click(screen.getByTestId("shop-layer-front-1-align-center"));
  expect(layerCenter("shop-preview-front-layer-1").x).toBeCloseTo(layerCenter("shop-preview-front-layer-0").x, 1);
  await user.click(screen.getByTestId("shop-layer-front-1-align-opposite"));
  expect(layerCenter("shop-preview-front-layer-1").x).toBeCloseTo(100 - layerCenter("shop-preview-front-layer-0").x, 1);
  // Spiegeln: Brust rechts (27 %) wandert auf 73 % - der Name gegenüber kommt mit.
  await user.click(screen.getByTestId("shop-layer-front-0-mirror"));
  expect(layerCenter("shop-preview-front-layer-0").x).toBeCloseTo(73, 1);
  expect(layerCenter("shop-preview-front-layer-1").x).toBeCloseTo(27, 1);
  expect(screen.getByTestId("shop-layer-front-0-x")).toHaveValue("7,01");
});

test("Raster und Messart sind einstellbar und bleiben im Browser; „Groß bearbeiten“ zeigt nur die Fläche mit Zoom (#2117)", async () => {
  window.localStorage.removeItem("tls_shop_place_v1");
  apiMock.post.mockResolvedValue({ data: { placements: [] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-preview-front-settings-grid")).toHaveValue("0.5");
  expect(screen.getByTestId("shop-preview-front-settings-snap")).toBeChecked();
  // Einrasten aus: auch das Raster wirkt nicht und ist ausgegraut.
  await user.click(screen.getByTestId("shop-preview-front-settings-snap"));
  expect(screen.getByTestId("shop-preview-front-settings-grid")).toBeDisabled();
  expect(screen.getByText("Einrasten (Hilfslinien und Raster)", { selector: "label" })).toBeInTheDocument();
  await user.click(screen.getByTestId("shop-preview-front-settings-snap"));
  expect(screen.getByTestId("shop-preview-front-settings-grid")).toBeEnabled();
  await user.selectOptions(screen.getByTestId("shop-preview-front-settings-grid"), "1");
  await user.selectOptions(screen.getByTestId("shop-preview-front-settings-measure"), "left");
  expect(JSON.parse(window.localStorage.getItem("tls_shop_place_v1"))).toEqual({ grid: 1, snap: true, measure: "left" });
  // Vom linken Rand: die linke Kante des Löwen (8,23 - 4,45 cm).
  expect(screen.getByText("Vom linken Rand (cm)", { selector: "label[for='shop-layer-front-0-x']" })).toBeInTheDocument();
  expect(screen.getByTestId("shop-layer-front-0-x")).toHaveValue("3,78");
  await user.click(screen.getByTestId("shop-preview-front-big"));
  const big = await screen.findByTestId("shop-big-front");
  expect(within(big).getByText("„Vorderseite“ groß bearbeiten")).toBeInTheDocument();
  // Nur die Druckfläche, ohne Shirt-Vorlage; dieselben Einstellungen.
  expect(big.querySelector("img[src*='print-templates']")).toBeNull();
  expect(big.querySelector("img[src*='loewe-weiss']")).not.toBeNull();
  expect(within(big).getByTestId("shop-big-front-settings-grid")).toHaveValue("1");
  await user.click(within(big).getByTestId("shop-big-front-layer-0"));
  expect(within(big).getByTestId("shop-big-front-field-top")).toHaveValue("5");
  await user.click(within(big).getByTestId("shop-big-front-zoom-in"));
  expect(within(big).getByTestId("shop-big-front-zoom")).toHaveTextContent("125 %");
  await user.click(within(big).getByTestId("shop-big-front-fit"));
  expect(within(big).getByTestId("shop-big-front-zoom")).toHaveTextContent("100 %");
  // Eine Zahl im großen Fenster wirkt auch in der Karte.
  const field = within(big).getByTestId("shop-big-front-field-top");
  await user.clear(field);
  await user.type(field, "6,5");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByTestId("shop-big-front")).toBeNull());
  expect(screen.getByTestId("shop-layer-front-0-top")).toHaveValue("6,5");
  window.localStorage.removeItem("tls_shop_place_v1");
});

test("Ausnahme je Farbe und Druckdateien je Farbe; erzeugen geht erst nach dem Speichern", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  apiMock.post.mockResolvedValue({ data: { ...view(), result: { created: [{ placement: "front", color: "White" }], unchanged: 1, failed: [] } } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-file-front-Black")).toHaveAttribute("data-state", "ok");
  expect(screen.getByTestId("shop-file-front-White")).toHaveTextContent("veraltet");
  expect(screen.getByTestId("shop-file-front-White-preview").getAttribute("href")).toContain("/api/admin/shop/products/p1/preview?placement=front&color=White");
  expect(screen.getByTestId("shop-generate")).toHaveTextContent("1 Druckdatei fehlen oder sind veraltet");
  await user.click(screen.getByTestId("shop-generate-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/print-files", { reason: "" });
  expect(toastMock.success).toHaveBeenCalledWith("1 Druckdatei erzeugt.");
  await user.click(screen.getByTestId("shop-layer-front-0-exceptions-toggle"));
  await user.selectOptions(screen.getByTestId("shop-layer-front-0-exception-White"), "loewe-schwarz");
  await user.click(screen.getByTestId("shop-generate-submit"));
  expect(screen.getByTestId("shop-generate-hint")).toHaveTextContent("Erst die Druckflächen speichern");
  await user.click(screen.getByTestId("shop-layout-submit"));
  expect(apiMock.put.mock.calls[0][1].placements[0].layers[0].motif).toEqual({ key: "loewe-weiss", by_color: { White: "loewe-schwarz" } });
});

test("für Profis: fertige Druckdatei je Farbe hochladen", async () => {
  const uploadView = view({ placements: [{ key: "front", label: "Vorderseite", mode: "upload", printful_placement: "front", included: true, layers: [],
    files: [{ placement: "front", color: "Black", group: "all", state: "missing", detail: "Noch keine fertige Druckdatei hochgeladen.", file: null, plan: { layers: [] } }] }] });
  apiMock.get.mockResolvedValue({ data: uploadView });
  uploadApiMock.post.mockResolvedValue({ data: uploadView });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-area-mode-front-upload")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("shop-area-upload-hint-front")).toHaveTextContent("1800 × 2400 px");
  const file = new File(["png"], "vorne.png", { type: "image/png" });
  await user.upload(screen.getByTestId("shop-upload-front-Black"), file);
  await user.click(screen.getByTestId("shop-upload-front-Black-submit"));
  const [url, form] = uploadApiMock.post.mock.calls[0];
  expect(url).toBe("/admin/shop/print-files/upload");
  expect(form.get("product_id")).toBe("p1");
  expect(form.get("placement")).toBe("front");
  expect(form.get("color")).toBe("Black");
  expect(form.get("file").name).toBe("vorne.png");
});

// Allover (#2141): fertige Datei als Hintergrund, Motive und Namen als Ebenen darüber, Fassung aus dem Hintergrund.
// ---------------------------------------------------------------- Trikot (#2142)

const SPORT = "saira-condensed-900";
const METRICS = { name: 2.3, name_offset: 0.013, number: 1.05, number_offset: 0.013, band_name: 1, band_number: 1.01 };
const JERSEY_PRESETS = [
  { key: "jersey_back_name", label: "Trikot Rücken: Name oben", hint: "", kind: "text", families: ["back"], follow: null, center_x: 0.5, anchor: "top", top_cm: 8 },
  { key: "jersey_back_number", label: "Trikot Rücken: Nummer darunter", hint: "", kind: "text", families: ["back"], follow: "stack", gap_cm: 2, center_x: 0.5, anchor: "top", top_cm: 0 },
  { key: "jersey_back_club", label: "Trikot Rücken: Vereinsname unten", hint: "", kind: "text", families: ["back"], follow: null, center_x: 0.5, anchor: "bottom", top_cm: 8 },
];
const JERSEY_BACK = {
  key: "jersey_back", label: "Trikot Rücken", hint: "Name oben, Nummer darunter, Vereinsname unten.", families: ["back"], skipped: [],
  layers: [
    { kind: "gamertag", preset: "jersey_back_name", text_height_cm: 4, max_width_cm: 28, font: SPORT },
    { kind: "member_number", preset: "jersey_back_number", text_height_cm: 10, max_width_cm: 28, font: SPORT },
    { kind: "text", preset: "jersey_back_club", text: "TESTVEREIN", text_height_cm: 2.5, max_width_cm: 28, font: SPORT },
  ],
};

function jerseyView(overrides = {}) {
  const base = view({ product: { personalization: "both" }, ...overrides });
  return {
    ...base,
    presets: [...PRESETS, ...JERSEY_PRESETS],
    available_placements: base.available_placements.map((area) => (area.key === "back"
      ? { ...area, presets: { motif: ["back_large"], text: ["text_center", ...JERSEY_PRESETS.map((preset) => preset.key)] } } : area)),
    gamertag_canvas: { width_in: 3.5, height_in: 0.75, anchor_y_in: 0.375, text_height_cm: 1.27, max_width_cm: 8.89, height_per_text: 1.5,
      font: "rajdhani-700", font_metrics: { "rajdhani-700": { name: 1.5, number: 1.02, band_name: 1, band_number: 1 }, [SPORT]: METRICS },
      limits: { min_text_height_cm: 0.25, min_width_cm: 1.27, min_outline_cm: 0.05, max_outline_cm: 2 } },
    fonts: [{ key: "rajdhani-700", label: "Rajdhani Bold" }, { key: SPORT, label: "Saira Condensed Black – Sport- und Blockschrift für Trikots" }],
    name_inks: [{ key: "vereinsblau", label: "Vereinsblau", hex: "#29B6E8" }, { key: "reinweiss", label: "Weiß", hex: "#FFFFFF" }],
    print_sets: [JERSEY_BACK],
    labels: { ...LABELS, kinds: { ...LABELS.kinds, text: "Fester Text (in der Grunddatei, etwa der Vereinsname)" } },
  };
}

test("Trikot Rücken mit einem Klick: Name oben, Nummer darunter, Vereinsname unten - mit Text, Schrift und Kontur (#2142)", async () => {
  const data = jerseyView();
  apiMock.get.mockResolvedValue({ data });
  apiMock.put.mockResolvedValue({ data });
  apiMock.post.mockResolvedValue({ data: { placements: [] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-area-use-back"));
  await user.click(screen.getByTestId("shop-area-set-back-jersey_back"));
  expect(screen.getByTestId("shop-area-set-notice-back")).toHaveTextContent("Vorlage „Trikot Rücken“ gesetzt: 3 Ebenen");
  // Untereinander und mittig: der Name oben, die Nummer 2 cm unter den Großbuchstaben, der Vereinsname unten.
  const top = (index) => parseFloat(screen.getByTestId(`shop-preview-back-layer-${index}`).style.top);
  expect(top(0)).toBeLessThan(top(1));
  expect(top(1)).toBeLessThan(top(2));
  for (const index of [0, 1, 2]) {
    const box = screen.getByTestId(`shop-preview-back-layer-${index}`).style;
    expect(parseFloat(box.left) + parseFloat(box.width) / 2).toBeCloseTo(50, 1);
  }
  expect(screen.getByTestId("shop-layer-back-1-gap-now")).toHaveTextContent("jetzt 2 cm");
  // Grenzen je Fläche statt fest (30,48 × 40,64 cm): eine Nummer mit 10 cm ist kein Fehler.
  expect(screen.getByTestId("shop-layer-back-1-size-hint")).not.toHaveClass("text-warn");
  expect(screen.getByTestId("shop-layer-back-1-size-hint")).toHaveTextContent("Höchstbreite bis 30,5 cm");
  // Fester Text: Text ändern; Textebenen zeigen nur die Farbe, keine Fassung.
  const text = screen.getByTestId("shop-layer-back-2-text");
  await user.clear(text);
  await user.type(text, "TESTVEREIN LÖWEN");
  expect(screen.queryByTestId("shop-layer-back-2-variant")).toBeNull();
  expect(screen.getByTestId("shop-layer-back-2-surface")).toHaveTextContent("Farbe nach der Shirtfarbe.");
  await user.type(screen.getByTestId("shop-layer-back-1-outline"), "0,3");
  await user.selectOptions(screen.getByTestId("shop-layer-back-1-outline-ink"), "reinweiss");
  await waitFor(() => expect(screen.getByTestId("shop-preview-back-layer-1-sample").getAttribute("src")).toContain(
    "kind=member_number&color=Black&placement=back&text_height_cm=10&max_width_cm=28&font=saira-condensed-900&outline_cm=0.3&outline_ink=reinweiss"));
  expect(screen.getByTestId("shop-preview-back-layer-2-sample").getAttribute("src")).toContain("kind=text");
  // Ausrichten: Abstand zur Ebene darüber in cm.
  await user.type(screen.getByTestId("shop-layer-back-1-gap"), "3");
  await user.click(screen.getByTestId("shop-layer-back-1-gap-set"));
  expect(screen.getByTestId("shop-layer-back-1-gap-now")).toHaveTextContent("jetzt 3 cm");
  await user.click(screen.getByTestId("shop-layout-submit"));
  const back = apiMock.put.mock.calls[0][1].placements.find((row) => row.key === "back");
  expect(back.layers).toEqual([
    { kind: "gamertag", preset: "jersey_back_name", offset_x_cm: 0, offset_y_cm: 0, text_height_cm: 4, max_width_cm: 28, font: SPORT },
    { kind: "member_number", preset: "jersey_back_number", offset_x_cm: 0, offset_y_cm: 1, text_height_cm: 10, max_width_cm: 28, font: SPORT, outline_cm: 0.3, outline_ink: "reinweiss" },
    { kind: "text", preset: "jersey_back_club", offset_x_cm: 0, offset_y_cm: 0, text_height_cm: 2.5, max_width_cm: 28, font: SPORT, text: "TESTVEREIN LÖWEN" },
  ]);
});

test("Fester Text von Hand, mittig ausrichten; ohne Text blockiert das Speichern (#2142)", async () => {
  apiMock.get.mockResolvedValue({ data: jerseyView() });
  apiMock.post.mockResolvedValue({ data: { placements: [] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-area-add-text-front"));
  const text = screen.getByTestId("shop-layer-front-2-text");
  expect(text).toHaveValue("TESTVEREIN");
  await user.click(screen.getByTestId("shop-preview-front-layer-2"));
  await user.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
  const box = () => screen.getByTestId("shop-preview-front-layer-2").style;
  expect(parseFloat(box().left) + parseFloat(box().width) / 2).not.toBeCloseTo(50, 1);
  await user.click(screen.getByTestId("shop-layer-front-2-center"));
  expect(parseFloat(box().left) + parseFloat(box().width) / 2).toBeCloseTo(50, 1);
  await user.clear(text);
  expect(screen.getByTestId("shop-area-problem-front")).toHaveTextContent("Hier fehlt der Text eines festen Texts.");
  expect(screen.getByTestId("shop-layout-submit")).toHaveAttribute("aria-disabled", "true");
});

test("Namen auf einem Hintergrund: Farbe „aus Hintergrund“ - passt er nicht mehr zur Vorlage, sagt die Vorschau es (#2142)", async () => {
  const data = alloverView();
  const outdated = { ...data, placements: data.placements.map((row) => ({ ...row, files: row.files.map((state) => (state.color === "Black" ? { ...state, background_ok: false } : state)) })) };
  apiMock.get.mockResolvedValue({ data: outdated });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-layer-back-1-surface")).toHaveTextContent("Farbe: Vereinsblau (aus Hintergrund)");
  expect(screen.queryByTestId("shop-layer-back-1-variant")).toBeNull();
  expect(screen.getByTestId("shop-preview-back-backdrop-outdated")).toHaveTextContent("passt nicht mehr zur Vorlage");
});

test("Mindesthöhe je Ebene und der Hinweis des Servers, wenn der längste Name nicht passt (Review #2142)", async () => {
  const base = jerseyView();
  const name = { kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0, text_height_cm: 1, max_width_cm: 6 };
  const data = { ...base, placements: base.placements.map((row) => (row.key === "front"
    ? { ...row, layers: [row.layers[0], name], layer_hints: [null, "Hinweis: der längste erlaubte Name (16 × „W“) passt nicht."] } : row)) };
  apiMock.get.mockResolvedValue({ data });
  apiMock.put.mockResolvedValue({ data });
  apiMock.post.mockResolvedValue({ data: { placements: [] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-layer-front-1-hint")).toHaveTextContent("16 × „W“");
  await user.type(screen.getByTestId("shop-layer-front-1-min-height"), "0,5");
  // Geändert: der Hinweis galt dem gespeicherten Stand.
  expect(screen.queryByTestId("shop-layer-front-1-hint")).toBeNull();
  await user.click(screen.getByTestId("shop-layout-submit"));
  expect(apiMock.put.mock.calls[0][1].placements[0].layers[1]).toEqual({ ...name, min_text_height_cm: 0.5 });
});
function alloverView() {
  const plan = (color, variant, text) => ({ layers: [
    { index: 0, kind: "motif", source: { design_key: "ruecken-weiss", variant, version: 1 }, image_path: "/api/shop/print-files/k9/ruecken-weiss-v1.png", aspect: 1,
      surface: { variant, source: "background", luminance: 0.01, text } },
    { index: 1, kind: "gamertag", surface: { variant, source: "background", luminance: 0.01, text },
      ink: { key: variant === "dark" ? "vereinsblau" : "tiefschwarz", label: variant === "dark" ? "Vereinsblau" : "Schwarz", hex: "#29B6E8" } },
  ] });
  return view({
    placements: [{ key: "back", label: "Rückseite", mode: "upload", printful_placement: "back", included: true, motifs_hidden: false,
      layers: [
        { kind: "motif", preset: "back_large", width_cm: 20, offset_x_cm: 0, offset_y_cm: 0, motif: { key: "ruecken-weiss", by_color: {} } },
        { kind: "gamertag", preset: "text_center", offset_x_cm: 0, offset_y_cm: 0 },
      ],
      files: [
        { placement: "back", color: "Black", group: "all", state: "ok", detail: "", file: { id: "c1", version: 3, warnings: [] }, background: { id: "bg-black", version: 2 },
          plan: plan("Black", "dark", "Fassung: dunkel (aus Hintergrund)") },
        { placement: "back", color: "White", group: "all", state: "missing", detail: "Noch kein Hintergrund - je Farbe die fertige Datei hochladen (nach dem Speichern).", file: null, background: null,
          plan: { layers: [] } },
      ] }],
    extra: {
      included_placement: "back",
      labels: { ...LABELS, modes: { layout: "Motiv und Position", upload: "Fertige Druckdatei als Hintergrund" },
        mode_hints: { layout: "Die Website erzeugt die Druckdatei.", upload: "Für Allover: je Farbe eine fertige Datei als Hintergrund." },
        surfaces: { garment: "wie Printful-Farbe", light: "hell", dark: "dunkel" }, layer_variants: { auto: "automatisch", light: "hell", dark: "dunkel" } },
    },
  });
}

test("Allover: Hintergrund in der Vorschau, Motive als Ebenen darüber, Fassung und Namensfarbe aus dem Hintergrund (#2141)", async () => {
  const data = alloverView();
  apiMock.get.mockResolvedValue({ data });
  apiMock.put.mockResolvedValue({ data });
  apiMock.post.mockResolvedValue({ data: { placements: [] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-area-mode-back-upload")).toHaveTextContent("Fertige Druckdatei als Hintergrund");
  expect(screen.getByTestId("shop-area-mode-hint-back")).toHaveTextContent("Für Allover");
  expect(screen.queryByTestId("shop-area-save-first-back")).toBeNull();
  // Der Hintergrund der Vorschau-Farbe liegt in der Druckfläche, das Motiv als Ebene darüber.
  const backdrop = screen.getByTestId("shop-preview-back-backdrop");
  expect(backdrop.getAttribute("src")).toBe("/api/admin/shop/products/p1/print-files/bg-black?thumb=1");
  expect(screen.getByTestId("shop-preview-back-area").firstElementChild).toBe(backdrop);
  expect(screen.getByTestId("shop-preview-back-layer-0").querySelector("img")).not.toBeNull();
  expect(screen.getByTestId("shop-area-add-motif-back")).toBeEnabled();
  expect(screen.getByTestId("shop-layer-back-0-surface")).toHaveTextContent("Fassung: dunkel (aus Hintergrund)");
  expect(screen.getByTestId("shop-layer-back-1-surface")).toHaveTextContent("Farbe: Vereinsblau");
  expect(screen.getByTestId("shop-preview-back-layer-1-sample").getAttribute("src")).toContain("ink=vereinsblau");
  // Weiß hat noch keinen Hintergrund: kein Bild, ein Hinweis.
  await user.click(screen.getByTestId("shop-preview-color-White"));
  expect(screen.queryByTestId("shop-preview-back-backdrop")).toBeNull();
  expect(screen.getByTestId("shop-preview-back-no-backdrop")).toHaveTextContent("noch kein Hintergrund");
  // Fassung von Hand und „Untergrund gilt als“ gehen mit dem Speichern hinaus.
  await user.selectOptions(screen.getByTestId("shop-layer-back-0-variant"), "light");
  await user.selectOptions(screen.getByTestId("shop-layout-surface"), "dark");
  await user.click(screen.getByTestId("shop-layout-submit"));
  const [, body] = apiMock.put.mock.calls[0];
  expect(body.print_surface).toBe("dark");
  expect(body.placements[0]).toEqual({ key: "back", mode: "upload", layers: [
    { kind: "motif", preset: "back_large", offset_x_cm: 0, offset_y_cm: 0, width_cm: 20, motif: { key: "ruecken-weiss", by_color: {} }, variant: "light" },
    { kind: "gamertag", preset: "text_center", offset_x_cm: 0, offset_y_cm: 0 }] });
});

test("beim Umschalten auf die fertige Datei: erst speichern, dann je Farbe hochladen (#2141)", async () => {
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.queryByTestId("shop-area-save-first-front")).toBeNull();
  await user.click(screen.getByTestId("shop-area-mode-front-upload"));
  expect(screen.getByTestId("shop-area-save-first-front")).toHaveTextContent("Erst speichern, dann je Farbe hochladen.");
  // Die Motive bleiben sichtbar und liegen auf dem Hintergrund.
  expect(screen.getByTestId("shop-layer-front-0-motif")).toBeInTheDocument();
  expect(screen.getByTestId("shop-preview-front-layer-0")).toBeInTheDocument();
});

test("die Blockiermeldung nennt die Fläche und springt hin (Nachtrag #2141)", async () => {
  const scrolled = vi.fn();
  window.Element.prototype.scrollIntoView = scrolled;
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-area-use-back"));
  const alert = screen.getByTestId("shop-layout-blocked-areas");
  expect(alert).toHaveTextContent("Jede gewählte Fläche braucht ein Motiv oder einen Platzhalter: „Rückseite“.");
  expect(screen.getByTestId("shop-area-back")).toHaveAttribute("data-blocked", "true");
  expect(screen.getByTestId("shop-area-problem-back")).toHaveTextContent("Hier fehlt ein Motiv oder ein Platzhalter");
  expect(screen.getByTestId("shop-area-front")).not.toHaveAttribute("data-blocked");
  await user.click(screen.getByTestId("shop-layout-jump-back"));
  expect(scrolled).toHaveBeenCalledTimes(1);
  expect(scrolled.mock.instances[0]).toBe(screen.getByTestId("shop-area-back"));
  expect(screen.getByTestId("shop-area-use-back")).toHaveFocus();
  // Speichern trotzdem: der Hinweis nennt die Fläche, und die Seite springt hin - gespeichert wird nichts.
  await user.click(screen.getByTestId("shop-layout-submit"));
  expect(screen.getByTestId("shop-layout-hint")).toHaveTextContent("„Rückseite“");
  expect(scrolled).toHaveBeenCalledTimes(2);
  expect(apiMock.put).not.toHaveBeenCalled();
  // Eine fertige Datei darf ohne Ebene gespeichert werden.
  await user.click(screen.getByTestId("shop-area-mode-back-upload"));
  expect(screen.queryByTestId("shop-layout-blocked-areas")).toBeNull();
  delete window.Element.prototype.scrollIntoView;
});

test("ein neues Motiv kommt vor die Namen - wie der Server sortiert (Review #2141)", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-area-add-motif-front"));
  // Ebene 1 ist das neue Motiv, der Gamertag rückt auf 2 - Nummern wie nach dem Speichern.
  expect(screen.getByTestId("shop-layer-front-1-motif")).toBeInTheDocument();
  expect(screen.getByTestId("shop-layer-front-2-text-height")).toBeInTheDocument();
  expect(screen.getByTestId("shop-preview-front-layer-2-sample")).toBeInTheDocument();
  await user.click(screen.getByTestId("shop-layout-submit"));
  expect(apiMock.put.mock.calls[0][1].placements[0].layers.map((layer) => layer.kind)).toEqual(["motif", "motif", "gamertag"]);
});

test("die Farbe des Namens ist je Ebene fest wählbar, Vorgabe automatisch (#2141)", async () => {
  const inks = [{ key: "vereinsblau", label: "Vereinsblau", hex: "#29B6E8" }, { key: "reinweiss", label: "Weiß", hex: "#FFFFFF" }];
  const data = view({ extra: { name_inks: inks } });
  apiMock.get.mockResolvedValue({ data });
  apiMock.put.mockResolvedValue({ data });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  const select = screen.getByTestId("shop-layer-front-1-ink");
  expect(select).toHaveValue("");
  expect(within(select).getByRole("option", { name: "automatisch (Kontrast)" })).toBeInTheDocument();
  await user.selectOptions(select, "reinweiss");
  await waitFor(() => expect(screen.getByTestId("shop-preview-front-layer-1-sample").getAttribute("src")).toContain("ink=reinweiss"));
  await user.click(screen.getByTestId("shop-layout-submit"));
  expect(apiMock.put.mock.calls[0][1].placements[0].layers[1]).toEqual({ kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0, ink: "reinweiss" });
});

test("ausgeblendete Motive von vor #2141 sperren „Druckdateien erzeugen“ nicht (Review #2141)", async () => {
  const data = alloverView();
  data.placements[0].motifs_hidden = true;
  data.product.status = "active";
  data.editable = false;
  apiMock.get.mockResolvedValue({ data });
  apiMock.post.mockResolvedValue({ data: { ...data, result: { created: [], unchanged: 1, failed: [] } } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-area-motifs-hidden-back")).toBeInTheDocument();
  expect(screen.getByTestId("shop-generate-submit")).toHaveAttribute("aria-disabled", "false");
  await user.click(screen.getByTestId("shop-generate-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/print-files", { reason: "" });
});

test("Preise: Warnung bei Preisänderung, Übernehmen und eigener Aufschlag nur mit Grund", async () => {
  const warned = view({ variants: [variant("Black / M", "PF1", { cost_cents: 1550, price_warning: { before_cents: 1500, after_cents: 1550, at: "2026-10-27T05:20:00+00:00" } })] });
  apiMock.get.mockResolvedValue({ data: warned });
  apiMock.post.mockResolvedValue({ data: view() });
  apiMock.patch.mockResolvedValue({ data: { product: {}, changed: ["markup_cents"] } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-prices"));
  expect(screen.getByTestId("shop-price-warnings")).toHaveTextContent("15,00 € → 15,50 €");
  expect(screen.getByTestId("shop-price-PF1")).toHaveTextContent("18,00 €");
  await user.type(screen.getByTestId("shop-prices-reason"), "Printful teurer");
  await user.click(screen.getByTestId("shop-prices-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/prices/accept", { reason: "Printful teurer" });
  await user.click(screen.getByTestId("shop-markup-source-product"));
  await user.type(screen.getByTestId("shop-markup-amount"), "2,50");
  await user.type(screen.getByTestId("shop-markup-reason"), "Eigener Aufschlag");
  await user.click(screen.getByTestId("shop-markup-submit"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/shop/products/p1", { markup_cents: 250, reason: "Eigener Aufschlag" });
});

test("Preise (#2135): Printful brutto, Mitgliederpreis, Versandbeispiel AT, Katalog netto nur als Prüfwert", async () => {
  const gross = { printful_gross_cents: 1170, member_price_cents: 1170, shipping_example_cents: 594, price_source: "estimate",
    price_cents: 1170, public_price_cents: 1470, estimated_at: "2026-10-28T05:20:00+00:00", estimate_stale: false };
  const rows = [
    variant("Black / M", "PF1", { ...gross, catalog_check: true }),
    variant("White / M", "PF3", { ...gross, cost_cents: 1180, catalog_check: false }),
    variant("White / L", "PF4", { printful_gross_cents: null, member_price_cents: null, shipping_example_cents: null, price_source: "stale", estimate_stale: true }),
  ];
  apiMock.get.mockResolvedValue({ data: view({ variants: rows, extra: { pricing: { ...view().pricing, note: "zzgl. Versand, genauer Betrag an der Kasse" } } }) });
  apiMock.post.mockResolvedValue({ data: { ...view({ variants: rows }), result: { estimated: 3, offered: 3, detail: "3 von 3 Varianten brutto geschätzt." } } });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-prices"));
  expect(screen.getByTestId("shop-prices-explain")).toHaveTextContent("zzgl. Versand, genauer Betrag an der Kasse");
  expect(screen.queryByTestId("shop-prices-no-estimate")).toBeNull();
  expect(screen.getByTestId("shop-price-PF1-gross")).toHaveTextContent("11,70 €");
  expect(screen.getByTestId("shop-price-PF1-member")).toHaveTextContent("11,70 €");
  expect(screen.getByTestId("shop-price-PF1-member")).not.toHaveClass("text-warn");
  expect(screen.getByTestId("shop-price-PF1-shipping")).toHaveTextContent("5,94 €");
  expect(screen.getByTestId("shop-price-PF1-catalog")).toHaveTextContent("15,00 €");
  // „prüfen“ nur bei starker Abweichung zwischen Katalog und Schätzung - der Server entscheidet.
  expect(screen.getByTestId("shop-price-PF1-check")).toHaveTextContent("prüfen");
  expect(screen.queryByTestId("shop-price-PF3-check")).toBeNull();
  expect(screen.getByTestId("shop-price-PF4-gross")).toHaveTextContent("noch nicht geschätzt");
  expect(screen.getByTestId("shop-price-PF4-gross")).toHaveTextContent("Schätzung veraltet");
  await user.click(screen.getByTestId("shop-prices-estimate"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/prices/estimate", {});
  expect(toastMock.success).toHaveBeenCalledWith("3 von 3 Varianten brutto geschätzt.");
});

test("Preise: eine veraltete Schätzung schlägt nie Netto vor, sondern „neu schätzen“ (#2135)", async () => {
  const stale = variant("Black / M", "PF1", { price_cents: 1170, member_price_cents: null, price_source: "stale", estimate_stale: true,
    printful_gross_cents: null, price_warning: { before_cents: 1170, after_cents: null, stale: true, at: "2026-10-28T05:20:00+00:00" } });
  apiMock.get.mockResolvedValue({ data: view({ variants: [stale] }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-prices"));
  expect(screen.getByTestId("shop-price-warnings")).toHaveTextContent("11,70 € → Schätzung veraltet – neu schätzen");
  expect(screen.getByTestId("shop-price-warnings")).not.toHaveTextContent("15,00");
  expect(screen.getByTestId("shop-price-PF1-gross")).toHaveTextContent("Schätzung veraltet");
  // Kein „bis dahin gilt der Katalog netto“ - der Server nimmt ihn nicht mehr; stattdessen erst neu schätzen.
  expect(screen.queryByTestId("shop-prices-no-estimate")).toBeNull();
  expect(screen.getByTestId("shop-prices-stale")).toHaveTextContent("erst „Brutto bei Printful schätzen“, dann übernehmen");
  expect(screen.getByTestId("shop-price-PF1-member")).toHaveClass("text-warn");
});

test("Preise ohne Schätzung: Hinweis, dass bis dahin der Katalog netto gilt", async () => {
  apiMock.get.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-prices"));
  expect(screen.getByTestId("shop-prices-no-estimate")).toHaveTextContent("Katalog netto");
  expect(screen.getByTestId("shop-price-PF1-gross")).toHaveTextContent("noch nicht geschätzt");
});

test("Veröffentlichen bleibt gesperrt, solange die Mockup-Prüfung offen ist; prüfen geht mit Grund", async () => {
  apiMock.get.mockResolvedValue({ data: view({ product: { status: "reviewed" }, extra: { transitions: ["active", "draft", "archived"] } }) });
  apiMock.post.mockResolvedValue({ data: view({ product: { status: "active" } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-publish"));
  expect(screen.getByTestId("shop-check-mockup")).toHaveAttribute("data-state", "open");
  expect(screen.getByTestId("shop-check-mockup")).toHaveTextContent("#1710");
  await user.type(screen.getByTestId("shop-status-active-reason"), "Live schalten");
  expect(screen.getByTestId("shop-status-active-submit")).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByTestId("shop-status-active-submit"));
  expect(screen.getByTestId("shop-status-active-hint")).toHaveTextContent("Mockup-Prüfung");
  expect(apiMock.post).not.toHaveBeenCalled();
  await user.type(screen.getByTestId("shop-status-draft-reason"), "Noch ändern");
  await user.click(screen.getByTestId("shop-status-draft-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/status", { status: "draft", reason: "Noch ändern" });
});

test("veröffentlicht: Sichtbarkeit, Personalisierung und Aufschlag sind gesperrt, gesperrte Varianten zeigen den Grund", async () => {
  const blocked = variant("White / L", "PF4", { blocked_reason: "Lager bei Printful unbekannt.", in_stock: null });
  apiMock.get.mockResolvedValue({ data: view({ product: { status: "active" }, variants: [variant("Black / M", "PF1"), blocked], extra: { editable: false, transitions: ["draft", "archived"] } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  expect(await screen.findByTestId("shop-product-locked")).toHaveTextContent("zurückziehen");
  expect(screen.getByTestId("shop-basics-visibility-public")).toBeDisabled();
  expect(screen.getByTestId("shop-basics-personalization-none")).toBeDisabled();
  await user.click(screen.getByTestId("shop-step-prices"));
  expect(screen.getByTestId("shop-markup-source-product")).toBeDisabled();
  expect(screen.getByTestId("shop-markup-locked")).toBeInTheDocument();
  expect(screen.getByTestId("shop-price-PF4")).toHaveTextContent("Lager bei Printful unbekannt.");
});

test("eine fehlende Datei für eine Farbe sperrt „geprüft“ und nennt die Farbe", async () => {
  const items = checkItems({ files: { ok: false, state: "failed", detail: "Ohne gültige Datei: Rücken: White" } });
  apiMock.get.mockResolvedValue({ data: view({ items }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  expect(await screen.findByTestId("shop-step-designs")).toHaveAttribute("data-state", "failed");
  await user.click(screen.getByTestId("shop-step-publish"));
  expect(screen.getByTestId("shop-check-files")).toHaveTextContent("Rücken: White");
  expect(screen.getByTestId("shop-status-reviewed-submit")).toHaveAttribute("aria-disabled", "true");
});

test("„Mit Printful abgleichen“ zeigt bei Ausfall den letzten Stand mit Datum", async () => {
  apiMock.post.mockResolvedValue({ data: view({ extra: { sync: { at: "2026-10-28T05:20:00+00:00", ok: false, detail: "Fehler beim Anbieter (500)", last_ok_at: "2026-10-27T05:20:00+00:00" }, result: { ok: false } } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-sync-run"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/sync", {});
  expect(screen.getByTestId("shop-sync")).toHaveTextContent("Abgleich gescheitert");
  expect(screen.getByTestId("shop-sync")).toHaveTextContent("Stand vom");
  expect(toastMock.success).toHaveBeenCalledWith("Printful nicht erreichbar – letzter Stand bleibt.");
});

test("Veröffentlichen geht live: dafür ist der Grund Pflicht, der Knopf sagt es", async () => {
  const items = checkItems().map((item) => (item.key === "mockup" ? { ...item, ok: true, state: "ok" } : item));
  apiMock.get.mockResolvedValue({ data: view({ items, product: { status: "reviewed" }, extra: { transitions: ["active", "draft", "archived"] } }) });
  apiMock.post.mockResolvedValue({ data: view({ items, product: { status: "active" } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-publish"));
  const reason = screen.getByTestId("shop-status-active-reason");
  expect(reason).toHaveAttribute("placeholder", "Grund (Pflicht, kommt ins Protokoll)");
  expect(screen.getByTestId("shop-status-draft-reason")).toHaveAttribute("placeholder", "Grund (optional, kommt ins Protokoll)");
  await user.click(screen.getByTestId("shop-status-active-submit"));
  expect(screen.getByTestId("shop-status-active-hint")).toHaveTextContent("Grund");
  expect(reason).toHaveFocus();
  expect(apiMock.post).not.toHaveBeenCalled();
  await user.type(reason, "Testshirt geht live");
  await user.click(screen.getByTestId("shop-status-active-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/status", { status: "active", reason: "Testshirt geht live" });
});

test("Produktsuche: über den Namen oder einen Dashboard-Link - „Übernehmen“ setzt die Nummer", async () => {
  const CATALOG = {
    results: [{ id: 71, name: "Unisex Classic Tee | Gildan 5000", techniques: ["dtg", "dtfilm"], colors: 50, sizes: 8, image: "https://files.cdn.printful.com/products/71.jpg", is_discontinued: false }],
    total: 1, link: null, categories: [{ id: 1, title: "Men's clothing", depth: 0 }, { id: 24, title: "T-shirts", depth: 1 }],
    fetched_at: "2026-10-27T08:00:00+00:00", stale: false, products_total: 400,
  };
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url === "/admin/shop/printful-catalog" ? CATALOG : view() }));
  apiMock.post.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  const search = await screen.findByTestId("shop-product-search");
  expect(search).toHaveTextContent("Ein Produkt je Modell – Farben und Größen wählst du im nächsten Schritt.");
  await user.type(screen.getByTestId("shop-search-query"), "Gildan 5000");
  await user.click(screen.getByTestId("shop-search-submit"));
  expect(apiMock.get).toHaveBeenCalledWith("/admin/shop/printful-catalog", { params: { q: "Gildan 5000" } });
  const hit = await screen.findByTestId("shop-search-hit-71");
  expect(hit).toHaveTextContent("DTG-Direktdruck, DTF-Transfer (DTFlex) · 50 Farben · 8 Größen");
  expect(screen.getByTestId("shop-search-pick-71")).toHaveTextContent("Gewählt");
  await user.selectOptions(screen.getByTestId("shop-search-category"), "24");
  await user.click(screen.getByTestId("shop-search-submit"));
  expect(apiMock.get).toHaveBeenLastCalledWith("/admin/shop/printful-catalog", { params: { q: "Gildan 5000", category_id: 24 } });
  await user.clear(screen.getByTestId("shop-printful-number"));
  await user.click(screen.getByTestId("shop-search-pick-71"));
  expect(screen.getByTestId("shop-printful-number")).toHaveValue("71");
  const link = "https://www.printful.com/dashboard/custom/mens/shirts/unisex-classic-tee-gildan-5000?technique=DTFILM";
  await user.type(screen.getByTestId("shop-search-link"), link);
  await user.click(screen.getByTestId("shop-search-link-submit"));
  expect(apiMock.get).toHaveBeenLastCalledWith("/admin/shop/printful-catalog", { params: { link } });
});

test("ungespeicherte Ausnahme: die Vorschau fragt den Server nach der Fassung und ist bis dahin ausgegraut", async () => {
  const drafted = view().placements.map((row) => ({ key: row.key, files: row.files.map((state) => (state.color !== "White" ? state : {
    ...state, plan: { layers: [{ index: 0, kind: "motif", source: { design_key: "loewe-schwarz", variant: "light", version: 3 }, image_path: "/api/shop/print-files/k9/loewe-schwarz-v3.png", aspect: 1.25 }] },
  })) }));
  let answer;
  apiMock.post.mockImplementation((url) => (url.endsWith("/layout/preview") ? new Promise((resolve) => { answer = () => resolve({ data: { placements: drafted } }); }) : Promise.resolve({ data: view() })));
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-preview-color-White"));
  await user.click(screen.getByTestId("shop-layer-front-0-exceptions-toggle"));
  await user.selectOptions(screen.getByTestId("shop-layer-front-0-exception-White"), "loewe-schwarz");
  expect(screen.getByTestId("shop-preview-front")).toHaveAttribute("data-stale", "true");
  // Nur die Ebenen sind gedimmt - das Shirt nie (#2105): Schwarz bleibt schwarz.
  expect(screen.getByTestId("shop-preview-front").className).not.toContain("opacity-50");
  expect(screen.getByTestId("shop-preview-front-layer-0").className).toContain("opacity-50");
  expect(screen.getByTestId("shop-layout-draft-preview")).toHaveTextContent("Vorschau wird berechnet");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/products/p1/layout/preview", expect.objectContaining({
    placements: expect.arrayContaining([expect.objectContaining({ key: "front", layers: expect.arrayContaining([expect.objectContaining({ motif: { key: "loewe-weiss", by_color: { White: "loewe-schwarz" } } })]) })]),
  })));
  answer();
  await waitFor(() => expect(screen.getByTestId("shop-preview-front")).not.toHaveAttribute("data-stale"));
  const image = screen.getByTestId("shop-preview-front-layer-0");
  expect(image.querySelector("img").getAttribute("src")).toContain("loewe-schwarz-v3");
  // Seitenverhältnis der Fassung vom Server (1,25): der Rahmen ist höher als breit.
  expect(parseFloat(image.style.height) * 2400).toBeGreaterThan(parseFloat(image.style.width) * 1800);
});

test("ohne Berechnung (blockiert) wird nichts gedimmt, nur der Hinweis steht da (#2105)", async () => {
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-layer-front-1-remove"));
  await user.click(screen.getByTestId("shop-layer-front-0-remove"));
  expect(screen.getByTestId("shop-layout-draft-preview")).toHaveTextContent("Vorschau nach dem Speichern");
  expect(screen.getByTestId("shop-preview-front")).not.toHaveAttribute("data-stale");
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("nicht abbildbare alte Platzierungen: rote Meldung, Produkt nicht bestellbar", async () => {
  apiMock.get.mockResolvedValue({ data: view({ extra: { layout_converted: true, layout_blocked: ["„Ärmel links“ bleibt unverändert: die Fläche sleeve_left hat keine Druckvorgabe bei Printful."] } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  const box = screen.getByTestId("shop-layout-blocked");
  expect(box).toHaveTextContent("Nicht bestellbar");
  expect(box).toHaveTextContent("Ärmel links");
  expect(box.className).toContain("text-live");
});

test("ein übernommener alter Stand der Druckvorlage ist sichtbar eine Warnung (#2091)", async () => {
  const warning = "Printful liefert unvollständig, es gilt weiter der letzte vollständige Stand (seit 2026-10-27): Rückseite (dtg).";
  const base = view();
  const items = checkItems();
  items.splice(1, 0, { key: "template", label: "Druckvorlage von Printful", ok: true, state: "warn", detail: warning, for_review: true });
  apiMock.get.mockResolvedValue({ data: view({ items, extra: {
    print_template: { ...base.print_template, warning, carried: [{ placement: "back", technique: "dtg", label: "Rückseite (dtg)", carried_since: "2026-10-27T05:20:00+00:00" }] },
    sync: { ...base.sync, detail: `4 Varianten abgeglichen. Druckvorlage: ${warning}`, warning },
  } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  expect(await screen.findByTestId("shop-sync")).toHaveTextContent("Druckvorlage: Printful liefert unvollständig");
  expect(screen.getByTestId("shop-sync").querySelector("[data-state='warn']")).not.toBeNull();
  await user.click(screen.getByTestId("shop-step-publish"));
  expect(screen.getByTestId("shop-check-template")).toHaveAttribute("data-state", "warn");
  expect(within(screen.getByTestId("shop-check-template")).getByLabelText("Warnung")).toBeInTheDocument();
  await user.click(screen.getByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-template-carried")).toHaveTextContent("Rückseite (dtg)");
});

test("ohne Vorlagenbild bleibt die Fläche wählbar, mit Hinweis; übersprungene Zeilen stehen darüber (#2091)", async () => {
  const skipped = "Vorlagenbild back (dtg): Feld image_url fehlt oder passt nicht (erwartet: https-Adresse des Vorlagenbilds; ohne sie bleibt die Vorschau ohne Bild).";
  const base = view();
  apiMock.get.mockResolvedValue({ data: view({ extra: { print_template: { ...base.print_template, skipped: [skipped] } } }) });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-layout-technique")).toHaveTextContent("Flächen für DTG-Direktdruck");
  expect(screen.getByTestId("shop-template-skipped")).toHaveTextContent("Feld image_url");
  expect(screen.queryByTestId("shop-preview-front-no-image")).toBeNull();
  await user.click(screen.getByTestId("shop-area-use-back"));
  expect(screen.getByTestId("shop-preview-back")).toBeInTheDocument();
  expect(screen.getByTestId("shop-preview-back-no-image")).toHaveTextContent("Kein Vorlagenbild von Printful");
  expect(screen.getByTestId("shop-area-add-motif-back")).toBeEnabled();
});
