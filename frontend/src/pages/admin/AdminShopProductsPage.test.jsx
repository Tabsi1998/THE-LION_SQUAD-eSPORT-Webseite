import { render, screen, waitFor, within } from "@testing-library/react";
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
  });
  expect(screen.getByTestId("shop-variant-PF1")).toHaveTextContent("lieferbar");
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
