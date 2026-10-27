import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Produktverwaltung (#1707) mit Katalogabgleich (#1709): Liste und Anlegen, geführte Schritte, Farben und Größen,
// Designs je Platzierung und Farbe, Preise mit Warnung, Prüfen und Veröffentlichen - jede Änderung nur mit Grund.
// Erfundene Daten: Produkt- und Variantennummern, Designs und Personen gibt es so nicht.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (failure, fallback) => failure?.response?.data?.detail || fallback,
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminShopProductsPage, inches } = await import("./AdminShopProductsPage");

const LABELS = {
  statuses: { draft: "Entwurf", reviewed: "geprüft", active: "veröffentlicht", archived: "archiviert" },
  visibilities: { public: "öffentlich (mit Konto)", members: "nur Mitglieder", hidden: "nur intern" },
  personalizations: { none: "keine", gamertag: "Gamertag", member_number: "Vereinsnummer", both: "Gamertag und Vereinsnummer" },
  kinds: { design: "Design des Vereins", gamertag: "Gamertag (Datei je Bestellung, #1711)", member_number: "Vereinsnummer" },
};

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
      { key: "front_right", label: "Brust rechts (vom Träger aus) – Löwe", kind: "design", kind_label: "Design des Vereins", printful_placement: "front",
        position: { left_in: 1.49, top_in: 1, width_in: 3.5, height_in: 3.5 }, position_text: { width: "3,5 Zoll (8,9 cm)" }, included: true, surcharge_cents: 525,
        designs: { Black: { design_key: "loewe-weiss", title: "Löwe weiß", version: 2, level: "good", text: "Gut" } },
        suggestions: { Black: "loewe-weiss", White: "loewe-schwarz" } },
      { key: "front_left", label: "Brust links (vom Träger aus) – Namensfeld", kind: "gamertag", kind_label: "Gamertag (Datei je Bestellung, #1711)", printful_placement: "front",
        position: { left_in: 7, top_in: 1, width_in: 3.5, height_in: 3.5 }, position_text: { width: "3,5 Zoll (8,9 cm)" }, included: true, surcharge_cents: 525, designs: {}, suggestions: {} },
    ],
    available_placements: [
      { key: "front_right", label: "Brust rechts (vom Träger aus) – Löwe", printful_placement: "front", area: { width_in: 12, height_in: 16 },
        area_text: { width_in: "12 Zoll (30,5 cm)", height_in: "16 Zoll (40,6 cm)" }, default_position: { left_in: 1.49, top_in: 1, width_in: 3.5, height_in: 3.5 } },
      { key: "front_left", label: "Brust links (vom Träger aus) – Namensfeld", printful_placement: "front", area: { width_in: 12, height_in: 16 },
        area_text: { width_in: "12 Zoll (30,5 cm)", height_in: "16 Zoll (40,6 cm)" }, default_position: { left_in: 7, top_in: 1, width_in: 3.5, height_in: 3.5 } },
      { key: "back", label: "Rücken", printful_placement: "back", area: { width_in: 12, height_in: 16 },
        area_text: { width_in: "12 Zoll (30,5 cm)", height_in: "16 Zoll (40,6 cm)" }, default_position: { left_in: 1, top_in: 1, width_in: 10, height_in: 10 } },
    ],
    included_placement: "front",
    design_suggestions: [{ placement: "front_right", color: "Black", design_key: "loewe-weiss" }, { placement: "front_right", color: "White", design_key: "loewe-schwarz" }],
    design_options: { front_right: [{ design_key: "loewe-weiss", title: "Löwe weiß" }, { design_key: "loewe-schwarz", title: "Löwe schwarz" }] },
    pricing: { general_markup_cents: 300, product_markup_cents: null, effective_markup_cents: 300, source: "general", member_markup_cents: 0 },
    check: { items, review_ready: items.filter((item) => item.for_review).every((item) => item.ok), publish_ready: items.every((item) => item.ok) },
    sync: { at: "2026-10-27T05:20:00+00:00", ok: true, detail: "4 Varianten abgeglichen.", last_ok_at: "2026-10-27T05:20:00+00:00" },
    transitions: ["reviewed", "archived"],
    editable: true,
    limits: { max_variants: 80, min_size_in: 0.5, max_size_in: 25 },
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

test("ein neues Produkt braucht Titel und Grund; öffentlich sperrt die Personalisierung", async () => {
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
  await user.type(screen.getByTestId("shop-new-reason"), "Testshirt");
  expect(submit).toBeDisabled();
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
    "1.Produkt wählen", "2.Farben und Größen", "3.Designs je Platzierung", "4.Preise", "5.Prüfen und veröffentlichen"]);
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

test("Platzierungen zeigen cm zu den Zoll und schicken Art und Position", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  await user.click(screen.getByTestId("shop-placement-use-back"));
  const width = screen.getByTestId("shop-placement-back-width_in");
  await user.clear(width);
  await user.type(width, "9,5");
  expect(screen.getByTestId("shop-placement-row-back")).toHaveTextContent("= 24,1 cm");
  expect(screen.getByTestId("shop-placement-included-front")).toHaveAttribute("aria-checked", "true");
  await user.type(screen.getByTestId("shop-placements-reason"), "Rückenlogo dazu");
  await user.click(screen.getByTestId("shop-placements-submit"));
  const [url, body] = apiMock.put.mock.calls[0];
  expect(url).toBe("/admin/shop/products/p1/placements");
  expect(body.included_placement).toBe("front");
  expect(body.placements.map((row) => [row.key, row.kind])).toEqual([["front_right", "design"], ["front_left", "gamertag"], ["back", "design"]]);
  expect(body.placements[2].position).toEqual({ left_in: 1, top_in: 1, width_in: 9.5, height_in: 10 });
});

test("Vorschläge übernehmen füllt leere Felder; gespeichert wird nur, was sich ändert", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show("/admin/shop/products/p1");
  await user.click(await screen.findByTestId("shop-step-designs"));
  expect(screen.getByTestId("shop-design-cell-front_right-White")).toHaveValue("");
  expect(screen.getByTestId("shop-designs-placeholders")).toHaveTextContent("Gamertag (Datei je Bestellung, #1711)");
  expect(screen.getByTestId("shop-designs-submit")).toBeDisabled();
  await user.click(screen.getByTestId("shop-designs-suggest"));
  expect(screen.getByTestId("shop-design-cell-front_right-White")).toHaveValue("loewe-schwarz");
  await user.type(screen.getByTestId("shop-designs-reason"), "Vorschläge passen");
  await user.click(screen.getByTestId("shop-designs-submit"));
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/products/p1/designs", {
    assignments: [{ placement: "front_right", color: "White", design_key: "loewe-schwarz" }], reason: "Vorschläge passen",
  });
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
  expect(screen.getByTestId("shop-status-active-submit")).toBeDisabled();
  expect(screen.getByTestId("shop-status-active")).toHaveTextContent("Mockup-Prüfung");
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
  expect(screen.getByTestId("shop-status-reviewed-submit")).toBeDisabled();
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
