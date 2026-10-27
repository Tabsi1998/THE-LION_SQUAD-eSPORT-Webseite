import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Gamertag-Druckdatei (#1711): Test-Gamertag mit Live-Vorschau auf dunklem und hellem Shirt, Maße in Zoll und cm, DPI,
// Hinweis bei Verkleinerung und Ablehnung; Testdatei und Regeln nur mit Grund. Erfundene Namen, keine echten Gamertags.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (failure, fallback) => failure?.response?.data?.detail || fallback,
  resolveMediaUrl: (url) => `https://test.example${url}`,
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminShopGamertagPage, inches } = await import("./AdminShopGamertagPage");

const SHA = "9c1e0a21b7d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7";
const RULES = {
  font: "rajdhani-700", height_mode: "cap", text_height_in: 0.5, min_text_height_in: 0.4, max_width_in: 3.5, dpi: 300,
  align: "center", placement: "front_left", min_length: 2, max_length: 16, allowed_chars: " -._ÄÖÜßäöü", block_flagged: true,
  colors: [
    { key: "vereinsblau", label: "Vereinsblau", hex: "#29B6E8", garment_colors: [] },
    { key: "weiss", label: "Weiß", hex: "#FFFFFF", garment_colors: ["Schwarz"] },
  ],
  default_color: "vereinsblau",
};

function view(overrides = {}) {
  return {
    rules: RULES, defaults: RULES, allowed_text: "Buchstaben A–Z, Ziffern 0–9, Leerzeichen und - . _ Ä Ö Ü ß ä ö ü",
    fonts: [{ key: "rajdhani-700", label: "Rajdhani Bold", license: "SIL Open Font License 1.1 (OFL-Rajdhani.txt)" },
      { key: "outfit-800", label: "Outfit ExtraBold", license: "SIL Open Font License 1.1 (OFL-Outfit.txt)" }],
    height_modes: [{ key: "cap", label: "Höhe der Großbuchstaben" }, { key: "font", label: "Schriftgröße" }],
    aligns: [{ key: "center", label: "mittig" }, { key: "left", label: "links" }, { key: "right", label: "rechts" }],
    placements: [], placement: { key: "front_left", label: "Brust links (vom Träger aus) – Namensfeld", area_width: "5 Zoll (12,7 cm)", area_height: "5 Zoll (12,7 cm)" },
    canvas: { width_px: 1050, height_px: 296, dpi: 300, size: "3,5 Zoll (8,9 cm) × 0,99 Zoll (2,5 cm)", anchor_y_in: 0.493 },
    limits: {}, test_files: [], ...overrides,
  };
}

function preview(overrides = {}) {
  return {
    text: "Testname", image: "data:image/png;base64,iVBORw0KGgo=", sha256: SHA, warnings: [],
    meta: {
      width_px: 1050, height_px: 296, dpi: 300, scaled: false, notice: null, anchor_y_in: 0.493, color_hex: "#29B6E8",
      measures: { text_height: "0,5 Zoll (1,3 cm)", text_width: "3,16 Zoll (8 cm)", max_width: "3,5 Zoll (8,9 cm)", canvas: "3,5 Zoll (8,9 cm) × 0,99 Zoll (2,5 cm)" },
    },
    ...overrides,
  };
}

function show() {
  return render(<MemoryRouter initialEntries={["/admin/shop/gamertag"]}><AdminShopGamertagPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: view() });
});

test("Maße stehen in Zoll und cm", () => {
  expect(inches(0.5)).toBe("0,5 Zoll (1,3 cm)");
  expect(inches(0.4)).toBe("0,4 Zoll (1 cm)");
});

test("Live-Vorschau zeigt die Druckdatei auf dunklem und hellem Shirt mit Maßen und DPI", async () => {
  apiMock.post.mockResolvedValue({ data: preview() });
  show();
  await userEvent.type(await screen.findByTestId("shop-gamertag-text"), "Testname");
  const measures = await screen.findByTestId("shop-gamertag-measures");
  expect(apiMock.post).toHaveBeenLastCalledWith("/admin/shop/gamertag/preview", { text: "Testname", color: "vereinsblau" });
  // Nach dem Tippen genau eine Anfrage: die Vorschau wartet, bis Ruhe ist.
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(measures).toHaveTextContent("0,5 Zoll (1,3 cm)");
  expect(measures).toHaveTextContent("1050 × 296 px · 300 DPI");
  expect(measures).toHaveTextContent("0,49 Zoll (1,3 cm) von oben");
  for (const shirt of ["dark", "light"]) {
    const figure = screen.getByTestId(`shop-gamertag-shirt-${shirt}`);
    expect(within(figure).getByRole("img")).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
  }
  expect(screen.getByTestId("shop-gamertag-shirt-dark").firstChild).toHaveClass("bg-black");
  expect(screen.getByTestId("shop-gamertag-shirt-light").firstChild).toHaveClass("bg-white");

  await userEvent.click(screen.getByTestId("shop-gamertag-color-weiss"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/admin/shop/gamertag/preview", { text: "Testname", color: "weiss" }));
  expect(screen.getByTestId("shop-gamertag-color-weiss")).toHaveAttribute("aria-checked", "true");
});

test("zeigt den Hinweis bei Verkleinerung und die Begründung bei Ablehnung", async () => {
  apiMock.post.mockResolvedValueOnce({ data: preview({ meta: { ...preview().meta, scaled: true, notice: "Auf 0,43 Zoll (1,1 cm) Texthöhe verkleinert, damit der Name in 3,5 Zoll (8,9 cm) passt." } }) });
  show();
  const field = await screen.findByTestId("shop-gamertag-text");
  await userEvent.type(field, "TestnameAB");
  expect(await screen.findByTestId("shop-gamertag-notice")).toHaveTextContent("verkleinert");

  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Der Name ist zu breit: auch bei 0,4 Zoll (1 cm) Texthöhe …" } } });
  await userEvent.clear(field);
  await userEvent.type(field, "WWWWWWWWWW");
  expect(await screen.findByTestId("shop-gamertag-refused")).toHaveTextContent("Abgelehnt: Der Name ist zu breit");
  expect(screen.queryByTestId("shop-gamertag-measures")).toBeNull();
  expect(screen.getByTestId("shop-gamertag-save-file")).toBeDisabled();
});

test("eine Testdatei braucht einen Grund und liefert die Adresse für Printful", async () => {
  apiMock.post.mockImplementation(async (url) => {
    if (url.endsWith("/preview")) return { data: preview() };
    return { data: { ...view({ test_files: [{ sha256: SHA, sha256_short: SHA.slice(0, 12), color_hex: "#29B6E8", width_px: 1050, height_px: 296, dpi: 300, scaled: false,
      last_used_at: "2026-10-27T09:00:00+00:00", public_path: `/api/shop/print-files/${"x".repeat(43)}/gamertag-9c1e0a21b7d4e5f6.png`, public_url: null,
      measures: { text_height: "0,5 Zoll (1,3 cm)" } }] }), created: true, changed: [] } };
  });
  show();
  await userEvent.type(await screen.findByTestId("shop-gamertag-text"), "Testname");
  await screen.findByTestId("shop-gamertag-measures");
  const save = screen.getByTestId("shop-gamertag-save-file");
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByTestId("shop-gamertag-file-reason"), "Testentwurf vorbereiten");
  await userEvent.click(save);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/gamertag/test-files", { text: "Testname", color: "vereinsblau", reason: "Testentwurf vorbereiten" }));
  expect(await screen.findByTestId("shop-gamertag-file-9c1e0a21b7d4")).toHaveTextContent("9c1e0a21b7d4…");
  expect(toastMock.success).toHaveBeenCalledWith("Testdatei gespeichert.");
});

test("Regeln speichern nur mit Grund - Zahlen aus dem Formular, Farben je Shirtfarbe", async () => {
  apiMock.put.mockResolvedValue({ data: { ...view(), changed: ["max_length"] } });
  show();
  const save = await screen.findByTestId("shop-gamertag-rules-save");
  expect(save).toBeDisabled();
  const length = screen.getByTestId("shop-gamertag-rule-max_length");
  await userEvent.clear(length);
  await userEvent.type(length, "12");
  const height = screen.getByTestId("shop-gamertag-rule-min_text_height_in");
  await userEvent.clear(height);
  await userEvent.type(height, "0,45");
  await userEvent.type(screen.getByTestId("shop-gamertag-rules-reason"), "Obmann bestätigt");
  await userEvent.click(save);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  const [url, body] = apiMock.put.mock.calls[0];
  expect(url).toBe("/admin/shop/gamertag/rules");
  expect(body).toMatchObject({ max_length: 12, min_text_height_in: 0.45, dpi: 300, reason: "Obmann bestätigt" });
  expect(body.colors[1]).toEqual({ key: "weiss", label: "Weiß", hex: "#FFFFFF", garment_colors: ["Schwarz"] });
  expect(toastMock.success).toHaveBeenCalledWith("Regeln gespeichert.");
});

test("zeigt einen verständlichen Fehler, wenn nichts geladen werden kann", async () => {
  apiMock.get.mockRejectedValue({ response: { data: { detail: "Zwei-Faktor nötig." } } });
  show();
  expect(await screen.findByTestId("shop-gamertag-error")).toHaveTextContent("Zwei-Faktor nötig.");
});
