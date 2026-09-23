import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Sponsoren aus Dolibarr (#405): der Block über der Liste zeigt Schalter und Stand, Einschalten
// speichert und lädt die Liste neu; bei einem Sponsor aus Dolibarr sind Name, Stufe, Laufzeit und
// Kontakt gesperrt, Beschreibung und Platzierung bleiben frei.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/GermanDateField", () => ({
  GermanDateField: ({ label, value, onChange, testId, disabled }) => <label>{label}<input data-testid={testId} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>,
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminSponsorsPage = (await import("./AdminSponsorsPage")).default;

const SOURCE_OFF = { from_dolibarr: false, connected: true, sponsor_category: "Sponsor", partner_category: "Partner", categories: {}, counts: { sponsors: 0, partners: 0 }, locked: { sponsors: ["name", "tier", "contract_start", "contract_end", "contact_email", "contact_phone"], partners: ["name", "kind"] } };
const SOURCE_ON = { ...SOURCE_OFF, from_dolibarr: true, fetched_at: "2026-09-23T10:00:00Z", counts: { sponsors: 2, partners: 1 }, categories: { sponsor: { label: "Sponsor", found: true, sub: ["Gold"] }, partner: { label: "Partner", found: true, sub: [] } } };
const SPONSORS = [
  { id: "s1", name: "Alpha Energy", tier: "gold", source: "dolibarr", contract_start: "2024-01-01", contract_end: "2026-12-31", contact_email: "office@alpha.test", description: "Handtext", is_active: true, effective_status: "active" },
  { id: "s2", name: "Handfirma", tier: "bronze", is_active: true, effective_status: "active" },
];

function mockApi(source) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/admin/dolibarr/sponsors") return { data: source };
    if (url === "/sponsors/admin") return { data: SPONSORS };
    return { data: [] };
  });
}

beforeEach(() => {
  apiMock.patch.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

test("Schalter einschalten speichert, meldet den Lauf und lädt die Liste neu", async () => {
  mockApi(SOURCE_OFF);
  apiMock.patch.mockResolvedValue({ data: { ok: true, result: { ok: true, sponsors: { total: 2 }, partners: { total: 1 } }, view: SOURCE_ON } });
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  const toggle = await screen.findByTestId("dolibarr-source-switch");
  expect(toggle).not.toBeChecked();
  expect(screen.queryByTestId("dolibarr-source-refresh")).toBeNull();

  fireEvent.click(toggle);
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/dolibarr/sponsors", { from_dolibarr: true }));
  await waitFor(() => expect(screen.getByTestId("dolibarr-source-switch")).toBeChecked());
  expect(screen.getByTestId("dolibarr-source-state")).toHaveTextContent("2 Sponsoren");
  expect(screen.getByTestId("dolibarr-source-refresh")).toBeInTheDocument();
  expect(apiMock.get.mock.calls.filter(([url]) => url === "/sponsors/admin").length).toBeGreaterThanOrEqual(2);
  expect(toastMock.success).toHaveBeenCalled();
});

test("Kategorien speichern schickt beide Namen; ohne Anbindung gibt es nur den Hinweis", async () => {
  mockApi(SOURCE_OFF);
  apiMock.patch.mockResolvedValue({ data: { ok: true, result: null, view: { ...SOURCE_OFF, sponsor_category: "Gönner" } } });
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  const input = await screen.findByTestId("dolibarr-source-sponsor-category");
  expect(screen.getByTestId("dolibarr-source-save")).toBeDisabled();
  fireEvent.change(input, { target: { value: "Gönner" } });
  fireEvent.click(screen.getByTestId("dolibarr-source-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/dolibarr/sponsors", { sponsor_category: "Gönner", partner_category: "Partner" }));

  mockApi({ ...SOURCE_OFF, connected: false });
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  expect(await screen.findByTestId("dolibarr-source-offline")).toHaveTextContent("nicht angebunden");
  expect(screen.getAllByTestId("dolibarr-source-switch").at(-1)).toBeDisabled();
});

test("Sponsor aus Dolibarr: Dolibarr-Felder gesperrt, Website-Felder frei; Handeintrag bleibt ganz frei", async () => {
  mockApi(SOURCE_ON);
  render(<MemoryRouter><AdminSponsorsPage /></MemoryRouter>);
  expect(await screen.findByTestId("sponsor-dolibarr-s1")).toBeInTheDocument();
  expect(screen.queryByTestId("sponsor-dolibarr-s2")).toBeNull();

  fireEvent.click(screen.getByTestId("sponsor-card-s1").querySelector("button"));
  expect(screen.getByTestId("sponsor-locked-hint")).toBeInTheDocument();
  expect(screen.getByTestId("sponsor-name")).toBeDisabled();
  expect(screen.getByTestId("sponsor-tier")).toBeDisabled();
  expect(screen.getByTestId("sponsor-contract-end")).toBeDisabled();
  expect(screen.getByTestId("sponsor-contact-email")).toBeDisabled();
  expect(screen.getByTestId("sponsor-description")).not.toBeDisabled();
  expect(screen.getByTestId("sponsor-show-home")).not.toBeDisabled();
  fireEvent.click(screen.getByTestId("sponsor-sheet-cancel"));

  fireEvent.click(screen.getByTestId("sponsor-card-s2").querySelector("button"));
  expect(screen.queryByTestId("sponsor-locked-hint")).toBeNull();
  expect(screen.getByTestId("sponsor-name")).not.toBeDisabled();
});
