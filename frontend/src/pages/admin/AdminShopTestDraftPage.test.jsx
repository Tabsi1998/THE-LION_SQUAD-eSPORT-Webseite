import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Testentwurf an Printful (#2062): geführte Schritte Produkt → Variante → Gamertag → Anschrift → Vorschau → Senden,
// Ergebnis mit Auftragsnummer, Dashboard-Link und Abweichungen (Ampel), Löschen mit Bestätigung in der Seite, kein
// Bestätigen. Erfundene Daten: Testverein, Testshirt, Testname.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (failure, fallback) => failure?.response?.data?.detail || fallback,
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminShopTestDraftPage, euro } = await import("./AdminShopTestDraftPage");

const SHA = "9c1e0a21b7d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7";
const ADDRESS = { name: "Testverein Löwen", street: "Vereinsgasse 1", street2: "", zip: "6020", city: "Innsbruck", country: "AT" };
const VARIANTS = [
  { id: "v-sm", label: "Schwarz / M", size: "M", color: "Black", printful_variant_id: 4012, price_cents: 1500, in_stock: true },
  { id: "v-wm", label: "Weiß / M", size: "M", color: "White", printful_variant_id: 4014, price_cents: 1500, in_stock: true },
  { id: "v-wl", label: "Weiß / L", size: "L", color: "White", printful_variant_id: 4015, price_cents: 1500, in_stock: false },
];

function overview(overrides = {}) {
  return {
    access: { allowed: true, problems: [], stage: "admins", stage_label: "Nur Admins (Test)", key_state: "ok", orders_to_printful: false },
    products: [{ id: "p1", title: "Vereinsshirt Test", status: "draft", status_label: "Entwurf", printful_name: "Gildan 5000", gamertag: true, variants: VARIANTS }],
    address: { address: ADDRESS, complete: true, hint: null },
    gamertag: { allowed_text: "Buchstaben A–Z, Ziffern 0–9", min_length: 2, max_length: 16 },
    limits: { preview_minutes: 60, max_open: 5 }, drafts: [], mockup: "Mockup folgt (#1710).",
    ...overrides,
  };
}

const PREVIEW = {
  id: "td-1", kind: "test_draft", state: "preview", external_id: "lsw-test-td-1", product_title: "Vereinsshirt Test",
  variant_label: "Weiß / M", printful_variant_id: 4014, recipient: ADDRESS, expires_at: "2026-10-27T11:00:00+00:00",
  files: [
    { placement: "front", technique: "dtg", kind: "personal", version: null, sha256: SHA, width_px: 1800, height_px: 2400, dpi: 150, url: "https://lsw.example.test/api/shop/print-files/x/druck-1.png" },
    { placement: "back", technique: "dtg", kind: "base", version: 1, sha256: SHA, width_px: 1800, height_px: 2400, dpi: 150, url: "https://lsw.example.test/api/shop/print-files/y/hinten-v1.png" },
  ],
  estimate: { subtotal_cents: 1500, shipping_cents: 495, vat_cents: 399, tax_cents: 0, total_cents: 2394 },
  estimate_error: null, price_check: { shop_cents: 1500, printful_subtotal_cents: 1500, level: "ok" },
  mockup: { state: "pending", detail: "Mockup folgt (#1710)." }, warnings: [], payload: {},
};

const SENT = {
  ...PREVIEW, state: "sent", state_label: "Entwurf bei Printful", printful_order_id: 9001, printful_status: "draft",
  sent_at: "2026-10-27T10:05:00+00:00", dashboard_url: "https://www.printful.com/dashboard/default/orders?search=9001",
  deviations: [
    { label: "Externe Kennung", sent: "lsw-test-td-1", printful: "lsw-test-td-1", level: "ok" },
    { label: "Position 1: Printful-Variante", sent: 4014, printful: 4015, level: "error" },
    { label: "Preis: Versand (Schätzung → Auftrag)", sent: 495, printful: 595, level: "warn" },
  ],
  deviation_summary: { ok: 1, warn: 1, error: 1 },
};

function show() {
  return render(<MemoryRouter initialEntries={["/admin/shop/test-draft"]}><AdminShopTestDraftPage /></MemoryRouter>);
}

async function fillUntilPreview() {
  await userEvent.selectOptions(await screen.findByTestId("shop-test-draft-product-select"), "p1");
  await userEvent.click(screen.getByTestId("shop-test-draft-color-White"));
  await userEvent.click(screen.getByTestId("shop-test-draft-size-M"));
  await userEvent.type(screen.getByTestId("shop-test-draft-gamertag-input"), "Testname");
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: overview() });
});

test("Beträge in Euro", () => {
  expect(euro(1995)).toBe("19,95 €");
  expect(euro(5)).toBe("0,05 €");
  expect(euro(null)).toBe("–");
});

test("führt Schritt für Schritt bis zur Vorschau - Vereinsadresse vorbelegt, Daten genau wie gesendet", async () => {
  apiMock.post.mockResolvedValue({ data: PREVIEW });
  show();
  expect(await screen.findByTestId("shop-test-draft-switch")).toHaveTextContent("Entwürfe gehen trotzdem");
  expect(screen.queryByTestId("shop-test-draft-variant")).toBeNull();
  await fillUntilPreview();
  // Größe L ist nicht lieferbar gemeldet - sie bleibt wählbar, mit Warnzeichen.
  expect(within(screen.getByTestId("shop-test-draft-size-L")).getByLabelText("nicht als lieferbar gemeldet")).toBeInTheDocument();
  expect(screen.getByTestId("shop-test-draft-address-name")).toHaveValue("Testverein Löwen");
  expect(screen.getByTestId("shop-test-draft-address-city")).toHaveValue("Innsbruck");
  await userEvent.click(screen.getByTestId("shop-test-draft-preview-button"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/test-drafts/preview", {
    product_id: "p1", variant_id: "v-wm", gamertag: "Testname", address: ADDRESS,
  }));
  const preview = await screen.findByTestId("shop-test-draft-preview");
  expect(preview).toHaveTextContent("lsw-test-td-1");
  expect(within(screen.getByTestId("shop-test-draft-files")).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByTestId("shop-test-draft-files")).toHaveTextContent(`sha256 ${SHA}`);
  expect(screen.getByTestId("shop-test-draft-files")).toHaveTextContent("mit Gamertag (eigene Datei)");
  expect(screen.getByTestId("shop-test-draft-estimate")).toHaveTextContent("23,94 €");
  expect(screen.getByTestId("shop-test-draft-mockup")).toHaveTextContent("Mockup folgt (#1710).");
  expect(screen.getByTestId("shop-test-draft-steps")).toHaveAttribute("aria-label", "Schritt 5 von 6: Vorschau");
  expect(screen.queryByText(/bestätigen$/i)).toBeNull();
});

test("senden mit Idempotenzschlüssel, Ergebnis mit Nummer, Dashboard-Link und Ampel, dann löschen mit Bestätigung", async () => {
  apiMock.post.mockImplementation(async (url) => {
    if (url.endsWith("/preview")) return { data: PREVIEW };
    if (url.endsWith("/send")) return { data: SENT };
    return { data: { ...SENT, state: "deleted", state_label: "gelöscht", dashboard_url: null } };
  });
  show();
  await fillUntilPreview();
  await userEvent.click(screen.getByTestId("shop-test-draft-preview-button"));
  const sendButton = await screen.findByTestId("shop-test-draft-send");
  await userEvent.click(sendButton);
  const sent = await screen.findByTestId("shop-test-draft-sent");
  const [url, body] = apiMock.post.mock.calls.find(([path]) => path.endsWith("/send"));
  expect(url).toBe("/admin/shop/test-drafts/td-1/send");
  expect(body.idempotency_key).toMatch(/^testentwurf-.{8,}/);
  expect(within(sent).getByTestId("shop-test-draft-result-order-id")).toHaveTextContent("9001");
  expect(within(sent).getByTestId("shop-test-draft-result-dashboard")).toHaveAttribute("href", SENT.dashboard_url);
  const rows = within(sent).getAllByTestId("shop-test-draft-deviation");
  expect(rows.map((row) => row.dataset.level)).toEqual(["ok", "error", "warn"]);
  expect(rows[2]).toHaveTextContent("gesendet: 4,95 € · Printful: 5,95 €");
  expect(within(sent).getByText("falsch übergeben", { selector: "span[data-level] *, span[data-level]" })).toBeInTheDocument();
  expect(toastMock.success).toHaveBeenCalledWith("Als Entwurf an Printful gesendet (Auftrag 9001).");

  await userEvent.click(within(sent).getByTestId("shop-test-draft-result-delete"));
  expect(within(sent).getByTestId("shop-test-draft-result-confirm")).toHaveTextContent("9001");
  expect(apiMock.post).not.toHaveBeenCalledWith("/admin/shop/test-drafts/td-1/delete");
  await userEvent.click(within(sent).getByTestId("shop-test-draft-result-confirm-yes"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/test-drafts/td-1/delete"));
  await waitFor(() => expect(within(screen.getByTestId("shop-test-draft-sent")).queryByTestId("shop-test-draft-result-dashboard")).toBeNull());
  expect(apiMock.post.mock.calls.some(([path]) => /confirm/.test(path))).toBe(false);
});

test("eine Änderung an der Eingabe verwirft die Vorschau", async () => {
  apiMock.post.mockResolvedValue({ data: PREVIEW });
  show();
  await fillUntilPreview();
  await userEvent.click(screen.getByTestId("shop-test-draft-preview-button"));
  await screen.findByTestId("shop-test-draft-preview");
  await userEvent.type(screen.getByTestId("shop-test-draft-address-street2"), "Top 2");
  expect(screen.queryByTestId("shop-test-draft-preview")).toBeNull();
});

test("Ablehnung des Servers steht verständlich da, ohne Stufe und Schlüssel ist nichts sendbar", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Emojis und Symbole gehen im Druck nicht." } } });
  show();
  await fillUntilPreview();
  await userEvent.click(screen.getByTestId("shop-test-draft-preview-button"));
  expect(await screen.findByTestId("shop-test-draft-refused")).toHaveTextContent("Emojis und Symbole");

  apiMock.get.mockResolvedValue({ data: overview({ access: { allowed: false, problems: ["Der Shop steht auf „Aus“."], orders_to_printful: false } }) });
  const { unmount } = show();
  expect((await screen.findAllByTestId("shop-test-draft-blocked")).at(-1)).toHaveTextContent("steht auf „Aus“");
  unmount();
});

test("nach abgelehntem Senden holt die Seite den Stand neu und zeigt die Ursache an der Vorschau", async () => {
  apiMock.post.mockImplementation(async (url) => {
    if (url.endsWith("/preview")) return { data: PREVIEW };
    throw { response: { data: { detail: "Printful: Der Anbieter lehnt die Daten ab (400). Einzelheiten stehen im Protokoll des Testentwurfs." } } };
  });
  show();
  await fillUntilPreview();
  await userEvent.click(screen.getByTestId("shop-test-draft-preview-button"));
  await screen.findByTestId("shop-test-draft-send");
  apiMock.get.mockResolvedValueOnce({ data: { ...PREVIEW, last_error: { reason: "bad_request", text: "Der Anbieter lehnt die Daten ab", provider_detail: "Variant 4014 not found" } } });
  await userEvent.click(screen.getByTestId("shop-test-draft-send"));
  expect(await screen.findByTestId("shop-test-draft-preview-error")).toHaveTextContent("Der Anbieter lehnt die Daten ab (Printful: Variant 4014 not found)");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/shop/test-drafts/td-1");
  expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("lehnt die Daten ab"));
});

test("unklarer Ausgang: Ergebnis mit „Erneut senden / nachsehen“ und „Löschen“ (Server sieht nach)", async () => {
  const UNCLEAR = { ...PREVIEW, state: "unclear", state_label: "Ausgang unklar - erneut senden", printful_order_id: null,
    last_error: { reason: "timeout", text: "Der Anbieter antwortet nicht (Zeitüberschreitung)" }, actions: { resend: true, delete: true } };
  let sends = 0;
  apiMock.post.mockImplementation(async (url) => {
    if (url.endsWith("/preview")) return { data: PREVIEW };
    sends += 1;
    if (sends === 1) throw { response: { status: 503, data: { detail: "Printful: Der Anbieter antwortet nicht (Zeitüberschreitung). Bitte gleich noch einmal versuchen." } } };
    return { data: { ...SENT, actions: { resend: false, delete: true } } };
  });
  show();
  await fillUntilPreview();
  await userEvent.click(screen.getByTestId("shop-test-draft-preview-button"));
  apiMock.get.mockResolvedValueOnce({ data: UNCLEAR });
  await userEvent.click(await screen.findByTestId("shop-test-draft-send"));
  const result = await screen.findByTestId("shop-test-draft-result");
  expect(result).toHaveTextContent("Ausgang unklar");
  expect(within(result).getByTestId("shop-test-draft-result-last-error")).toHaveTextContent("Zeitüberschreitung");
  // Löschen geht auch ohne erneutes Senden (etwa bei Stufe „Aus“): der Server sieht bei Printful nach.
  await userEvent.click(within(result).getByTestId("shop-test-draft-result-delete"));
  expect(within(result).getByTestId("shop-test-draft-result-confirm")).toHaveTextContent("Bei Printful nachsehen und den Entwurf");
  await userEvent.click(within(result).getByRole("button", { name: "Abbrechen" }));
  await userEvent.click(within(result).getByTestId("shop-test-draft-result-resend"));
  await waitFor(() => expect(within(screen.getByTestId("shop-test-draft-result")).getByTestId("shop-test-draft-result-order-id")).toHaveTextContent("9001"));
  const keys = apiMock.post.mock.calls.filter(([path]) => path.endsWith("/send")).map(([, body]) => body.idempotency_key);
  expect(keys).toHaveLength(2);
  expect(screen.getByTestId("shop-test-draft-result-delete")).toBeInTheDocument();
});

test("die Shop-Reiter wischen in ihrer Leiste, ohne Abstand unter der Unterstreichung", async () => {
  show();
  const tabs = await screen.findByTestId("shop-tabs");
  expect(tabs).toHaveClass("tls-swipe", "pb-0");
  expect(screen.getByTestId("shop-tab-testentwurf")).toHaveAttribute("aria-current", "page");
});

test("eine unvollständige Vereinsadresse zeigt den Hinweis und sperrt die Vorschau", async () => {
  apiMock.get.mockResolvedValue({ data: overview({ address: { address: { ...ADDRESS, street: "" }, complete: false, hint: "Die Vereinsadresse ist nicht vollständig." } }) });
  show();
  await fillUntilPreview();
  expect(screen.getByTestId("shop-test-draft-address-hint")).toHaveTextContent("nicht vollständig");
  expect(screen.getByTestId("shop-test-draft-preview-button")).toBeDisabled();
  await userEvent.type(screen.getByTestId("shop-test-draft-address-street"), "Vereinsgasse 1");
  expect(screen.getByTestId("shop-test-draft-preview-button")).toBeEnabled();
});

test("bisherige Testentwürfe mit Printful-Nummer und Dashboard-Link", async () => {
  apiMock.get.mockResolvedValue({ data: overview({ drafts: [{ ...SENT, id: "td-0", created_at: "2026-10-26T10:00:00+00:00" }] }) });
  show();
  const item = await screen.findByTestId("shop-test-draft-item-td-0");
  expect(within(item).getByTestId("shop-test-draft-item-td-0-result-order-id")).toHaveTextContent("9001");
  expect(within(item).getByTestId("shop-test-draft-item-td-0-result-dashboard")).toHaveAttribute("href", SENT.dashboard_url);
});

test("zeigt einen verständlichen Fehler, wenn nichts geladen werden kann", async () => {
  apiMock.get.mockRejectedValue({ response: { data: { detail: "Zwei-Faktor nötig." } } });
  show();
  expect(await screen.findByTestId("shop-test-draft-error")).toHaveTextContent("Zwei-Faktor nötig.");
});
