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
  pair_aspect_tolerance: 0.02, pair_min_overlap: 0.9, pair_contrast_share: 0.03, pair_position_tolerance: 0.03,
  defaults: { light_ink: "#111111", threshold: 0.18, pair_aspect_tolerance: 0.02, pair_min_overlap: 0.9, pair_contrast_share: 0.03, pair_position_tolerance: 0.03 },
  limits: {
    min_threshold: 0.02, max_threshold: 0.9,
    pair_aspect_tolerance_min: 0.005, pair_aspect_tolerance_max: 0.2, pair_min_overlap_min: 0.5, pair_min_overlap_max: 0.99,
    pair_contrast_share_min: 0.001, pair_contrast_share_max: 0.5, pair_position_tolerance_min: 0.005, pair_position_tolerance_max: 0.3,
  },
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

// ---------------------------------------------------------------- Paar (#2084)

const PREVIEW = "data:image/png;base64,iVBORw0KGgo=";

function report(level = "green", overrides = {}) {
  const checks = {
    green: [
      { key: "aspect", level: "green", text: "Gleiches Format (Seitenverhältnis 1,20)." },
      { key: "overlap", level: "green", text: "Die Umrisse passen (Überdeckung 99 %)." },
      { key: "contrast_light", level: "green", text: "Kontrast auf hellen Shirts ok." },
      { key: "contrast_dark", level: "green", text: "Kontrast auf dunklen Shirts ok." },
    ],
    yellow: [
      { key: "aspect", level: "green", text: "Gleiches Format (Seitenverhältnis 1,20)." },
      { key: "overlap", level: "green", text: "Die Umrisse passen (Überdeckung 99 %)." },
      { key: "contrast_light", level: "yellow", text: "Die Fassung für helle Shirts enthält Weiß bzw. sehr Helles (50 % der Fläche) – das verschwindet auf hellen Shirts." },
    ],
    red: [
      { key: "aspect", level: "red", text: "Die beiden Dateien haben unterschiedliche Formate: 1,20 zu 1,35 – bitte gleiche Zeichenfläche verwenden." },
    ],
  }[level];
  const summary = checks.filter((item) => item.level === level).map((item) => item.text).join(" ") || "Das Paar passt.";
  return {
    level, checks, summary: level === "green" ? "Das Paar passt." : summary, swapped: false, suggest_swap: false,
    files: { dark: { name: "auf-schwarz.svg" }, light: { name: "auf-weiss.svg" } },
    previews: { dark: PREVIEW, light: PREVIEW }, marks: { dark: null, light: level === "yellow" ? PREVIEW : null },
    ...overrides,
  };
}

const ON_BLACK = () => new File(["<svg/>"], "auf-schwarz.svg", { type: "image/svg+xml" });
const ON_WHITE = () => new File(["<svg/>"], "auf-weiss.svg", { type: "image/svg+xml" });

function callsTo(route) {
  return uploadApiMock.post.mock.calls.filter(([url]) => url === `/admin/shop/designs/${route}`);
}

async function pairMode(user) {
  await user.click(await screen.findByTestId("shop-design-shape-pair"));
  expect(screen.getByTestId("shop-pair-fields")).toBeInTheDocument();
  expect(screen.queryByTestId("shop-design-variant-light")).toBeNull();
}

test("Paar: zwei Felder, die Prüfung läuft von selbst, Ampel grün, Vorschau auf beiden Shirts, Speichern schickt beide", async () => {
  const saved = { ...view(), uploaded_pair: { design_key: "loewe", dark_version: 3, light_version: 4, warnings: [], pair: report() } };
  uploadApiMock.post.mockImplementation(async (url) => (url.endsWith("/pair-check") ? { data: report() } : { data: saved }));
  const user = userEvent.setup();
  show();
  await pairMode(user);
  const submit = screen.getByTestId("shop-design-submit");
  expect(submit).toHaveTextContent("Paar speichern");
  expect(submit).toBeDisabled();
  const dark = ON_BLACK();
  const light = ON_WHITE();
  await user.upload(screen.getByTestId("shop-pair-dark-file"), dark);
  expect(callsTo("pair-check")).toHaveLength(0);
  await user.upload(screen.getByTestId("shop-pair-light-file"), light);

  expect(await screen.findByTestId("shop-pair-report")).toHaveAttribute("data-level", "green");
  const [[, check]] = callsTo("pair-check");
  expect([check.get("file_dark"), check.get("file_light"), check.get("design_key"), check.get("auto_assign"), check.get("placement")])
    .toEqual([dark, light, "loewe", "false", null]);
  expect(screen.getByTestId("shop-pair-light")).toHaveTextContent("Passt");
  expect(screen.getByTestId("shop-pair-on-dark")).toHaveClass("bg-black");
  expect(screen.getByTestId("shop-pair-on-light")).toHaveClass("bg-silver");
  expect(within(screen.getByTestId("shop-pair-on-dark")).getByRole("img")).toHaveAttribute("src", PREVIEW);

  await user.type(screen.getByTestId("shop-design-reason"), "Neues Logo");
  await user.click(submit);
  const [[, form]] = callsTo("upload-pair");
  expect([form.get("file_dark"), form.get("file_light"), form.get("design_key"), form.get("confirm_warnings"), form.get("reason")])
    .toEqual([dark, light, "loewe", "false", "Neues Logo"]);
  expect(toastMock.success).toHaveBeenCalledWith("Paar von loewe gespeichert: Version 3 für dunkle, Version 4 für helle Shirts.");
  expect(screen.queryByTestId("shop-pair-report")).toBeNull();
});

test("Paar: beide Dateien auf einmal - der Server ordnet zu, Tauschen dreht es und prüft neu", async () => {
  uploadApiMock.post.mockResolvedValueOnce({ data: report("green", { swapped: true }) })
    .mockResolvedValueOnce({ data: report("yellow", { suggest_swap: true }) });
  const user = userEvent.setup();
  show();
  await pairMode(user);
  const light = ON_WHITE();
  const dark = ON_BLACK();
  fireEvent.drop(screen.getByTestId("shop-pair-dark-dropzone"), { dataTransfer: { files: [light, dark] } });

  expect(await screen.findByTestId("shop-pair-report")).toHaveAttribute("data-level", "green");
  expect(callsTo("pair-check")[0][1].get("auto_assign")).toBe("true");
  expect(callsTo("pair-check")[0][1].get("file_dark")).toBe(light);
  // Die Felder zeigen die Zuordnung des Servers - ohne zweite Prüfung.
  expect(screen.getByTestId("shop-pair-dark-dropzone")).toHaveTextContent("auf-schwarz.svg");
  expect(screen.getByTestId("shop-pair-light-dropzone")).toHaveTextContent("auf-weiss.svg");
  expect(screen.getByTestId("shop-pair-assignment")).toHaveTextContent("Automatisch zugeordnet");
  expect(callsTo("pair-check")).toHaveLength(1);

  await user.click(screen.getByTestId("shop-pair-swap"));
  expect(await screen.findByTestId("shop-pair-report")).toHaveAttribute("data-level", "yellow");
  const [, second] = callsTo("pair-check");
  expect([second[1].get("file_dark"), second[1].get("file_light"), second[1].get("auto_assign")]).toEqual([light, dark, "false"]);
  expect(screen.getByTestId("shop-pair-dark-dropzone")).toHaveTextContent("auf-weiss.svg");
  expect(screen.getByTestId("shop-pair-assignment")).toHaveTextContent("wirken vertauscht");
});

test("Paar: Gelb markiert die Stellen und fragt im Seitenlayout nach, bevor gespeichert wird", async () => {
  const confirmSpy = vi.spyOn(window, "confirm");
  uploadApiMock.post.mockImplementation(async (url) => (url.endsWith("/pair-check")
    ? { data: report("yellow") }
    : { data: { ...view(), uploaded_pair: { design_key: "loewe", dark_version: 3, light_version: 4, warnings: ["Weiß verschwindet"], pair: report("yellow") } } }));
  const user = userEvent.setup();
  show();
  await pairMode(user);
  await user.upload(screen.getByTestId("shop-pair-dark-file"), ON_BLACK());
  await user.upload(screen.getByTestId("shop-pair-light-file"), ON_WHITE());
  expect(await screen.findByTestId("shop-pair-light")).toHaveTextContent("Bitte prüfen");
  expect(screen.getByTestId("shop-pair-check-contrast_light")).toHaveAttribute("data-level", "yellow");
  expect(screen.getByTestId("shop-pair-on-light-mark")).toHaveAttribute("src", PREVIEW);
  expect(screen.queryByTestId("shop-pair-on-dark-mark")).toBeNull();

  await user.click(screen.getByTestId("shop-design-submit"));
  const dialog = screen.getByTestId("shop-pair-confirm");
  expect(dialog).toHaveAttribute("role", "alertdialog");
  expect(dialog).toHaveFocus();
  expect(dialog).toHaveTextContent("verschwindet auf hellen Shirts");
  expect(callsTo("upload-pair")).toHaveLength(0);
  expect(confirmSpy).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("shop-pair-confirm-no"));
  expect(screen.queryByTestId("shop-pair-confirm")).toBeNull();
  expect(screen.getByTestId("shop-design-submit")).toHaveFocus();

  await user.click(screen.getByTestId("shop-design-submit"));
  await user.click(screen.getByTestId("shop-pair-confirm-yes"));
  const [[, form]] = callsTo("upload-pair");
  expect(form.get("confirm_warnings")).toBe("true");
  expect(toastMock.warning).toHaveBeenCalledWith("Weiß verschwindet");
});

test("Paar: Rot sperrt das Speichern; eine Ablehnung des Servers zeigt ihren Bericht", async () => {
  uploadApiMock.post.mockResolvedValueOnce({ data: report("red") });
  const user = userEvent.setup();
  show();
  await pairMode(user);
  await user.upload(screen.getByTestId("shop-pair-dark-file"), ON_BLACK());
  await user.upload(screen.getByTestId("shop-pair-light-file"), ON_WHITE());
  expect(await screen.findByTestId("shop-pair-light")).toHaveTextContent("Abgelehnt");
  expect(screen.getByTestId("shop-pair-report")).toHaveTextContent("1,20 zu 1,35");
  expect(screen.getByTestId("shop-design-submit")).toBeDisabled();
  expect(screen.getByTestId("shop-pair-blocked")).toBeInTheDocument();

  // Ein bösartiges SVG lehnt schon die Prüfung ab - mit dem Text des Servers.
  const detail = "Datei für helle Shirts (boese.svg): Gefunden: Skript.";
  uploadApiMock.post.mockRejectedValueOnce({ response: { status: 400, data: { detail } } });
  await user.upload(screen.getByTestId("shop-pair-light-file"), new File(["<svg/>"], "boese.svg", { type: "image/svg+xml" }));
  expect(await screen.findByTestId("shop-pair-error")).toHaveTextContent(detail);
  expect(screen.getByTestId("shop-design-submit")).toBeDisabled();
  // „Erneut prüfen“ (etwa nach „zu viele Versuche“) schickt dieselben Dateien noch einmal.
  uploadApiMock.post.mockResolvedValueOnce({ data: report() });
  await user.click(screen.getByTestId("shop-pair-retry"));
  expect(await screen.findByTestId("shop-pair-report")).toHaveAttribute("data-level", "green");
  expect(callsTo("pair-check")).toHaveLength(3);
  expect(screen.getByTestId("shop-design-submit")).toBeEnabled();
});

test("Paar für ein neues Motiv schickt Platzierung zur Prüfung und Titel beim Speichern", async () => {
  apiMock.get.mockResolvedValue({ data: view({ designs: [] }) });
  uploadApiMock.post.mockImplementation(async (url) => (url.endsWith("/pair-check") ? { data: report() } : { data: { ...view(), uploaded_pair: { design_key: "neu", dark_version: 1, light_version: 2, warnings: [], pair: report() } } }));
  const user = userEvent.setup();
  show();
  await pairMode(user);
  await user.type(screen.getByTestId("shop-design-key"), "neu");
  await user.type(screen.getByTestId("shop-design-title"), "Neues Logo");
  fireEvent.drop(screen.getByTestId("shop-pair-light-dropzone"), { dataTransfer: { files: [ON_BLACK(), ON_WHITE()] } });
  await screen.findByTestId("shop-pair-report");
  const [[, check]] = callsTo("pair-check");
  expect([check.get("placement"), check.get("design_key")]).toEqual(["front_right", null]);
  await user.click(screen.getByTestId("shop-design-submit"));
  const [[, form]] = callsTo("upload-pair");
  expect([form.get("design_key"), form.get("title"), form.get("placement")]).toEqual(["neu", "Neues Logo", "front_right"]);
});

test("Paar: eine Kennung tippen, während die Prüfung läuft, lässt sie nicht hängen", async () => {
  apiMock.get.mockResolvedValue({ data: view({ designs: [] }) });
  let answer;
  uploadApiMock.post.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
  const user = userEvent.setup();
  show();
  await pairMode(user);
  fireEvent.drop(screen.getByTestId("shop-pair-dark-dropzone"), { dataTransfer: { files: [ON_BLACK(), ON_WHITE()] } });
  expect(await screen.findByTestId("shop-pair-checking")).toBeInTheDocument();
  await user.type(screen.getByTestId("shop-design-key"), "neu");
  answer({ data: report() });
  expect(await screen.findByTestId("shop-pair-report")).toHaveAttribute("data-level", "green");
  expect(callsTo("pair-check")).toHaveLength(1);
});

test("Paar: ein Fehler beim Speichern bringt den Fokus zurück auf „Paar speichern“", async () => {
  uploadApiMock.post.mockImplementation(async (url) => {
    if (url.endsWith("/pair-check")) return { data: report() };
    throw { response: { status: 409, data: { detail: "Für dieses Motiv läuft gerade ein Upload." } } };
  });
  const user = userEvent.setup();
  show();
  await pairMode(user);
  await user.upload(screen.getByTestId("shop-pair-dark-file"), ON_BLACK());
  await user.upload(screen.getByTestId("shop-pair-light-file"), ON_WHITE());
  await screen.findByTestId("shop-pair-report");
  await user.click(screen.getByTestId("shop-design-submit"));
  expect(await screen.findByTestId("shop-design-upload-error")).toHaveTextContent("läuft gerade ein Upload");
  expect(screen.getByTestId("shop-design-submit")).toHaveFocus();
});

test("Paar: sagt erst der Server beim Speichern „Gelb“ (409 mit Bericht), fragt die Seite nach und bestätigt dann", async () => {
  const yellow = report("yellow");
  uploadApiMock.post.mockImplementation(async (url, form) => {
    if (url.endsWith("/pair-check")) return { data: report() };
    if (form.get("confirm_warnings") !== "true") {
      throw { response: { status: 409, data: { detail: `Bitte bestätigen: ${yellow.summary}`, pair: yellow } } };
    }
    return { data: { ...view(), uploaded_pair: { design_key: "loewe", dark_version: 3, light_version: 4, warnings: [], pair: yellow } } };
  });
  const user = userEvent.setup();
  show();
  await pairMode(user);
  await user.upload(screen.getByTestId("shop-pair-dark-file"), ON_BLACK());
  await user.upload(screen.getByTestId("shop-pair-light-file"), ON_WHITE());
  expect(await screen.findByTestId("shop-pair-report")).toHaveAttribute("data-level", "green");
  await user.click(screen.getByTestId("shop-design-submit"));
  expect(await screen.findByTestId("shop-pair-confirm")).toHaveTextContent("verschwindet auf hellen Shirts");
  expect(screen.getByTestId("shop-pair-report")).toHaveAttribute("data-level", "yellow");
  expect(toastMock.error).not.toHaveBeenCalled();
  expect(screen.queryByTestId("shop-design-upload-error")).toBeNull();
  await user.click(screen.getByTestId("shop-pair-confirm-yes"));
  const sent = callsTo("upload-pair").map(([, form]) => form.get("confirm_warnings"));
  expect(sent).toEqual(["false", "true"]);
  expect(toastMock.success).toHaveBeenCalledWith("Paar von loewe gespeichert: Version 3 für dunkle, Version 4 für helle Shirts.");
});

test("Paar: eine neue Datei bricht die laufende Prüfung ab", async () => {
  uploadApiMock.post.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce({ data: report() });
  const user = userEvent.setup();
  show();
  await pairMode(user);
  await user.upload(screen.getByTestId("shop-pair-dark-file"), ON_BLACK());
  await user.upload(screen.getByTestId("shop-pair-light-file"), ON_WHITE());
  await screen.findByTestId("shop-pair-checking");
  const [, , first] = callsTo("pair-check")[0];
  expect(first.signal.aborted).toBe(false);
  await user.upload(screen.getByTestId("shop-pair-light-file"), new File(["<svg/>"], "neu.svg", { type: "image/svg+xml" }));
  expect(first.signal.aborted).toBe(true);
  expect(await screen.findByTestId("shop-pair-report")).toHaveAttribute("data-level", "green");
  expect(callsTo("pair-check")[1][2].signal.aborted).toBe(false);
});

test("Paar: ohne durchsichtigen Hintergrund sagt die Prüfung, dass die Zuordnung unsicher ist", async () => {
  uploadApiMock.post.mockResolvedValue({ data: report("green", { assign_uncertain: true, suggest_swap: true }) });
  const user = userEvent.setup();
  show();
  await pairMode(user);
  fireEvent.drop(screen.getByTestId("shop-pair-light-dropzone"), { dataTransfer: { files: [ON_BLACK(), ON_WHITE()] } });
  expect(await screen.findByTestId("shop-pair-uncertain")).toHaveTextContent("Zuordnung unsicher – bitte prüfen");
  expect(screen.getByTestId("shop-pair-assignment")).not.toHaveTextContent("wirken vertauscht");
});

test("„Als Paar ersetzen“ an der Karte stellt das Formular auf Paar und Motiv", async () => {
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByTestId("shop-motif-loewe-new-pair"));
  expect(screen.getByTestId("shop-design-shape-pair")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("shop-design-select")).toHaveValue("loewe");
});

test("ist nur eine Fassung ersetzt, fragt die Karte nach der anderen und belegt den Upload-Kasten vor", async () => {
  const stale = motif({
    light_mode: "file", latest: version(3),
    light: { state: "file", version: 2, hint: "Eigene Datei für helle Shirts.", latest: version(2, { variant: "light", pair_of: 1 }) },
    pair_stale: true,
    pair: { stale: true, dark_version: 3, light_version: 2, outdated: "light", hint: "…" },
  });
  apiMock.get.mockResolvedValue({ data: view({ designs: [motif({ design_key: "adler", title: "Adler" }), stale] }) });
  const user = userEvent.setup();
  show();
  const hint = await screen.findByTestId("shop-motif-loewe-pair-stale");
  expect(hint).toHaveTextContent("die andere (für helle Shirts) ist noch Version 2 – auch ersetzen?");
  expect(screen.queryByTestId("shop-motif-adler-pair-stale")).toBeNull();
  await user.click(screen.getByTestId("shop-design-variant-dark"));
  await user.click(within(hint).getByTestId("shop-motif-loewe-pair-stale-replace"));
  expect(screen.getByTestId("shop-design-shape-single")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("shop-design-variant-light")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("shop-design-select")).toHaveValue("loewe");
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

test("die Schwellen der Paar-Prüfung stehen in Prozent und gehen als Anteil an den Server - nur geänderte", async () => {
  apiMock.put.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show();
  const overlap = await screen.findByTestId("shop-motif-pair_min_overlap");
  expect(overlap).toHaveValue("90");
  expect(screen.getByTestId("shop-motif-pair_aspect_tolerance")).toHaveValue("2");
  expect(screen.getByTestId("shop-motif-pair-settings")).toHaveTextContent("Vorgabe 3 %, erlaubt 0,1 bis 50 %.");
  await user.clear(overlap);
  await user.type(overlap, "100");
  await user.click(screen.getByTestId("shop-motif-settings-save-submit"));
  expect(apiMock.put).not.toHaveBeenCalled();
  expect(screen.getByTestId("shop-motif-settings-save-hint")).toHaveTextContent("von 50 bis 99");
  await user.clear(overlap);
  await user.type(overlap, "85,5");
  await user.click(screen.getByTestId("shop-motif-settings-save-submit"));
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/designs/motif-settings", { light_ink: "#111111", threshold: 0.18, pair_min_overlap: 0.855, reason: "" });
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
