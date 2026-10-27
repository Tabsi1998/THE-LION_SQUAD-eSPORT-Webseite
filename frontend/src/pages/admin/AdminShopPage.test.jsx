import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Shop (#1706): Stufe, Notschalter, Preise, Printful-Zugang. Jede Änderung mit Grund; „Öffentlich“ bleibt gesperrt, bis
// die Steuer geklärt ist; der Schlüssel wird nie angezeigt. Erfundene Daten.

const apiMock = { get: vi.fn(), patch: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("./ShopTabs", () => ({ default: () => null })); // Reiter (#1708) stehen in AdminShopDesignsPage.test.jsx

const { default: AdminShopPage } = await import("./AdminShopPage");

const STAGES = [
  { key: "off", label: "Aus", hint: "Niemand sieht den Shop.", locked: false, lock_reason: null },
  { key: "admins", label: "Nur Admins (Test)", hint: "Nur Finanzen und Superadmin.", locked: false, lock_reason: null },
  { key: "members", label: "Vereinsmitglieder", hint: "Aktive Mitglieder.", locked: false, lock_reason: null },
  { key: "public", label: "Öffentlich", hint: "Alle.", locked: true,
    lock_reason: "Erst wenn die Steuer geklärt ist (#1701) – die Freigabe setzt der Superadmin." },
];

function view({ config = {}, rights = {}, stages = STAGES } = {}) {
  return {
    config: {
      stage: "off", stage_label: "Aus", effective_stage: "off", orders_to_printful: false,
      public_markup_cents: 0, member_markup_cents: 0, fallback_shipping_cents: null, min_price_cents: 100, shipping_countries: ["AT"],
      tax_cleared: null, printful_key: { state: "missing", saved_at: null, saved_by: null, detail: null },
      printful_last_test: null, updated_at: null, ...config,
    },
    stages,
    rights: { can_set_public: false, can_set_tax: false, can_edit_access: false, ...rights },
    limits: { public_markup_cents: 10000, fallback_shipping_cents: 10000, min_price_cents: 10000 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: view() });
});

test("zeigt den Status und sperrt „Öffentlich“ mit Hinweis, solange die Steuer nicht geklärt ist", async () => {
  render(<AdminShopPage />);
  expect(await screen.findByTestId("shop-status-stage")).toHaveTextContent("Aus");
  expect(screen.getByTestId("shop-status-switch")).toHaveTextContent("aus");
  expect(screen.getByTestId("shop-status-key")).toHaveTextContent("kein Schlüssel");
  expect(screen.getByTestId("shop-stage-public")).toBeDisabled();
  expect(screen.getByTestId("shop-stage-public-lock")).toHaveTextContent("Steuer geklärt ist");
  expect(screen.getByTestId("shop-member-price")).toHaveTextContent("Selbstkostenpreis");
  expect(screen.getByTestId("shop-countries")).toHaveTextContent("AT");
  // Ohne Superadmin keine Steuer-Freigabe, ohne System kein Zugang - nur der Hinweis.
  expect(screen.queryByTestId("shop-tax-toggle-form")).toBeNull();
  expect(screen.getByTestId("shop-key-system-only")).toBeInTheDocument();
  expect(screen.queryByTestId("shop-key-input")).toBeNull();
});

test("Stufe umstellen geht ohne Grund - der Grund ist optional", async () => {
  apiMock.patch.mockResolvedValue({ data: view({ config: { stage: "admins", stage_label: "Nur Admins (Test)" } }) });
  const user = userEvent.setup();
  render(<AdminShopPage />);
  await user.click(await screen.findByTestId("shop-stage-admins"));
  expect(screen.getByTestId("shop-stage-change")).toHaveTextContent("Von Aus auf Nur Admins (Test)");
  expect(screen.getByTestId("shop-stage-save-reason")).toHaveAttribute("placeholder", "Grund (optional, kommt ins Protokoll)");
  const save = screen.getByTestId("shop-stage-save-submit");
  expect(save).toHaveAttribute("aria-disabled", "false");
  await user.click(save);
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/shop/config", { stage: "admins", reason: "" });
  expect(toastMock.success).toHaveBeenCalledWith("Stufe jetzt: Nur Admins (Test).");
  expect(await screen.findByTestId("shop-status-stage")).toHaveTextContent("Nur Admins (Test)");
});

test("der Notschalter lässt sich ohne Schlüssel nicht einschalten - der Knopf sagt, warum", async () => {
  const user = userEvent.setup();
  render(<AdminShopPage />);
  expect(await screen.findByTestId("shop-switch-needs-key")).toBeInTheDocument();
  const toggle = screen.getByTestId("shop-switch-toggle-submit");
  expect(toggle).toHaveAttribute("aria-disabled", "true");
  await user.type(screen.getByTestId("shop-switch-toggle-reason"), "Test einschalten");
  await user.click(toggle);
  expect(apiMock.patch).not.toHaveBeenCalled();
  expect(screen.getByTestId("shop-switch-toggle-hint")).toHaveTextContent("Erst unten beim Printful-Zugang den Schlüssel hinterlegen.");
  expect(screen.getByTestId("shop-key-test")).toBeDisabled();
});

test("Schlüssel speichern ohne Token nennt, was fehlt", async () => {
  apiMock.get.mockResolvedValue({ data: view({ rights: { can_edit_access: true } }) });
  const user = userEvent.setup();
  render(<AdminShopPage />);
  await user.click(await screen.findByTestId("shop-key-save-submit"));
  expect(apiMock.put).not.toHaveBeenCalled();
  expect(screen.getByTestId("shop-key-save-hint")).toHaveTextContent("Erst den Printful-Token oben ins Schlüssel-Feld einfügen");
});

test("Preise in Euro werden als Cent gespeichert, leere Pauschale heißt keine", async () => {
  apiMock.patch.mockResolvedValue({ data: view({ config: { public_markup_cents: 350, fallback_shipping_cents: 690 } }) });
  const user = userEvent.setup();
  render(<AdminShopPage />);
  const markup = await screen.findByTestId("shop-markup");
  await user.clear(markup);
  await user.type(markup, "3,5x");
  expect(screen.getByTestId("shop-prices-invalid")).toBeInTheDocument();
  await user.clear(markup);
  await user.type(markup, "3,50");
  await user.type(screen.getByTestId("shop-fallback"), "6,90");
  await user.type(screen.getByTestId("shop-prices-save-reason"), "Vorstandsbeschluss");
  await user.click(screen.getByTestId("shop-prices-save-submit"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/shop/config", {
    public_markup_cents: 350, fallback_shipping_cents: 690, reason: "Vorstandsbeschluss",
  });
});

test("der Mindestpreis je Artikel ist einstellbar und 0 € geht nicht", async () => {
  apiMock.patch.mockResolvedValue({ data: view({ config: { min_price_cents: 500 } }) });
  const user = userEvent.setup();
  render(<AdminShopPage />);
  const minimum = await screen.findByTestId("shop-min-price");
  expect(minimum).toHaveValue("1,00");
  await user.clear(minimum);
  await user.type(minimum, "0");
  expect(screen.getByTestId("shop-prices-invalid")).toBeInTheDocument();
  await user.clear(minimum);
  await user.type(minimum, "5");
  await user.type(screen.getByTestId("shop-prices-save-reason"), "Mindestens 5 Euro");
  await user.click(screen.getByTestId("shop-prices-save-submit"));
  expect(apiMock.patch).toHaveBeenCalledWith("/admin/shop/config", {
    public_markup_cents: 0, fallback_shipping_cents: null, min_price_cents: 500, reason: "Mindestens 5 Euro",
  });
});

test("mit System: Schlüssel hinterlegen leert das Feld und zeigt danach nur „hinterlegt seit“", async () => {
  const secret = "pf-testschluessel-nicht-echt-0123456789";
  apiMock.get.mockResolvedValue({ data: view({ rights: { can_edit_access: true } }) });
  apiMock.put.mockResolvedValue({ data: view({
    rights: { can_edit_access: true },
    config: { printful_key: { state: "ok", saved_at: "2026-10-27T09:00:00+00:00", saved_by: "clubadmin", detail: null } },
  }) });
  const user = userEvent.setup();
  render(<AdminShopPage />);
  const input = await screen.findByTestId("shop-key-input");
  expect(input).toHaveAttribute("type", "password");
  await user.type(input, secret);
  await user.type(screen.getByTestId("shop-key-save-reason"), "Zugang hinterlegen");
  await user.click(screen.getByTestId("shop-key-save-submit"));
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/config/printful-key", { api_key: secret, reason: "Zugang hinterlegen" });
  expect(await screen.findByTestId("shop-key-state")).toHaveTextContent("hinterlegt seit");
  expect(screen.getByTestId("shop-key-state")).toHaveTextContent("clubadmin");
  expect(screen.getByTestId("shop-key-input")).toHaveValue("");
  expect(document.body.textContent).not.toContain(secret);
  expect(screen.getByTestId("shop-key-test")).toBeEnabled();
});

test("Verbindung testen zeigt das Ergebnis mit Ursache", async () => {
  const keyed = { printful_key: { state: "ok", saved_at: "2026-10-27T09:00:00+00:00", saved_by: "root", detail: null } };
  apiMock.get.mockResolvedValue({ data: view({ config: keyed }) });
  apiMock.post.mockResolvedValue({ data: {
    ...view({ config: { ...keyed, printful_last_test: { at: "2026-10-27T10:00:00+00:00", ok: false, detail: "Printful hat den Schlüssel abgelehnt (401)." } } }),
    result: { ok: false, detail: "Printful hat den Schlüssel abgelehnt (401)." },
  } });
  const user = userEvent.setup();
  render(<AdminShopPage />);
  await user.click(await screen.findByTestId("shop-key-test"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/shop/config/printful-test");
  expect(await screen.findByTestId("shop-key-last-test")).toHaveTextContent("abgelehnt (401)");
});

test("der Superadmin gibt die Steuer frei - mit Grund", async () => {
  apiMock.get.mockResolvedValue({ data: view({ rights: { can_set_tax: true } }) });
  apiMock.put.mockResolvedValue({ data: view({
    rights: { can_set_tax: true, can_set_public: true },
    config: { tax_cleared: { at: "2026-10-27T10:00:00+00:00", by: "root", reason: "Steuerberatung bestätigt" } },
    stages: STAGES.map((stage) => (stage.key === "public" ? { ...stage, locked: false, lock_reason: null } : stage)),
  }) });
  const user = userEvent.setup();
  render(<AdminShopPage />);
  const form = await screen.findByTestId("shop-tax-toggle-form");
  // Kritisch: hier ist der Grund Pflicht. Ohne ihn sagt der Knopf, was fehlt, und setzt den Cursor ins Grund-Feld.
  await user.click(within(form).getByTestId("shop-tax-toggle-submit"));
  expect(apiMock.put).not.toHaveBeenCalled();
  expect(within(form).getByTestId("shop-tax-toggle-hint")).toHaveTextContent("Bitte kurz einen Grund angeben");
  expect(within(form).getByTestId("shop-tax-toggle-reason")).toHaveFocus();
  expect(within(form).getByTestId("shop-tax-toggle-reason")).toHaveAttribute("aria-invalid", "true");
  await user.type(within(form).getByTestId("shop-tax-toggle-reason"), "Steuerberatung bestätigt");
  expect(within(form).queryByTestId("shop-tax-toggle-hint")).toBeNull();
  await user.click(within(form).getByTestId("shop-tax-toggle-submit"));
  expect(apiMock.put).toHaveBeenCalledWith("/admin/shop/config/tax-clearance", { cleared: true, reason: "Steuerberatung bestätigt" });
  expect(await screen.findByTestId("shop-tax-state")).toHaveTextContent("Freigegeben von root");
  expect(screen.getByTestId("shop-stage-public")).toBeEnabled();
});
