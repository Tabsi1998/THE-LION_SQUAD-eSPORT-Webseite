import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Motive (#1708, #2069): je Motiv die Vorschau auf dunklem und hellem Shirt, Hauptdatei mit Format („echtes
// Vektor-SVG“), Farben, Maßen und Ampel, der Zustand für helle Shirts, Ausnahmen je Farbe und die Versionen. Upload per
// Ziehen oder Klicken (SVG, PNG, JPG) mit Fassung, Ablehnungen des Servers mit seinem Text am Formular, Ersatzfarbe und
// Schwelle. Der Grund ist überall optional. Erfundene Daten, keine echten Vereinsbilder.

const apiMock = { get: vi.fn(), patch: vi.fn(), put: vi.fn(), post: vi.fn() };
const uploadApiMock = { post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  uploadApi: uploadApiMock,
  formatRequestError: (failure, fallback) => failure?.response?.data?.detail || fallback,
  resolveMediaUrl: (url) => `https://test.example${url}`,
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminShopDesignsPage, inches, luminance } = await import("./AdminShopDesignsPage");

const SHA = "3f9a0c21b7d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7";
const PLACEMENTS = [
  { key: "front_right", label: "Brust rechts (vom Träger aus) – Löwe", print_width_in: 3.5, area_width_in: 5, area_height_in: 5, min_dpi: 300,
    print_width: "3,5 Zoll (8,9 cm)", area_width: "5 Zoll (12,7 cm)", area_height: "5 Zoll (12,7 cm)", min_width_px: 1050, is_default: true },
  { key: "back", label: "Rücken", print_width_in: 10, area_width_in: 12, area_height_in: 16, min_dpi: 300,
    print_width: "10 Zoll (25,4 cm)", area_width: "12 Zoll (30,5 cm)", area_height: "16 Zoll (40,6 cm)", min_width_px: 3000, is_default: true },
];
const SETTINGS = {
  light_ink: "#111111", threshold: 0.18, replaced_color: "#ffffff", is_default: true,
  defaults: { light_ink: "#111111", threshold: 0.18 }, limits: { min_threshold: 0.02, max_threshold: 0.9 },
};

function version(number, overrides = {}) {
  return {
    version: number, sha256: SHA, sha256_short: SHA.slice(0, 12), placement: "front_right", created_at: "2026-10-27T09:00:00+00:00",
    created_by: "kassier", width_px: 1260, height_px: 1260, has_alpha: true, size_bytes: 5000, source_format: "SVG", dpi: 360,
    print_width_in: 3.5, print_height_in: 3.5, min_dpi: 300, public: true, variant: "dark", origin: "upload", derived_from: null,
    is_vector: true, colors: ["#27aae1", "#ffffff"], aspect_ratio: 1,
    public_path: `/api/shop/print-files/${"x".repeat(43)}/loewe-v${number}.png`,
    public_url: `https://lsw.example/api/shop/print-files/${"x".repeat(43)}/loewe-v${number}.png`,
    file_name: `loewe-v${number}.png`, check: { dpi: 360, level: "good", text: "Gut: 360 DPI bei 3,5 Zoll (8,9 cm)." },
    print_size: "3,5 × 3,5 Zoll (8,9 × 8,9 cm)", ...overrides,
  };
}

function motif(overrides = {}) {
  const dark = version(1);
  const light = version(2, { variant: "light", origin: "auto_light", derived_from: 1, colors: ["#111111", "#27aae1"] });
  return {
    design_key: "loewe", title: "Löwe", placement: "front_right", placement_label: PLACEMENTS[0].label, garment_colors: [],
    note: null, light_mode: "auto", color_variants: [], latest: dark,
    light: { state: "auto", version: 2, hint: "Automatisch: Weiß wird #111111, alle anderen Farben bleiben.", latest: light },
    versions: [light, dark], ...overrides,
  };
}

function view({ designs } = {}) {
  return {
    designs: designs ?? [motif()],
    placements: PLACEMENTS,
    motif_settings: SETTINGS,
    limits: { max_mb: 50, svg_max_mb: 2, formats: ["SVG", "PNG", "JPG"], max_colors: 20, max_exceptions: 40, min_inches: 0.5, max_inches: 25, min_dpi: 72, max_dpi: 600 },
  };
}

function show() {
  return render(<MemoryRouter initialEntries={["/admin/shop/designs"]}><AdminShopDesignsPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: view() });
  // jsdom lädt keine Bilder: die Vorschau-Prüfung im Browser bleibt hier stumm, entscheiden tut ohnehin der Server.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

test("Maße in Zoll und cm, Helligkeit wie im Server", () => {
  expect(inches(3.5)).toBe("3,5 Zoll (8,9 cm)");
  expect(inches(12)).toBe("12 Zoll (30,5 cm)");
  expect(luminance("#000000")).toBe(0);
  expect(luminance("#ffffff")).toBeCloseTo(1);
  expect(luminance("kein Wert")).toBeNull();
});

test("ein Motiv zeigt beide Shirts nebeneinander, Format, Farben, Maße, Ampel und den Zustand für helle Shirts", async () => {
  show();
  const card = await screen.findByTestId("shop-design-loewe");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/shop/designs");
  expect(screen.getByTestId("shop-tab-motive")).toHaveAttribute("aria-current", "page");

  const onDark = within(card).getByTestId("shop-motif-loewe-on-dark");
  const onLight = within(card).getByTestId("shop-motif-loewe-on-light");
  expect(onDark).toHaveClass("bg-black");
  expect(onLight).toHaveClass("bg-silver");
  expect(within(onDark).getByRole("img")).toHaveAttribute("src", expect.stringContaining("/loewe-v1.png"));
  expect(within(onLight).getByRole("img")).toHaveAttribute("src", expect.stringContaining("/loewe-v2.png"));

  expect(within(card).getByTestId("shop-motif-loewe-format")).toHaveTextContent("echtes Vektor-SVG");
  expect(within(card).getAllByTestId("shop-motif-color").map((chip) => chip.textContent)).toEqual(["#27aae1", "#ffffff"]);
  const latest = within(card).getByTestId("shop-design-loewe-latest");
  expect(latest).toHaveTextContent("v1");
  expect(latest).toHaveTextContent("3,5 × 3,5 Zoll (8,9 × 8,9 cm)");
  expect(latest).toHaveTextContent("1260 × 1260 px");
  expect(within(card).getByTestId("shop-design-loewe-check")).toHaveTextContent("Gut · 360 DPI");
  expect(within(card).getByTestId("shop-motif-loewe-light")).toHaveTextContent("Automatisch umgefärbt");
  // Versionsverlauf mit Fassung und Herkunft.
  expect(within(card).getByTestId("shop-design-loewe-v2")).toHaveTextContent("für helle Shirts");
  expect(within(card).getByTestId("shop-design-loewe-v2")).toHaveTextContent("automatisch umgefärbt aus v1");
  expect(screen.getByTestId("shop-placement-front_right")).toHaveTextContent("3,5 Zoll (8,9 cm)");
});

test("fehlt die Fassung für helle Shirts, sagt die Karte warum und bietet eigene Datei bzw. Erzeugen an", async () => {
  const missing = motif({
    latest: version(1, { is_vector: false, source_format: "JPG", colors: [], has_alpha: false }),
    light: { state: "missing", version: null, latest: null, hint: "Bitte eine eigene Datei für helle Shirts hochladen: das PNG hat keinen durchsichtigen Hintergrund." },
  });
  apiMock.get.mockResolvedValue({ data: view({ designs: [missing] }) });
  apiMock.post.mockResolvedValue({ data: { ...view(), light: { state: "missing" } } });
  const user = userEvent.setup();
  show();
  const card = await screen.findByTestId("shop-design-loewe");
  expect(within(card).getByTestId("shop-motif-loewe-format")).toHaveTextContent("JPG (Pixel)");
  expect(within(card).getByTestId("shop-motif-loewe-light")).toHaveTextContent("Fehlt");
  expect(within(card).getByTestId("shop-motif-loewe-light")).toHaveTextContent("eigene Datei für helle Shirts");
  expect(within(within(card).getByTestId("shop-motif-loewe-on-light")).queryByRole("img")).toBeNull();
  await user.click(within(card).getByTestId("shop-motif-loewe-auto-submit"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/designs/loewe/light-auto", { reason: "" });

  // „Eigene Datei für helle Shirts“ stellt das Formular auf das Motiv und die Fassung.
  await user.click(within(card).getByTestId("shop-motif-loewe-new-light"));
  expect(screen.getByTestId("shop-design-variant-light")).toHaveAttribute("aria-checked", "true");
});

test("eine eigene Datei für helle Shirts hochladen: Fassung light, Datei, Grund optional", async () => {
  uploadApiMock.post.mockResolvedValue({ data: { ...view(), uploaded: { design_key: "loewe", version: 3, variant: "light", sha256: SHA, warnings: [] } } });
  const user = userEvent.setup();
  show();
  await screen.findByTestId("shop-design-upload");
  const submit = screen.getByTestId("shop-design-submit");
  expect(submit).toBeDisabled();
  await user.click(screen.getByTestId("shop-design-variant-light"));
  const file = new File(["<svg/>"], "loewe-hell.svg", { type: "image/svg+xml" });
  await user.upload(screen.getByTestId("shop-design-file"), file);
  expect(screen.getByTestId("shop-design-dropzone")).toHaveTextContent("loewe-hell.svg");
  expect(screen.getByTestId("shop-design-precheck")).toHaveTextContent("streng");
  expect(submit).toBeEnabled();
  await user.click(submit);
  const [url, form] = uploadApiMock.post.mock.calls[0];
  expect(url).toBe("/admin/shop/designs/upload");
  expect([form.get("file"), form.get("design_key"), form.get("variant"), form.get("reason"), form.get("title")])
    .toEqual([file, "loewe", "light", "", null]);
  expect(toastMock.success).toHaveBeenCalledWith("Version 3 von loewe gespeichert.");
});

test("Ziehen und Loslassen nimmt die Datei", async () => {
  show();
  const zone = await screen.findByTestId("shop-design-dropzone");
  const file = new File(["png"], "loewe.png", { type: "image/png" });
  fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
  expect(zone).toHaveAttribute("data-over", "true");
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  expect(zone).toHaveAttribute("data-over", "false");
  expect(zone).toHaveTextContent("loewe.png");
  expect(screen.getByTestId("shop-design-submit")).toBeEnabled();
});

test("ein neues Motiv braucht Kennung, Titel und Platzierung; feste Farben sind freiwillig", async () => {
  apiMock.get.mockResolvedValue({ data: view({ designs: [] }) });
  uploadApiMock.post.mockResolvedValue({ data: { ...view(), uploaded: { design_key: "logo-ruecken", version: 1, sha256: SHA, warnings: [] } } });
  const user = userEvent.setup();
  show();
  expect(await screen.findByTestId("shop-designs-empty")).toBeInTheDocument();
  expect(screen.getByTestId("shop-design-mode-new")).toHaveAttribute("aria-checked", "true");
  await user.type(screen.getByTestId("shop-design-key"), "logo-ruecken");
  await user.selectOptions(screen.getByTestId("shop-design-placement"), "back");
  await user.upload(screen.getByTestId("shop-design-file"), new File(["x"], "logo.svg", { type: "image/svg+xml" }));
  expect(screen.getByTestId("shop-design-submit")).toBeDisabled();
  await user.type(screen.getByTestId("shop-design-title"), "Rückenlogo groß");
  await user.click(screen.getByTestId("shop-design-submit"));
  const form = uploadApiMock.post.mock.calls[0][1];
  expect([form.get("design_key"), form.get("title"), form.get("placement"), form.get("variant"), form.get("garment_colors")])
    .toEqual(["logo-ruecken", "Rückenlogo groß", "back", "dark", null]);
});

test("ein abgelehntes SVG zeigt den Text des Servers am Formular - was genau gefunden wurde", async () => {
  const detail = "Kein echtes Vektor-SVG – enthält ein Pixelbild. Außerdem gefunden: eingebettete Daten (data:). Bitte als reine Vektorgrafik neu exportieren.";
  uploadApiMock.post.mockRejectedValue({ response: { status: 400, data: { detail } } });
  const user = userEvent.setup();
  show();
  await user.upload(await screen.findByTestId("shop-design-file"), new File(["x"], "logo.svg", { type: "image/svg+xml" }));
  await user.click(screen.getByTestId("shop-design-submit"));
  expect(toastMock.error).toHaveBeenCalledWith(detail);
  expect(screen.getByTestId("shop-design-upload-error")).toHaveTextContent("Kein echtes Vektor-SVG – enthält ein Pixelbild.");
  expect(screen.getByTestId("shop-design-upload-error")).toHaveAttribute("role", "alert");
  // Eine neue Datei nimmt die Meldung weg.
  await user.upload(screen.getByTestId("shop-design-file"), new File(["y"], "neu.svg", { type: "image/svg+xml" }));
  expect(screen.queryByTestId("shop-design-upload-error")).toBeNull();
});

test("Ausnahmen je Shirtfarbe: hinzufügen, wählen, speichern mit optionalem Grund", async () => {
  apiMock.patch.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByTestId("shop-motif-loewe-exceptions-edit"));
  await user.click(screen.getByTestId("shop-motif-loewe-exceptions-add"));
  await user.type(screen.getByTestId("shop-motif-loewe-exceptions-color-0"), " Navy ");
  await user.selectOptions(screen.getByTestId("shop-motif-loewe-exceptions-variant-0"), "dark");
  await user.click(screen.getByTestId("shop-motif-loewe-exceptions-add"));
  await user.click(screen.getByTestId("shop-motif-loewe-exceptions-save-submit"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/shop/designs/loewe", { color_variants: [{ color: "Navy", variant: "dark" }], reason: "" });
});

test("feste Farben ändern schickt die Liste mit Grund", async () => {
  apiMock.get.mockResolvedValue({ data: view({ designs: [motif({ garment_colors: ["Schwarz", "Navy"] })] }) });
  apiMock.patch.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show();
  const card = await screen.findByTestId("shop-design-loewe");
  expect(within(card).getAllByTestId("shop-design-color").map((chip) => chip.textContent)).toEqual(["Schwarz", "Navy"]);
  await user.click(screen.getByTestId("shop-design-loewe-colors-edit"));
  const input = screen.getByTestId("shop-design-loewe-colors");
  expect(input).toHaveValue("Schwarz, Navy");
  await user.clear(input);
  await user.type(input, "Schwarz,  Anthrazit ,");
  await user.type(screen.getByTestId("shop-design-loewe-colors-reason"), "Anthrazit dazu");
  await user.click(screen.getByTestId("shop-design-loewe-colors-save"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/shop/designs/loewe", { garment_colors: ["Schwarz", "Anthrazit"], reason: "Anthrazit dazu" });
});

test("Ersatzfarbe und Schwelle: Beispiele folgen der Schwelle, Speichern schickt beides", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show();
  const samples = await screen.findByTestId("shop-motif-samples");
  const variantOf = (name) => within(samples).getByText(new RegExp(`^${name} →`)).getAttribute("data-variant");
  expect([variantOf("Schwarz"), variantOf("Navy"), variantOf("Grau meliert"), variantOf("Weiß")]).toEqual(["dark", "dark", "light", "light"]);
  const threshold = screen.getByTestId("shop-motif-threshold");
  await user.clear(threshold);
  await user.type(threshold, "0,5");
  expect(variantOf("Grau meliert")).toBe("dark");
  const ink = screen.getByTestId("shop-motif-ink");
  await user.clear(ink);
  await user.type(ink, "#0A2540");
  await user.type(screen.getByTestId("shop-motif-settings-save-reason"), "Vereins-Dunkelblau");
  await user.click(screen.getByTestId("shop-motif-settings-save-submit"));
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/designs/motif-settings", { light_ink: "#0a2540", threshold: 0.5, reason: "Vereins-Dunkelblau" });
});

test("Weiß als Ersatzfarbe geht nicht - der Knopf sagt warum", async () => {
  const user = userEvent.setup();
  show();
  const ink = await screen.findByTestId("shop-motif-ink");
  await user.clear(ink);
  await user.type(ink, "#ffffff");
  await user.click(screen.getByTestId("shop-motif-settings-save-submit"));
  expect(apiMock.put).not.toHaveBeenCalled();
  expect(screen.getByTestId("shop-motif-settings-save-hint")).toHaveTextContent("nicht Weiß");
});

test("einen Druckbereich ändern zeigt cm mit und schickt Zoll mit Grund", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByTestId("shop-placement-front_right-edit"));
  const width = screen.getByTestId("shop-placement-front_right-print_width_in");
  await user.clear(width);
  await user.type(width, "6");
  expect(screen.getByTestId("shop-placement-front_right-invalid")).toBeInTheDocument();
  await user.clear(width);
  await user.type(width, "4,5");
  expect(screen.getByTestId("shop-placement-front_right")).toHaveTextContent("= 11,4 cm");
  expect(screen.getByTestId("shop-placement-front_right")).toHaveTextContent("nötig: 1350 px Breite");
  const save = screen.getByTestId("shop-placement-front_right-save");
  expect(save).toBeEnabled();
  await user.type(screen.getByTestId("shop-placement-front_right-reason"), "Löwe größer");
  await user.click(save);
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/designs/placements/front_right", {
    print_width_in: 4.5, area_width_in: 5, area_height_in: 5, min_dpi: 300, reason: "Löwe größer",
  });
});
