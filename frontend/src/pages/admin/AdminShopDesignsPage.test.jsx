import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Designs und Druckdateien (#1708): Liste mit Vorschau, Version, Prüfsumme, Maßen in Zoll und cm, Ampel und
// Shirtfarben; Upload, Farben und Druckbereiche nur mit Grund. Erfundene Daten, keine echten Vereinsbilder.

const apiMock = { get: vi.fn(), patch: vi.fn(), put: vi.fn() };
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

const { default: AdminShopDesignsPage, inches } = await import("./AdminShopDesignsPage");

const SHA = "3f9a0c21b7d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7";
const PLACEMENTS = [
  { key: "front_right", label: "Brust rechts (vom Träger aus) – Löwe", print_width_in: 3.5, area_width_in: 5, area_height_in: 5, min_dpi: 300,
    print_width: "3,5 Zoll (8,9 cm)", area_width: "5 Zoll (12,7 cm)", area_height: "5 Zoll (12,7 cm)", min_width_px: 1050, is_default: true },
  { key: "back", label: "Rücken", print_width_in: 10, area_width_in: 12, area_height_in: 16, min_dpi: 300,
    print_width: "10 Zoll (25,4 cm)", area_width: "12 Zoll (30,5 cm)", area_height: "16 Zoll (40,6 cm)", min_width_px: 3000, is_default: true },
];

function version(number, overrides = {}) {
  return {
    version: number, sha256: SHA, sha256_short: SHA.slice(0, 12), placement: "front_right", created_at: "2026-10-27T09:00:00+00:00",
    created_by: "kassier", width_px: 1200, height_px: 1200, has_alpha: true, size_bytes: 5000, source_format: "PNG", dpi: 342.9,
    print_width_in: 3.5, print_height_in: 3.5, min_dpi: 300, public: true,
    public_path: `/api/shop/print-files/${"x".repeat(43)}/loewe-weiss-v${number}.png`,
    public_url: `https://lsw.example/api/shop/print-files/${"x".repeat(43)}/loewe-weiss-v${number}.png`,
    file_name: `loewe-weiss-v${number}.png`, check: { dpi: 342.9, level: "snug", text: "Knapp: 342 DPI bei 3,5 Zoll (8,9 cm), nötig sind 300." },
    print_size: "3,5 × 3,5 Zoll (8,9 × 8,9 cm)", ...overrides,
  };
}

function view({ designs } = {}) {
  const versions = [version(2), version(1, { check: { dpi: 300, level: "good", text: "Gut" } })];
  return {
    designs: designs ?? [{ design_key: "loewe-weiss", title: "Löwe weiß", placement: "front_right", placement_label: PLACEMENTS[0].label,
      garment_colors: ["Schwarz", "Navy"], note: null, latest: versions[0], versions }],
    placements: PLACEMENTS,
    limits: { max_mb: 50, formats: ["PNG", "JPG"], max_colors: 20, min_inches: 0.5, max_inches: 25, min_dpi: 72, max_dpi: 600 },
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

test("Maße stehen immer in Zoll und cm", () => {
  expect(inches(3.5)).toBe("3,5 Zoll (8,9 cm)");
  expect(inches(12)).toBe("12 Zoll (30,5 cm)");
});

test("zeigt Designs mit Vorschau auf Karo, Version, kurzer Prüfsumme, Maßen, Ampel und Farben", async () => {
  show();
  const card = await screen.findByTestId("shop-design-loewe-weiss");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/shop/designs");
  const latest = within(card).getByTestId("shop-design-loewe-weiss-latest");
  expect(latest).toHaveTextContent("v2");
  expect(latest).toHaveTextContent("3f9a0c21b7d4…");
  expect(latest).toHaveTextContent("3,5 × 3,5 Zoll (8,9 × 8,9 cm)");
  expect(within(card).getByTestId("shop-design-loewe-weiss-light")).toHaveTextContent("Knapp · 342 DPI");
  expect(within(card).getAllByTestId("shop-design-color").map((chip) => chip.textContent)).toEqual(["Schwarz", "Navy"]);
  const preview = within(card).getByTestId("shop-design-preview");
  expect(preview).toHaveAttribute("data-backdrop", "checker");
  expect(within(preview).getByRole("img")).toHaveAttribute("src", expect.stringContaining("/loewe-weiss-v2.png"));
  // Versionsverlauf mit der alten Version und ihrer Datei.
  expect(within(card).getByTestId("shop-design-loewe-weiss-v1")).toHaveTextContent("loewe-weiss-v1.png");
  expect(screen.getByTestId("shop-tab-designs")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("shop-placement-front_right")).toHaveTextContent("3,5 Zoll (8,9 cm)");
});

test("der Hintergrund der Vorschau wechselt auf dunkles und helles Shirt", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByTestId("shop-design-loewe-weiss");
  await user.click(screen.getByTestId("shop-design-backdrop-dark"));
  expect(screen.getByTestId("shop-design-preview")).toHaveClass("bg-black");
  expect(screen.getByTestId("shop-design-preview")).toHaveAttribute("data-backdrop", "dark");
  await user.click(screen.getByTestId("shop-design-backdrop-light"));
  expect(screen.getByTestId("shop-design-preview")).toHaveClass("bg-white");
});

test("eine neue Version hochladen braucht Datei und Grund und schickt nur Datei, Kennung und Grund", async () => {
  uploadApiMock.post.mockResolvedValue({ data: { ...view(), uploaded: { design_key: "loewe-weiss", version: 3, sha256: SHA, warnings: ["Kein durchsichtiger Hintergrund."] } } });
  const user = userEvent.setup();
  show();
  await screen.findByTestId("shop-design-upload");
  const submit = screen.getByTestId("shop-design-submit");
  expect(submit).toBeDisabled();
  const file = new File([new Uint8Array([137, 80, 78, 71])], "loewe.png", { type: "image/png" });
  await user.upload(screen.getByTestId("shop-design-file"), file);
  expect(submit).toBeDisabled();
  await user.type(screen.getByTestId("shop-design-reason"), "Linien dicker");
  expect(submit).toBeEnabled();
  await user.click(submit);
  expect(uploadApiMock.post).toHaveBeenCalledTimes(1);
  const [url, form] = uploadApiMock.post.mock.calls[0];
  expect(url).toBe("/admin/shop/designs/upload");
  expect(form.get("file")).toBe(file);
  expect([form.get("design_key"), form.get("reason"), form.get("title"), form.get("placement")]).toEqual(["loewe-weiss", "Linien dicker", null, null]);
  expect(toastMock.success).toHaveBeenCalledWith("Version 3 von loewe-weiss gespeichert.");
  expect(toastMock.warning).toHaveBeenCalledWith("Kein durchsichtiger Hintergrund.");
});

test("ein neues Design braucht Kennung, Titel und Platzierung, Farben gehen mit", async () => {
  apiMock.get.mockResolvedValue({ data: view({ designs: [] }) });
  uploadApiMock.post.mockResolvedValue({ data: { ...view(), uploaded: { design_key: "logo-ruecken", version: 1, sha256: SHA, warnings: [] } } });
  const user = userEvent.setup();
  show();
  expect(await screen.findByTestId("shop-designs-empty")).toBeInTheDocument();
  expect(screen.getByTestId("shop-design-mode-new")).toHaveAttribute("aria-checked", "true");
  await user.type(screen.getByTestId("shop-design-key"), "logo-ruecken");
  await user.selectOptions(screen.getByTestId("shop-design-placement"), "back");
  await user.type(screen.getByTestId("shop-design-colors"), "Schwarz, Navy");
  await user.upload(screen.getByTestId("shop-design-file"), new File(["x"], "logo.png", { type: "image/png" }));
  await user.type(screen.getByTestId("shop-design-reason"), "Rückenlogo");
  expect(screen.getByTestId("shop-design-submit")).toBeDisabled();
  await user.type(screen.getByTestId("shop-design-title"), "Rückenlogo groß");
  await user.click(screen.getByTestId("shop-design-submit"));
  const form = uploadApiMock.post.mock.calls[0][1];
  expect([form.get("design_key"), form.get("title"), form.get("placement"), form.get("garment_colors")])
    .toEqual(["logo-ruecken", "Rückenlogo groß", "back", "Schwarz, Navy"]);
});

test("eine Ablehnung des Servers erscheint als Fehler mit seinem Text", async () => {
  const detail = "Zu wenig Auflösung: bei 3,5 Zoll (8,9 cm) Breite hat die Datei nur 85 DPI, nötig sind 300.";
  uploadApiMock.post.mockRejectedValue({ response: { status: 400, data: { detail } } });
  const user = userEvent.setup();
  show();
  await user.upload(await screen.findByTestId("shop-design-file"), new File(["x"], "klein.png", { type: "image/png" }));
  await user.type(screen.getByTestId("shop-design-reason"), "Test");
  await user.click(screen.getByTestId("shop-design-submit"));
  expect(toastMock.error).toHaveBeenCalledWith(detail);
});

test("Farben ändern schickt die Liste mit Grund", async () => {
  apiMock.patch.mockResolvedValue({ data: view() });
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByTestId("shop-design-loewe-weiss-colors-edit"));
  const input = screen.getByTestId("shop-design-loewe-weiss-colors");
  expect(input).toHaveValue("Schwarz, Navy");
  await user.clear(input);
  await user.type(input, "Schwarz,  Anthrazit ,");
  await user.type(screen.getByTestId("shop-design-loewe-weiss-colors-reason"), "Anthrazit dazu");
  await user.click(screen.getByTestId("shop-design-loewe-weiss-colors-save"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/shop/designs/loewe-weiss", { garment_colors: ["Schwarz", "Anthrazit"], reason: "Anthrazit dazu" });
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
  expect(save).toBeDisabled();
  await user.type(screen.getByTestId("shop-placement-front_right-reason"), "Löwe größer");
  await user.click(save);
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/designs/placements/front_right", {
    print_width_in: 4.5, area_width_in: 5, area_height_in: 5, min_dpi: 300, reason: "Löwe größer",
  });
});
